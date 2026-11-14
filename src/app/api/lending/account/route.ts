import { connection } from "next/server";
import { LENDING_CONTRACT_ID } from "@/lib/config";
import { ACTIVITY_LIMIT, getLendingAccount, getLendingActivity } from "@/lib/near/lending-views";
import { isValidAccountId } from "@/lib/near/rpc";

/**
 * GET /api/lending/account?accountId=alice.testnet
 * -> { mode: "near", account: AccountView | null, activity: ActivityEntry[] }  (NEAR testnet)
 */
export async function GET(request: Request) {
  await connection();

  const accountId = new URL(request.url).searchParams.get("accountId")?.trim() ?? "";
  if (!isValidAccountId(accountId)) {
    return Response.json({ error: "accountId must be a valid NEAR account id, e.g. alice.testnet" }, { status: 400 });
  }

  try {
    const [account, activity] = await Promise.all([
      getLendingAccount(LENDING_CONTRACT_ID, accountId),
      getLendingActivity(LENDING_CONTRACT_ID, accountId, 0, ACTIVITY_LIMIT).then(
        (entries) => ({ entries, error: null as string | null }),
        (error: unknown) => ({ entries: [], error: error instanceof Error ? error.message : String(error) }),
      ),
    ]);
    return Response.json(
      { mode: "near", account, activity: activity.entries, activityError: activity.error },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: `Lending account ${accountId} could not be read: ${error instanceof Error ? error.message : String(error)}` },
      { status: 502 },
    );
  }
}
