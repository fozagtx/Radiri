import { connection } from "next/server";
import { z } from "zod";
import { quoteSwap, MAX_SLIPPAGE_BPS } from "@/lib/intents/swap";
import type { SwapQuoteFailure } from "@/types/protocol";

/**
 * POST /api/swaps/quote
 * body: SwapQuoteRequest { originAssetId, destinationAssetId, amount (human units, decimal string),
 *       slippageBps, recipient?, refundTo?, dry }
 * -> 200 { quote: SwapQuote & { amountInBase, amountOutBase, minAmountOutBase, signature, signatureVerified,
 *                               timeWhenInactive, placeholderAddresses, recipient, refundTo } }
 * -> 200 { failure: SwapQuoteFailure }  1Click's verbatim reason (e.g. "No liquidity available")
 * -> 400 { failure: { kind: "invalid-input", reason } }  request did not validate
 *
 * dry = true: indicative quote, no deposit address (placeholder addresses are used when none are given).
 * dry = false: executable quote; recipient (destination chain) and refundTo (origin chain) are required
 * and the response carries depositAddress, depositMemo and the refund deadline.
 */

const QuoteBody = z.object({
  originAssetId: z.string().trim().min(1, "originAssetId is required").max(256),
  destinationAssetId: z.string().trim().min(1, "destinationAssetId is required").max(256),
  amount: z
    .string({ error: "amount must be a decimal string in human units, e.g. \"12.5\"" })
    .trim()
    .min(1, "amount is required")
    .max(100),
  slippageBps: z
    .number({ error: "slippageBps must be a number" })
    .int("slippageBps must be an integer")
    .min(0)
    .max(MAX_SLIPPAGE_BPS),
  recipient: z.string().max(256).optional(),
  refundTo: z.string().max(256).optional(),
  dry: z.boolean({ error: "dry must be true or false" }),
});

function invalid(reason: string): Response {
  const failure: SwapQuoteFailure = { kind: "invalid-input", reason };
  return Response.json({ failure }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  await connection();

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return invalid(`request body must be JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const parsed = QuoteBody.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return invalid(issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "invalid request body");
  }

  try {
    const result = await quoteSwap(parsed.data);
    return Response.json(result, {
      status: "failure" in result && result.failure.kind === "invalid-input" ? 400 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const failure: SwapQuoteFailure = { kind: "error", reason: error instanceof Error ? error.message : String(error) };
    return Response.json({ failure }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
