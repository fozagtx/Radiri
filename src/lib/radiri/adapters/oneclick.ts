import { requestOneClickQuote } from "@/lib/intents/client";
import { classifyOneClickMessage, extractOneClickError } from "@/lib/intents/errors";
import { dryRunPlaceholder } from "@/lib/intents/placeholders";
import { fromBaseUnits, toBaseUnits } from "../catalog";
import type { RouteFailure, RouteQuote, StableAsset } from "../types";

/**
 * NEAR Intents 1Click source for the stablecoin route monitor. Uses the shared server-only SDK
 * client in src/lib/intents (official `@defuse-protocol/one-click-sdk-typescript`). Always dry.
 */

const QUOTE_DEADLINE_MS = 10 * 60_000;

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

function routeKind(reason: string, status: number | null): RouteFailure["kind"] {
  const kind = classifyOneClickMessage(reason, status);
  return kind === "no-liquidity" ? "no-liquidity" : kind === "error" ? "error" : "unsupported";
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
  const destinationRecipient = recipient ?? dryRunPlaceholder(to.chain);
  const originRefund = refundTo ?? dryRunPlaceholder(from.chain);
  if (!destinationRecipient) {
    return failure(from, to, `no dry-run recipient configured for destination chain "${to.chain}"`, "unsupported");
  }
  if (!originRefund) {
    return failure(from, to, `no dry-run refund address configured for origin chain "${from.chain}"`, "unsupported");
  }

  let amountBase: string;
  try {
    amountBase = toBaseUnits(amount, from.decimals);
  } catch (error) {
    return failure(from, to, error instanceof Error ? error.message : String(error), "unsupported");
  }

  let payload: Awaited<ReturnType<typeof requestOneClickQuote>>;
  try {
    payload = await requestOneClickQuote({
      dry: true,
      originAsset: from.assetId,
      destinationAsset: to.assetId,
      amount: amountBase,
      slippageBps,
      recipient: destinationRecipient,
      refundTo: originRefund,
      deadline: new Date(Date.now() + QUOTE_DEADLINE_MS).toISOString(),
    });
  } catch (error) {
    const info = extractOneClickError(error);
    if (info.correlationId) console.warn(`1Click quote failed (correlationId ${info.correlationId}): ${info.message}`);
    return failure(from, to, info.message, routeKind(info.message, info.status));
  }

  if (!payload?.quote?.amountOut || !payload.quote.minAmountOut) {
    return failure(from, to, "unexpected 1Click payload: quote.amountOut is missing", "error");
  }

  const amountOut = fromBaseUnits(payload.quote.amountOut, to.decimals);
  const minAmountOut = fromBaseUnits(payload.quote.minAmountOut, to.decimals);

  const fees: RouteQuote["fees"] = [];
  if (payload.quote.withdrawFee && BigInt(payload.quote.withdrawFee) > BigInt(0)) {
    fees.push({
      label: "Withdraw fee (destination chain)",
      amount: fromBaseUnits(payload.quote.withdrawFee, to.decimals),
      unit: to.symbol,
    });
  }
  if (payload.quote.refundFee && BigInt(payload.quote.refundFee) > BigInt(0)) {
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
