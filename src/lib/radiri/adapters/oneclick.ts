import { fromBaseUnits, toBaseUnits } from "../catalog";
import type { RouteFailure, RouteQuote, StableAsset } from "../types";

const ONECLICK_API = "https://1click.chaindefuser.com/v0";
const QUOTE_TIMEOUT_MS = 25_000;
const QUOTE_DEADLINE_MS = 10 * 60_000;

/**
 * Dry-run placeholder recipients. 1Click validates the recipient format for the
 * destination chain and the refund address for the origin chain before it
 * quotes, and rejects checksum-looking / zero addresses. Nothing is ever sent.
 */
const EVM_RECIPIENT = "0x1111111111111111111111111111111111111111";
const SOL_RECIPIENT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const NEAR_RECIPIENT = "0000000000000000000000000000000000000000000000000000000000000001";

const DRY_RUN_RECIPIENTS: Record<string, string> = {
  near: NEAR_RECIPIENT,
  eth: EVM_RECIPIENT,
  arb: EVM_RECIPIENT,
  base: EVM_RECIPIENT,
  pol: EVM_RECIPIENT,
  bsc: EVM_RECIPIENT,
  op: EVM_RECIPIENT,
  avax: EVM_RECIPIENT,
  gnosis: EVM_RECIPIENT,
  monad: EVM_RECIPIENT,
  scroll: EVM_RECIPIENT,
  xlayer: EVM_RECIPIENT,
  hypercore: EVM_RECIPIENT,
  sol: SOL_RECIPIENT,
};

interface OneClickQuoteFields {
  amountIn: string;
  amountInFormatted: string;
  amountInUsd?: string;
  minAmountIn?: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd?: string;
  minAmountOut: string;
  timeEstimate: number;
  refundFee?: string;
  withdrawFee?: string;
}

interface OneClickQuoteResponse {
  quote: OneClickQuoteFields;
  quoteRequest: unknown;
  signature?: string;
  timestamp: string;
  correlationId: string;
}

interface OneClickError {
  message?: string;
  error?: string;
  correlationId?: string;
}

export interface OneClickQuoteParams {
  from: StableAsset;
  to: StableAsset;
  amount: number;
  slippageBps: number;
  recipient?: string;
  refundTo?: string;
}

function failure(from: StableAsset, to: StableAsset, reason: string, kind: RouteFailure["kind"]): RouteFailure {
  return { source: "near-intents", from, to, reason, kind };
}

function classify(reason: string): RouteFailure["kind"] {
  if (/no liquidity|not enough liquidity|insufficient liquidity/i.test(reason)) return "no-liquidity";
  if (/not valid|unsupported|not supported|too low|too high|amount/i.test(reason)) return "unsupported";
  return "error";
}

function costBps(amountIn: number, amountOut: number): number {
  return ((amountIn - amountOut) / amountIn) * 10_000;
}

/** Quotes NEAR Intents 1Click for a fixed input amount. Always `dry: true`. */
export async function quoteOneClick({
  from,
  to,
  amount,
  slippageBps,
  recipient,
  refundTo,
}: OneClickQuoteParams): Promise<RouteQuote | RouteFailure> {
  const destinationRecipient = recipient ?? DRY_RUN_RECIPIENTS[to.chain.toLowerCase()];
  const originRefund = refundTo ?? DRY_RUN_RECIPIENTS[from.chain.toLowerCase()];
  if (!destinationRecipient) {
    return failure(from, to, `no dry-run recipient configured for destination chain "${to.chain}"`, "unsupported");
  }
  if (!originRefund) {
    return failure(from, to, `no dry-run refund address configured for origin chain "${from.chain}"`, "unsupported");
  }

  const jwt = process.env.ONECLICK_JWT?.trim();
  const body = {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: slippageBps,
    originAsset: from.assetId,
    destinationAsset: to.assetId,
    amount: toBaseUnits(amount, from.decimals),
    depositType: "ORIGIN_CHAIN",
    recipientType: "DESTINATION_CHAIN",
    refundType: "ORIGIN_CHAIN",
    recipient: destinationRecipient,
    refundTo: originRefund,
    deadline: new Date(Date.now() + QUOTE_DEADLINE_MS).toISOString(),
  };

  let res: Response;
  try {
    res = await fetch(`${ONECLICK_API}/quote`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "Radiri/0.1 (+https://radiri.vercel.app)",
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
    });
  } catch (error) {
    return failure(from, to, error instanceof Error ? error.message : String(error), "error");
  }

  const raw = await res.text();
  if (raw.trimStart().startsWith("<")) {
    return failure(
      from,
      to,
      `1Click answered with an HTML page instead of a quote (HTTP ${res.status}), usually a Cloudflare challenge on this network`,
      "error",
    );
  }
  if (!res.ok) {
    let reason = raw.trim() || `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(raw) as OneClickError;
      reason = parsed.message || parsed.error || reason;
      if (parsed.correlationId) {
        console.warn(`1Click quote failed (correlationId ${parsed.correlationId}): ${reason}`);
      }
    } catch {
      // keep the verbatim body
    }
    return failure(from, to, reason, classify(reason));
  }

  let payload: OneClickQuoteResponse;
  try {
    payload = JSON.parse(raw) as OneClickQuoteResponse;
  } catch (error) {
    return failure(from, to, `unexpected 1Click payload: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
  if (!payload.quote?.amountOut || !payload.quote?.minAmountOut) {
    return failure(from, to, "unexpected 1Click payload: quote.amountOut is missing", "error");
  }

  const amountOut = fromBaseUnits(payload.quote.amountOut, to.decimals);
  const minAmountOut = fromBaseUnits(payload.quote.minAmountOut, to.decimals);

  const fees: RouteQuote["fees"] = [];
  if (payload.quote.withdrawFee && Number(payload.quote.withdrawFee) > 0) {
    fees.push({
      label: "Withdraw fee (destination chain)",
      amount: fromBaseUnits(payload.quote.withdrawFee, to.decimals),
      unit: to.symbol,
    });
  }
  if (payload.quote.refundFee && Number(payload.quote.refundFee) > 0) {
    fees.push({
      label: "Refund fee (only if the deposit is refunded)",
      amount: fromBaseUnits(payload.quote.refundFee, from.decimals),
      unit: from.symbol,
    });
  }

  return {
    source: "near-intents",
    from,
    to,
    amountIn: amount,
    amountOut,
    minAmountOut,
    costBps: costBps(amount, amountOut),
    worstCaseCostBps: costBps(amount, minAmountOut),
    fees,
    etaSeconds: Number.isFinite(payload.quote.timeEstimate) ? payload.quote.timeEstimate : null,
    slippageBps,
    quotedAt: payload.timestamp ?? new Date().toISOString(),
    execution: {
      provider: "near-intents",
      dry: true,
      quoteRequest: payload.quoteRequest,
      correlationId: payload.correlationId,
    },
  };
}
