import "server-only";

import type { SwapQuoteFailure, SwapQuoteRequest } from "@/types/protocol";
import { checkAddress } from "./addresses";
import { AmountError, toPositiveBaseUnits } from "./amounts";
import { chainName } from "./chains";
import { findSwapAsset } from "./catalog";
import {
  fetchOneClickStatus,
  isQuoteSignatureValid,
  requestOneClickQuote,
  submitOneClickDeposit,
  type DepositSubmission,
} from "./client";
import { extractOneClickError, quoteFailureFrom } from "./errors";
import { dryRunPlaceholder } from "./placeholders";
import { isQuoteFailure, parseQuoteResponse } from "./quote-parse";
import { mapStatusResponse } from "./status-map";
import type { RadiriSwapStatus, SwapQuoteResult } from "./types";

export const MAX_SLIPPAGE_BPS = 5_000;
const DRY_DEADLINE_MS = 10 * 60_000;
const LIVE_DEADLINE_MS = 30 * 60_000;
/** Chains with slow finality get more time before 1Click starts refunding. */
const SLOW_CHAIN_DEADLINE_MS = 2 * 60 * 60_000;
const SLOW_CHAINS = new Set(["btc", "doge", "ltc", "bch", "zec", "dash"]);

function fail(kind: SwapQuoteFailure["kind"], reason: string): SwapQuoteResult {
  return { failure: { kind, reason } };
}

/**
 * Dry (indicative) or live (executable) EXACT_INPUT quote through 1Click.
 * Live quotes require the user's own recipient (destination chain) and refund address (origin chain)
 * and return a deposit address, memo and deadline. Every 1Click rejection is returned verbatim.
 */
export async function quoteSwap(request: SwapQuoteRequest): Promise<SwapQuoteResult> {
  if (!Number.isInteger(request.slippageBps) || request.slippageBps < 0 || request.slippageBps > MAX_SLIPPAGE_BPS) {
    return fail("invalid-input", `slippageBps must be an integer between 0 and ${MAX_SLIPPAGE_BPS}`);
  }
  if (request.originAssetId === request.destinationAssetId) {
    return fail("invalid-input", "origin and destination are the same asset");
  }

  const [origin, destination] = await Promise.all([
    findSwapAsset(request.originAssetId),
    findSwapAsset(request.destinationAssetId),
  ]);
  if (!origin) return fail("unsupported", `${request.originAssetId} is not in the live 1Click catalog`);
  if (!destination) return fail("unsupported", `${request.destinationAssetId} is not in the live 1Click catalog`);

  let amount: string;
  try {
    amount = toPositiveBaseUnits(request.amount, origin.decimals);
  } catch (error) {
    if (error instanceof AmountError) return fail("invalid-input", error.message);
    throw error;
  }

  let recipient = request.recipient?.trim() || "";
  let refundTo = request.refundTo?.trim() || "";
  let placeholderAddresses = false;

  if (request.dry) {
    if (!recipient) {
      const placeholder = dryRunPlaceholder(destination.chain);
      if (!placeholder) {
        return fail(
          "unsupported",
          `an indicative quote to ${chainName(destination.chain)} needs a recipient address on that chain`,
        );
      }
      recipient = placeholder;
      placeholderAddresses = true;
    }
    if (!refundTo) {
      const placeholder = dryRunPlaceholder(origin.chain);
      if (!placeholder) {
        return fail("unsupported", `an indicative quote from ${chainName(origin.chain)} needs a refund address on that chain`);
      }
      refundTo = placeholder;
      placeholderAddresses = true;
    }
  } else {
    if (!recipient) return fail("invalid-input", `recipient (a ${chainName(destination.chain)} address) is required for an executable quote`);
    if (!refundTo) return fail("invalid-input", `refundTo (a ${chainName(origin.chain)} address) is required for an executable quote`);
  }

  const recipientCheck = checkAddress(destination.chain, recipient);
  if (recipientCheck.valid === false) {
    return fail("invalid-input", `recipient is not a valid ${chainName(destination.chain)} address: ${recipientCheck.reason}`);
  }
  const refundCheck = checkAddress(origin.chain, refundTo);
  if (refundCheck.valid === false) {
    return fail("invalid-input", `refundTo is not a valid ${chainName(origin.chain)} address: ${refundCheck.reason}`);
  }

  const deadlineMs = request.dry
    ? DRY_DEADLINE_MS
    : SLOW_CHAINS.has(origin.chain)
      ? SLOW_CHAIN_DEADLINE_MS
      : LIVE_DEADLINE_MS;

  let response: Awaited<ReturnType<typeof requestOneClickQuote>>;
  try {
    response = await requestOneClickQuote({
      dry: request.dry,
      originAsset: origin.id,
      destinationAsset: destination.id,
      amount,
      slippageBps: request.slippageBps,
      recipient,
      refundTo,
      deadline: new Date(Date.now() + deadlineMs).toISOString(),
    });
  } catch (error) {
    return { failure: quoteFailureFrom(error) };
  }

  const signatureVerified = request.dry ? null : isQuoteSignatureValid(response);
  const parsed = parseQuoteResponse(response, {
    dry: request.dry,
    origin,
    destination,
    slippageBps: request.slippageBps,
    recipient,
    refundTo,
    placeholderAddresses,
    signatureVerified,
  });
  if (isQuoteFailure(parsed)) return { failure: parsed };
  if (!request.dry && signatureVerified === false) {
    return fail(
      "error",
      "1Click returned a live quote whose signature did not verify against the 1Click public key; the deposit address is withheld",
    );
  }
  return { quote: parsed };
}

/** HTTP-ish error for route handlers: carries the upstream status (404 for an unknown deposit address). */
export class SwapUpstreamError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SwapUpstreamError";
    this.status = status;
  }
}

function upstream(error: unknown): SwapUpstreamError {
  const info = extractOneClickError(error);
  const status = info.status && info.status >= 400 && info.status < 500 ? info.status : 502;
  return new SwapUpstreamError(info.message, status);
}

export async function getSwapStatus(depositAddress: string, depositMemo?: string): Promise<RadiriSwapStatus> {
  return (await getSwapStatusWithQuote(depositAddress, depositMemo)).status;
}

/** Status plus the signed quote 1Click stored for this deposit address (used by the optional DB index). */
export async function getSwapStatusWithQuote(
  depositAddress: string,
  depositMemo?: string,
): Promise<{ status: RadiriSwapStatus; raw: Awaited<ReturnType<typeof fetchOneClickStatus>> }> {
  let raw: Awaited<ReturnType<typeof fetchOneClickStatus>>;
  try {
    raw = await fetchOneClickStatus(depositAddress, depositMemo);
  } catch (error) {
    throw upstream(error);
  }
  return { status: mapStatusResponse(raw, depositAddress), raw };
}

export async function submitDeposit(input: DepositSubmission): Promise<RadiriSwapStatus> {
  let raw: unknown;
  try {
    raw = await submitOneClickDeposit(input);
  } catch (error) {
    throw upstream(error);
  }
  return mapStatusResponse(raw, input.depositAddress);
}
