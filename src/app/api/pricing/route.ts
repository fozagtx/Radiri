import { connection } from "next/server";
import { getPrices } from "@/lib/oracle";

/**
 * GET /api/pricing?symbols=PEPE,$WIF,AAPL
 * -> { observations: PriceObservation[]; missing: { symbol, reason }[]; notes?: string[] }
 *
 * Meme coins and other 1Click assets: 1Click /v0/tokens price with its priceUpdatedAt.
 * US equities: Pyth Hermes (Equity.US.<SYM>/USD), falling back to the 1Click Ondo tokenized stock
 * (<SYM>on) with a note when Hermes cannot serve the price. `fresh` = age <= configured max age.
 */
export async function GET(request: Request) {
  await connection();

  const raw = new URL(request.url).searchParams.get("symbols") ?? "";
  const symbols = raw
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean);
  if (symbols.length === 0) {
    return Response.json({ error: "symbols is required, e.g. ?symbols=PEPE,$WIF,AAPL" }, { status: 400 });
  }
  if (symbols.length > 50) {
    return Response.json({ error: `at most 50 symbols per request, got ${symbols.length}` }, { status: 400 });
  }

  try {
    const result = await getPrices(symbols);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
