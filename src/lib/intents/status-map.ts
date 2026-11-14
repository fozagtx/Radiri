import { z } from "zod";
import type { SwapStatusValue } from "@/types/protocol";
import { INTENTS_EXPLORER_URL } from "./chains";
import { SWAP_STATUS_VALUES, type RadiriSwapStatus } from "./types";

/**
 * Pure mapper from a 1Click `GET /v0/status` (or `POST /v0/deposit/submit`) body to Radiri's
 * SwapStatus. The status value is passed through verbatim; an unknown value is an error, never
 * coerced into something that could read as success. Client-safe.
 */

const TxSchema = z.object({ hash: z.string(), explorerUrl: z.string().nullish() });

const StatusResponseSchema = z.object({
  correlationId: z.string().optional(),
  status: z.string(),
  updatedAt: z.string().optional(),
  swapDetails: z
    .object({
      nearTxHashes: z.array(z.string()).optional(),
      amountOutFormatted: z.string().nullish(),
      refundedAmountFormatted: z.string().nullish(),
      refundReason: z.string().nullish(),
      depositedAmountFormatted: z.string().nullish(),
      originChainTxHashes: z.array(TxSchema).optional(),
      destinationChainTxHashes: z.array(TxSchema).optional(),
    })
    .optional(),
});

export class StatusPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatusPayloadError";
  }
}

export function isSwapStatusValue(value: string): value is SwapStatusValue {
  return (SWAP_STATUS_VALUES as readonly string[]).includes(value);
}

function txList(items: { hash: string; explorerUrl?: string | null }[] | undefined) {
  return (items ?? [])
    .filter((item) => item.hash)
    .map((item) => ({ hash: item.hash, explorerUrl: item.explorerUrl?.trim() ? item.explorerUrl.trim() : null }));
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function mapStatusResponse(raw: unknown, depositAddress: string): RadiriSwapStatus {
  const parsed = StatusResponseSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new StatusPayloadError(
      `unexpected 1Click status payload: ${issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid shape"}`,
    );
  }
  const body = parsed.data;
  if (!isSwapStatusValue(body.status)) {
    throw new StatusPayloadError(`1Click returned an unknown status "${body.status}"`);
  }
  const details = body.swapDetails ?? {};
  return {
    depositAddress,
    status: body.status,
    updatedAt: body.updatedAt ?? new Date().toISOString(),
    originTxHashes: txList(details.originChainTxHashes),
    destinationTxHashes: txList(details.destinationChainTxHashes),
    amountOut: nonEmpty(details.amountOutFormatted),
    refundedAmount: nonEmpty(details.refundedAmountFormatted),
    refundReason: nonEmpty(details.refundReason),
    depositedAmount: nonEmpty(details.depositedAmountFormatted),
    nearTxHashes: details.nearTxHashes ?? [],
    correlationId: body.correlationId ?? null,
    intentsExplorerUrl: INTENTS_EXPLORER_URL,
  };
}
