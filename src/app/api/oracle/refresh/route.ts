import { connection } from "next/server";
import { oracleReporterConfigured, pushOraclePrices } from "@/lib/oracle/push";

/**
 * POST /api/oracle/refresh -> { submitted, reason, txHash, lines }
 * Pushes live 1Click prices to the lending contract when its on-chain prices are stale (no-op when
 * they are younger than 45 s). Signs with the reporter's function-call key, which can only call
 * report_prices, so anyone triggering this can at most refresh prices from 1Click.
 */
export async function POST() {
  await connection();
  if (!oracleReporterConfigured()) {
    return Response.json(
      { submitted: false, reason: "oracle reporter not configured on this server (RADIRI_ORACLE_ACCOUNT / RADIRI_ORACLE_PRIVATE_KEY)", txHash: null, lines: [] },
      { status: 503 },
    );
  }
  try {
    return Response.json(await pushOraclePrices(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { submitted: false, reason: error instanceof Error ? error.message : String(error), txHash: null, lines: [] },
      { status: 502 },
    );
  }
}
