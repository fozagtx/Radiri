import { connection } from "next/server";
import { z } from "zod";
import { submitDeposit } from "@/lib/intents/swap";

/**
 * POST /api/swaps/submit
 * body: { depositAddress, txHash, nearSenderAccount?, memo? }
 * -> 200 SwapStatus (same shape as GET /api/swaps/status) after 1Click registered the deposit tx
 * -> 4xx/502 { error } with the verbatim 1Click message
 * Optional step: 1Click also detects deposits on its own; submitting the hash only speeds it up.
 */

const SubmitBody = z.object({
  depositAddress: z.string().trim().min(1, "depositAddress is required").max(256),
  txHash: z.string().trim().min(1, "txHash is required").max(256),
  nearSenderAccount: z.string().trim().max(64).optional(),
  memo: z.string().trim().max(256).optional(),
});

export async function POST(request: Request) {
  await connection();

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return Response.json(
      { error: `request body must be JSON: ${error instanceof Error ? error.message : String(error)}` },
      { status: 400 },
    );
  }
  const parsed = SubmitBody.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return Response.json({ error: issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid body" }, { status: 400 });
  }

  try {
    const status = await submitDeposit({
      depositAddress: parsed.data.depositAddress,
      txHash: parsed.data.txHash,
      nearSenderAccount: parsed.data.nearSenderAccount || undefined,
      memo: parsed.data.memo || undefined,
    });
    return Response.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: typeof status === "number" ? status : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
