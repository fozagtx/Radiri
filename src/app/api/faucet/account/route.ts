import { connection } from "next/server";
import { fundTestnetAccount } from "@/lib/faucet/sponsor";
import { isValidAccountId } from "@/lib/near/rpc";

/**
 * POST /api/faucet/account { accountId }
 * -> { accountId, exists, funded, txHash, reason }
 *
 * Funds a wallet-generated implicit account that has no on-chain key yet, so a first-time user can
 * mint test tokens without leaving the app. Existing accounts are left alone.
 */
export async function POST(request: Request) {
  await connection();

  const body = (await request.json().catch(() => null)) as { accountId?: unknown } | null;
  const accountId = typeof body?.accountId === "string" ? body.accountId.trim() : "";
  if (!isValidAccountId(accountId)) {
    return Response.json({ error: "accountId must be a valid NEAR account id" }, { status: 400 });
  }

  try {
    return Response.json(await fundTestnetAccount(accountId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: `Could not fund ${accountId}: ${error instanceof Error ? error.message : String(error)}` },
      { status: 502 },
    );
  }
}
