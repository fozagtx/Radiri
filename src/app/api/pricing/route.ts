import { connection } from "next/server";
import { getPrices } from "@/lib/oracle";

/**
 * GET /api/pricing?symbols=PEPE,$WIF,AAPLon
 * -> { observations: PriceObservation[]; missing: { symbol, reason }[] }
 *
 * Every price is the live 1Click /v0/tokens price with its priceUpdatedAt: meme coins by symbol,
 * tokenized stocks by their Ondo symbol (AAPLon, TSLAon, NVDAon). `fresh` = age <= configured max age.
 */
export async function GET(request: Request) {
  await connection();

  const raw = new URL(request.url).searchParams.get("symbols") ?? "";
  const symbols = raw
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean);
  if (symbols.length === 0) {
    return Response.json({ error: "symbols is required, e.g. ?symbols=PEPE,$WIF,AAPLon" }, { status: 400 });
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
