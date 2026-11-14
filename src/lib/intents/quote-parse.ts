import { z } from "zod";
import type { CatalogAsset, SwapQuoteFailure } from "@/types/protocol";
import { AmountError, fromBaseUnits } from "./amounts";
import type { RadiriSwapQuote } from "./types";

/**
 * Pure parser for a 1Click `POST /v0/quote` response body. Validates the fields Radiri relies on and
 * converts base units to exact human strings with the catalog decimals. Client-safe.
 */

const BASE_UNITS = z.string().regex(/^\d+$/, "expected integer base units");

const QuoteResponseSchema = z.object({
  quote: z.object({
    amountIn: BASE_UNITS,
    amountInUsd: z.string().optional(),
    amountOut: BASE_UNITS,
    amountOutUsd: z.string().optional(),
    minAmountOut: BASE_UNITS,
    timeEstimate: z.number().optional(),
    depositAddress: z.string().optional(),
    depositMemo: z.string().optional(),
    deadline: z.string().optional(),
    timeWhenInactive: z.string().optional(),
    refundFee: z.string().optional(),
    withdrawFee: z.string().optional(),
  }),
  quoteRequest: z
    .object({
      appFees: z.array(z.object({ recipient: z.string(), fee: z.number() })).optional(),
      insured: z.boolean().optional(),
      deadline: z.string().optional(),
    })
    .optional(),
  signature: z.string().optional(),
  timestamp: z.string().optional(),
  correlationId: z.string().optional(),
});

export interface QuoteParseContext {
  dry: boolean;
  origin: CatalogAsset;
  destination: CatalogAsset;
  slippageBps: number;
  recipient: string;
  refundTo: string;
  placeholderAddresses: boolean;
  /** Live quotes only. */
  signatureVerified?: boolean | null;
}

function usd(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positive(base: string | undefined): base is string {
  return typeof base === "string" && /^\d+$/.test(base) && BigInt(base) > BigInt(0);
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

export function parseQuoteResponse(raw: unknown, ctx: QuoteParseContext): RadiriSwapQuote | SwapQuoteFailure {
  const parsed = QuoteResponseSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      kind: "error",
      reason: `unexpected 1Click quote payload: ${issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid shape"}`,
    };
  }
  const { quote, quoteRequest, signature, timestamp, correlationId } = parsed.data;
  const { origin, destination } = ctx;

  if (!ctx.dry && !quote.depositAddress) {
    return { kind: "error", reason: "1Click returned a live quote without a deposit address" };
  }

  try {
    const fees: RadiriSwapQuote["fees"] = [];
    if (positive(quote.withdrawFee)) {
      fees.push({
        label: "Withdraw fee, destination chain (already deducted from amount out)",
        amount: fromBaseUnits(quote.withdrawFee, destination.decimals),
        unit: destination.symbol,
      });
    }
    for (const appFee of quoteRequest?.appFees ?? []) {
      if (appFee.fee > 0) {
        fees.push({ label: `App fee to ${shortId(appFee.recipient)} (in the quote request)`, amount: String(appFee.fee), unit: "bps" });
      }
    }
    if (quoteRequest?.insured) fees.push({ label: "Insurance fee", amount: "2", unit: "bps" });
    if (positive(quote.refundFee)) {
      fees.push({
        label: "Refund fee (charged only if the deposit is refunded)",
        amount: fromBaseUnits(quote.refundFee, origin.decimals),
        unit: origin.symbol,
      });
    }

    return {
      dry: ctx.dry,
      origin,
      destination,
      amountIn: fromBaseUnits(quote.amountIn, origin.decimals),
      amountInUsd: usd(quote.amountInUsd),
      amountOut: fromBaseUnits(quote.amountOut, destination.decimals),
      amountOutUsd: usd(quote.amountOutUsd),
      minAmountOut: fromBaseUnits(quote.minAmountOut, destination.decimals),
      slippageBps: ctx.slippageBps,
      etaSeconds: typeof quote.timeEstimate === "number" && Number.isFinite(quote.timeEstimate) ? quote.timeEstimate : null,
      fees,
      depositAddress: ctx.dry ? null : (quote.depositAddress ?? null),
      depositMemo: ctx.dry ? null : (quote.depositMemo ?? null),
      // The refund deadline is the one Radiri requested (echoed in quoteRequest). quote.deadline is when
      // the deposit address goes inactive, reported separately as timeWhenInactive.
      deadline: ctx.dry ? null : (quoteRequest?.deadline ?? null),
      correlationId: correlationId ?? null,
      quotedAt: timestamp ?? new Date().toISOString(),
      amountInBase: quote.amountIn,
      amountOutBase: quote.amountOut,
      minAmountOutBase: quote.minAmountOut,
      signature: signature ?? null,
      signatureVerified: ctx.dry ? null : (ctx.signatureVerified ?? null),
      timeWhenInactive: ctx.dry ? null : (quote.timeWhenInactive ?? quote.deadline ?? null),
      placeholderAddresses: ctx.placeholderAddresses,
      recipient: ctx.recipient,
      refundTo: ctx.refundTo,
    };
  } catch (error) {
    if (error instanceof AmountError) return { kind: "error", reason: `unexpected 1Click amounts: ${error.message}` };
    throw error;
  }
}

export function isQuoteFailure(value: RadiriSwapQuote | SwapQuoteFailure): value is SwapQuoteFailure {
  return "reason" in value && "kind" in value && !("amountIn" in value);
}
