/**
 * Radiri monitor: quotes a fixed set of stablecoin pairs through every source and
 * records the results on the Radiri contract as the reporter account.
 *
 * Usage: pnpm monitor   (needs RADIRI_REPORTER_ACCOUNT, RADIRI_REPORTER_PRIVATE_KEY
 * and NEXT_PUBLIC_CONTRACT_ID; the key must be a function-call key limited to
 * `record_snapshots`).
 */
import { existsSync, readFileSync } from "node:fs";
import { Account, JsonRpcProvider, KeyPairSigner, type KeyPairString } from "near-api-js";
import { findAsset } from "../src/lib/radiri/catalog";
import { compareRoutes, pairId } from "../src/lib/radiri/engine";
import type { OnchainSnapshot, PairRef, RouteSource } from "../src/lib/radiri/types";

const AMOUNT = 10_000;
const SLIPPAGE_BPS = 50;
const GAS = 150_000_000_000_000n;
const MAX_BATCH = 50;

const PAIRS: { from: PairRef; to: PairRef }[] = [
  { from: { symbol: "USDC", chain: "near" }, to: { symbol: "USDT", chain: "near" } },
  { from: { symbol: "USDC", chain: "eth" }, to: { symbol: "USDT", chain: "eth" } },
  { from: { symbol: "USDC", chain: "sol" }, to: { symbol: "USDT", chain: "eth" } },
  { from: { symbol: "USDC", chain: "arb" }, to: { symbol: "USDC", chain: "base" } },
  { from: { symbol: "USDC", chain: "near" }, to: { symbol: "USDT", chain: "eth" } },
];

interface SnapshotInput {
  pair_id: string;
  source: RouteSource;
  amount_in_usd: number;
  cost_bps: number;
  eta_s: number | null;
  status: OnchainSnapshot["status"];
}

function loadEnv(files: string[]): void {
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const key = match[1];
      if (process.env[key] !== undefined) continue;
      process.env[key] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

function toKeyPairString(secret: string): KeyPairString {
  if (!/^(ed25519|secp256k1|ml-dsa-65):[1-9A-HJ-NP-Za-km-z]+$/.test(secret)) {
    throw new Error("RADIRI_REPORTER_PRIVATE_KEY must be a curve-prefixed secret key such as ed25519:...");
  }
  return secret as KeyPairString;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main(): Promise<void> {
  loadEnv([".env.local", ".env"]);

  const reporter = process.env.RADIRI_REPORTER_ACCOUNT?.trim();
  const secret = process.env.RADIRI_REPORTER_PRIVATE_KEY?.trim();
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID?.trim();

  const missing = [
    reporter ? null : "RADIRI_REPORTER_ACCOUNT",
    secret ? null : "RADIRI_REPORTER_PRIVATE_KEY",
    contractId ? null : "NEXT_PUBLIC_CONTRACT_ID",
  ].filter((name): name is string => name !== null);

  if (missing.length > 0) {
    console.error(`monitor: missing ${missing.join(", ")}.`);
    console.error("monitor: set them in .env.local (reporter key = function-call key limited to record_snapshots). Nothing was submitted.");
    process.exitCode = 1;
    return;
  }
  if (!reporter || !secret || !contractId) {
    process.exitCode = 1;
    return;
  }

  const network = process.env.NEXT_PUBLIC_NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet";
  const rpcUrl =
    process.env.NEXT_PUBLIC_NEAR_RPC_URL?.trim() ||
    (network === "mainnet" ? "https://rpc.mainnet.fastnear.com" : "https://rpc.testnet.fastnear.com");
  const explorerUrl = network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";

  console.log(`monitor: ${network} / ${contractId} / reporter ${reporter} / ${PAIRS.length} pairs / ${AMOUNT} per pair`);

  const snapshots: SnapshotInput[] = [];
  for (const pair of PAIRS) {
    const fromAsset = await findAsset(pair.from.symbol, pair.from.chain);
    if (!fromAsset) {
      console.warn(`monitor: ${pair.from.symbol}:${pair.from.chain} is not in the live catalog, skipping ${pairId(pair.from, pair.to)}`);
      continue;
    }
    if (fromAsset.priceUsd === null) {
      console.warn(`monitor: no USD price for ${pair.from.symbol}:${pair.from.chain}, skipping ${pairId(pair.from, pair.to)}`);
      continue;
    }
    const amountInUsd = Math.round(AMOUNT * fromAsset.priceUsd);
    const id = pairId(pair.from, pair.to);

    const compare = await compareRoutes({ from: pair.from, to: pair.to, amount: AMOUNT, slippageBps: SLIPPAGE_BPS });

    for (const route of compare.routes) {
      snapshots.push({
        pair_id: id,
        source: route.source,
        amount_in_usd: amountInUsd,
        cost_bps: Math.round(route.costBps),
        eta_s: route.etaSeconds === null ? null : Math.max(0, Math.round(route.etaSeconds)),
        status: "ok",
      });
      console.log(
        `  ${id.padEnd(24)} ${route.source.padEnd(12)} ok            out ${route.amountOut.toFixed(4)} ${route.to.symbol}  ${route.costBps.toFixed(2)} bps`,
      );
    }

    for (const failed of compare.failures) {
      snapshots.push({
        pair_id: id,
        source: failed.source,
        amount_in_usd: amountInUsd,
        cost_bps: 0,
        eta_s: null,
        status: failed.kind === "no-liquidity" ? "no_liquidity" : "error",
      });
      console.log(`  ${id.padEnd(24)} ${failed.source.padEnd(12)} ${failed.kind.padEnd(13)} ${failed.reason}`);
    }
  }

  if (snapshots.length === 0) {
    console.error("monitor: nothing to record (no pair produced a quote or a failure).");
    process.exitCode = 1;
    return;
  }

  const signer = KeyPairSigner.fromSecretKey(toKeyPairString(secret));
  const account = new Account(reporter, new JsonRpcProvider({ url: rpcUrl }), signer);

  for (const batch of chunks(snapshots, MAX_BATCH)) {
    const outcome = await account.callFunctionRaw({
      contractId,
      methodName: "record_snapshots",
      args: { snapshots: batch },
      gas: GAS,
      deposit: 0n,
      waitUntil: "FINAL",
    });
    const hash = outcome.transaction?.hash ?? "";
    console.log(`monitor: recorded ${batch.length} snapshots in ${hash || "(hash unavailable)"}`);
    if (hash) console.log(`monitor: ${explorerUrl}/txns/${hash}`);
  }

  console.log(`monitor: done, ${snapshots.length} snapshots submitted.`);
}

main().catch((error: unknown) => {
  console.error(`monitor: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
