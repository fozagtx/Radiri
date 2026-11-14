/**
 * Runs journeys A and B against the deployed testnet contract with a fresh faucet-funded user:
 *   A: mint tPEPE -> deposit as collateral -> borrow tAAPL
 *   B: mint tNVDA -> deposit as collateral -> borrow tPEPE
 * then prints the on-chain position from get_account. Real testnet transactions, test tokens only.
 *
 *   NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/testnet-journeys.ts
 */
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import { TESTNET_DEPLOYMENT } from "../src/config/deployment";

const RPC = "https://rpc.testnet.fastnear.com";
const EXPLORER = "https://testnet.nearblocks.io/txns";
const provider = new JsonRpcProvider({ url: RPC });
const NEAR = BigInt(10) ** BigInt(24);
const TGAS = BigInt(10) ** BigInt(12);
const lending = TESTNET_DEPLOYMENT.lendingContractId;
const token = (symbol: string) => `${symbol.toLowerCase()}.${TESTNET_DEPLOYMENT.tokenSuffix}`;
const units = (whole: string, decimals: number) => (BigInt(whole) * BigInt(10) ** BigInt(decimals)).toString();

async function call(user: Account, contractId: string, methodName: string, args: Record<string, unknown>, deposit: bigint, gasTera = 100) {
  const outcome = await user.callFunctionRaw({ contractId, methodName, args, deposit, gas: BigInt(gasTera) * TGAS, waitUntil: "FINAL" });
  const receipts = (outcome as unknown as { receipts_outcome: { outcome: { status: Record<string, unknown> } }[] }).receipts_outcome;
  const failed = receipts.find((receipt) => "Failure" in receipt.outcome.status);
  if (failed || "Failure" in (outcome.status as unknown as Record<string, unknown>)) {
    throw new Error(`${contractId}.${methodName} failed: ${JSON.stringify(failed?.outcome.status ?? outcome.status)}`);
  }
  const hash = outcome.transaction.hash as string;
  console.log(`  ${methodName.padEnd(18)} ${contractId.split(".")[0].padEnd(8)} ${EXPLORER}/${hash}`);
  return hash;
}

async function main() {
  const userId = `radiri-user-${Math.random().toString(36).slice(2, 7)}.testnet`;
  const key = KeyPair.fromRandom("ed25519");
  const res = await fetch("https://helper.testnet.near.org/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: userId, newAccountPublicKey: key.getPublicKey().toString() }),
  });
  if (!res.ok) throw new Error(`faucet: HTTP ${res.status} ${await res.text()}`);
  for (let i = 0; i < 20; i += 1) {
    try {
      await provider.viewAccount({ accountId: userId });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  const user = new Account(userId, provider, new KeyPairSigner(key));
  console.log(`user ${userId} (faucet-funded)`);

  await call(user, lending, "storage_deposit", { account_id: userId }, NEAR / BigInt(10));

  console.log("Journey A: meme coin collateral -> borrow a tokenized stock");
  await call(user, token("tPEPE"), "mint", { account_id: userId, amount: units("2000000000", 18) }, NEAR / BigInt(100));
  await call(user, token("tPEPE"), "ft_transfer_call", { receiver_id: lending, amount: units("2000000000", 18), msg: JSON.stringify({ action: "deposit_collateral" }) }, BigInt(1), 300);
  await call(user, token("tAAPL"), "storage_deposit", { account_id: userId }, NEAR / BigInt(100));
  await call(user, lending, "borrow", { token_id: token("tAAPL"), amount: units("1", 8) }, BigInt(1), 300);

  console.log("Journey B: tokenized stock collateral -> borrow a meme coin");
  await call(user, token("tNVDA"), "mint", { account_id: userId, amount: units("25", 8) }, NEAR / BigInt(100));
  await call(user, token("tNVDA"), "ft_transfer_call", { receiver_id: lending, amount: units("25", 8), msg: JSON.stringify({ action: "deposit_collateral" }) }, BigInt(1), 300);
  await call(user, lending, "borrow", { token_id: token("tPEPE"), amount: units("10000000", 18) }, BigInt(1), 300);

  const account = await provider.callFunction({ contractId: lending, method: "get_account", args: { account_id: userId } });
  const balance = await provider.callFunction({ contractId: token("tAAPL"), method: "ft_balance_of", args: { account_id: userId } });
  console.log("on-chain position (get_account):");
  console.log(JSON.stringify(account, null, 2));
  console.log(`tAAPL wallet balance after borrowing: ${String(balance)} base units`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
