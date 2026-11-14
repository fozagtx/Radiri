import { connection } from "next/server";
import { getSwapStatus } from "@/lib/intents/swap";

/**
 * GET /api/swaps/status?depositAddress=…[&depositMemo=…]
 * -> 200 SwapStatus & { depositedAmount, nearTxHashes, correlationId, intentsExplorerUrl }
 * -> 404 { error } when 1Click does not know the deposit address (verbatim 1Click message)
 * The status value is 1Click's, verbatim; Radiri never infers SUCCESS.
 */
export async function GET(request: Request) {
  await connection();

  const search = new URL(request.url).searchParams;
  const depositAddress = search.get("depositAddress")?.trim() ?? "";
  const depositMemo = search.get("depositMemo")?.trim() || undefined;
  if (!depositAddress) {
    return Response.json({ error: "depositAddress is required" }, { status: 400 });
  }
  if (depositAddress.length > 256 || (depositMemo && depositMemo.length > 256)) {
    return Response.json({ error: "depositAddress / depositMemo too long" }, { status: 400 });
  }

  try {
    const status = await getSwapStatus(depositAddress, depositMemo);
    return Response.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: typeof status === "number" ? status : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
