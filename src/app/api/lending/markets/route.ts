import { connection } from "next/server";
import { LENDING_CONTRACT_ID } from "@/lib/config";
import { getLendingAssets, getLendingConfig } from "@/lib/near/lending-views";

/**
 * GET /api/lending/markets
 * -> { mode: "near", contractId, config, assets: AssetView[] }  (server-side RPC on NEAR testnet, uncached)
 */
export async function GET() {
  await connection();

  try {
    const [config, assets] = await Promise.all([getLendingConfig(LENDING_CONTRACT_ID), getLendingAssets(LENDING_CONTRACT_ID)]);
    return Response.json(
      { mode: "near", contractId: LENDING_CONTRACT_ID, config, assets },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: `Lending contract ${LENDING_CONTRACT_ID} could not be read: ${error instanceof Error ? error.message : String(error)}` },
      { status: 502 },
    );
  }
}
