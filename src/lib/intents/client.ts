import "server-only";

import {
  CancelError,
  OneClickService,
  OpenAPI,
  QuoteRequest,
  verifyQuoteSignature,
  type CancelablePromise,
  type GetExecutionStatusResponse,
  type QuoteResponse,
  type SubmitDepositTxResponse,
  type TokenResponse,
} from "@defuse-protocol/one-click-sdk-typescript";

/**
 * Thin, server-only wrapper around the official 1Click SDK
 * (`@defuse-protocol/one-click-sdk-typescript`). Every network call to 1Click in Radiri goes
 * through here so the partner JWT (`ONECLICK_JWT`) stays on the server.
 *
 * SDK methods used: OneClickService.getTokens / getQuote / getExecutionStatus / submitDepositTx,
 * verifyQuoteSignature, and the global OpenAPI config (BASE, TOKEN, HEADERS).
 */

export const ONECLICK_BASE_URL = "https://1click.chaindefuser.com";

const TOKENS_TIMEOUT_MS = 15_000;
const QUOTE_TIMEOUT_MS = 25_000;
const STATUS_TIMEOUT_MS = 15_000;
const SUBMIT_TIMEOUT_MS = 15_000;

let configured = false;

function configure(): void {
  if (configured) return;
  OpenAPI.BASE = ONECLICK_BASE_URL;
  // Read on every request so a rotated secret applies without a restart. An empty string sends no header.
  OpenAPI.TOKEN = async () => process.env.ONECLICK_JWT?.trim() ?? "";
  OpenAPI.HEADERS = { "User-Agent": "Radiri/0.2 (+https://radiri.vercel.app)" };
  configured = true;
}

/** True when a 1Click partner JWT is configured (authenticated fee schedule). */
export function hasOneClickJwt(): boolean {
  return Boolean(process.env.ONECLICK_JWT?.trim());
}

async function withTimeout<T>(promise: CancelablePromise<T>, ms: number, label: string): Promise<T> {
  const timer = setTimeout(() => promise.cancel(), ms);
  try {
    return await promise;
  } catch (error) {
    if (error instanceof CancelError) throw new Error(`1Click ${label} timed out after ${Math.round(ms / 1000)} s`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** `GET /v0/tokens?ondoTokens=true`: the full live catalog, including Ondo tokenized stocks. */
export async function fetchOneClickTokens(): Promise<TokenResponse[]> {
  configure();
  const tokens = await withTimeout(OneClickService.getTokens("true"), TOKENS_TIMEOUT_MS, "/v0/tokens");
  if (!Array.isArray(tokens)) throw new Error("1Click /v0/tokens returned an unexpected payload (expected an array)");
  return tokens;
}

export interface OneClickQuoteInput {
  dry: boolean;
  originAsset: string;
  destinationAsset: string;
  /** Integer base units of the origin asset. */
  amount: string;
  slippageBps: number;
  recipient: string;
  refundTo: string;
  /** ISO time after which an unfilled deposit is refunded. */
  deadline: string;
}

/** `POST /v0/quote` (EXACT_INPUT, ORIGIN_CHAIN deposit, DESTINATION_CHAIN recipient, ORIGIN_CHAIN refund). */
export async function requestOneClickQuote(input: OneClickQuoteInput): Promise<QuoteResponse> {
  configure();
  const request: QuoteRequest = {
    dry: input.dry,
    swapType: QuoteRequest.swapType.EXACT_INPUT,
    slippageTolerance: input.slippageBps,
    originAsset: input.originAsset,
    depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
    destinationAsset: input.destinationAsset,
    amount: input.amount,
    refundTo: input.refundTo,
    refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
    recipient: input.recipient,
    recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
    deadline: input.deadline,
  };
  return withTimeout(OneClickService.getQuote(request), QUOTE_TIMEOUT_MS, "/v0/quote");
}

/** Verifies the 1Click service signature over a quote (SDK `verifyQuoteSignature`). */
export function isQuoteSignatureValid(response: QuoteResponse): boolean {
  try {
    return verifyQuoteSignature(response);
  } catch {
    return false;
  }
}

/** `GET /v0/status?depositAddress=&depositMemo=`. */
export async function fetchOneClickStatus(depositAddress: string, depositMemo?: string): Promise<GetExecutionStatusResponse> {
  configure();
  return withTimeout(
    OneClickService.getExecutionStatus(depositAddress, depositMemo || undefined),
    STATUS_TIMEOUT_MS,
    "/v0/status",
  );
}

export interface DepositSubmission {
  depositAddress: string;
  txHash: string;
  nearSenderAccount?: string;
  memo?: string;
}

/** `POST /v0/deposit/submit`: tells 1Click about the deposit transaction to speed up processing. */
export async function submitOneClickDeposit(input: DepositSubmission): Promise<SubmitDepositTxResponse> {
  configure();
  return withTimeout(
    OneClickService.submitDepositTx({
      depositAddress: input.depositAddress,
      txHash: input.txHash,
      ...(input.nearSenderAccount ? { nearSenderAccount: input.nearSenderAccount } : {}),
      ...(input.memo ? { memo: input.memo } : {}),
    }),
    SUBMIT_TIMEOUT_MS,
    "/v0/deposit/submit",
  );
}
