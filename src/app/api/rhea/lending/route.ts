import { connection } from "next/server";
import { getRheaLending } from "@/lib/rhea/lending";

/**
 * GET /api/rhea/lending -> RheaLendingSnapshot
 * RHEA Lending (contract.main.burrow.near, NEAR mainnet) reserves and config, read-only reference market.
 */
export async function GET() {
  await connection();
  try {
    const snapshot = await getRheaLending();
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: `RHEA Lending read failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
