/**
 * Radiri oracle reporter: reads the lending contract's assets (or the LENDING_ASSETS table), fetches
 * each asset's reference price through src/lib/oracle (1Click /v0/tokens: meme coins by symbol, Ondo
 * tokenized stocks such as AAPLon for equities), converts it to `price_wad` (USD per whole token x 1e18,
 * exact decimal-string math) and calls `report_prices({ prices: [{ token_id, price_wad }] })`.
 *
 * Usage:
 *   pnpm oracle:push            sign and submit (needs the env below)
 *   pnpm oracle:push --dry-run  print the payload, submit nothing (no key needed)
 *
 * Env (.env.local or .env): RADIRI_ORACLE_ACCOUNT, RADIRI_ORACLE_PRIVATE_KEY (a function-call key limited to
 * report_prices on the lending contract), NEXT_PUBLIC_LENDING_CONTRACT_ID, optional NEXT_PUBLIC_NEAR_NETWORK
 * (default testnet), NEXT_PUBLIC_NEAR_RPC_URL.
 *
 * Stale or missing references are skipped with a printed reason; a price that moves more than the
 * asset's max_price_change_bps against a fresh on-chain price is skipped too (the contract would reject
 * it; the owner must use force_price).
 */
import { existsSync, readFileSync } from "node:fs";
import { Account, JsonRpcProvider, KeyPairSigner, type KeyPairString } from "near-api-js";
import { lendingAssetByTokenId, LENDING_ASSETS } from "../src/config/lending-assets";
import { collectPrices } from "../src/lib/oracle";
import { decimalToPriceWad } from "../src/lib/oracle/wad";
import type { AssetView } from "../src/types/protocol";

const GAS = BigInt(100_000_000_000_000);

interface Target {
  tokenId: string;
  symbol: string;
  referenceSymbol: string | null;
  maxPriceAgeSec: number;
  maxPriceChangeBps: number;
  /** Fresh on-chain price, for the deviation pre-check. */
  currentPriceWad: string | null;
}

interface PriceReport {
  token_id: string;
  price_wad: string;
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
    throw new Error("RADIRI_ORACLE_PRIVATE_KEY must be a curve-prefixed secret key such as ed25519:...");
  }
  return secret as KeyPairString;
}

/** |next - previous| / previous in basis points, exact bigint math (rounded down). */
function deviationBps(previousWad: string, nextWad: string): bigint {
  const previous = BigInt(previousWad);
  const next = BigInt(nextWad);
  if (previous === BigInt(0)) return BigInt(0);
  const diff = next > previous ? next - previous : previous - next;
  return (diff * BigInt(10_000)) / previous;
}

function targetsFromTable(): Target[] {
  return LENDING_ASSETS.map((spec) => ({
    tokenId: spec.config.token_id,
    symbol: spec.config.symbol,
    referenceSymbol: spec.referenceSymbol,
    maxPriceAgeSec: spec.config.max_price_age_sec,
    maxPriceChangeBps: spec.config.max_price_change_bps,
    currentPriceWad: null,
  }));
}

function targetsFromContract(views: AssetView[]): Target[] {
  return views.map((view) => ({
    tokenId: view.config.token_id,
    symbol: view.config.symbol,
    referenceSymbol: lendingAssetByTokenId(view.config.token_id)?.referenceSymbol ?? null,
    maxPriceAgeSec: view.config.max_price_age_sec,
    maxPriceChangeBps: view.config.max_price_change_bps,
    currentPriceWad: view.price && view.price_fresh ? view.price.price_wad : null,
  }));
}

async function main(): Promise<void> {
  loadEnv([".env.local", ".env"]);
  const dryRun = process.argv.includes("--dry-run");

  const reporter = process.env.RADIRI_ORACLE_ACCOUNT?.trim();
  const secret = process.env.RADIRI_ORACLE_PRIVATE_KEY?.trim();
  const contractId = process.env.NEXT_PUBLIC_LENDING_CONTRACT_ID?.trim();
  const network = process.env.NEXT_PUBLIC_NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet";
  const rpcUrl =
    process.env.NEXT_PUBLIC_NEAR_RPC_URL?.trim() ||
    (network === "mainnet" ? "https://rpc.mainnet.fastnear.com" : "https://rpc.testnet.fastnear.com");
  const explorerUrl = network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";

  const missing = [
    reporter ? null : "RADIRI_ORACLE_ACCOUNT",
    secret ? null : "RADIRI_ORACLE_PRIVATE_KEY",
    contractId ? null : "NEXT_PUBLIC_LENDING_CONTRACT_ID",
  ].filter((name): name is string => name !== null);

  if (!dryRun && missing.length > 0) {
    console.error(`oracle:push: missing ${missing.join(", ")}.`);
    console.error(
      "oracle:push: set them in .env.local (the key must be a function-call key limited to report_prices). Nothing was submitted.",
    );
    console.error("oracle:push: run with --dry-run to print the payload without signing.");
    process.exitCode = 1;
    return;
  }

  const provider = new JsonRpcProvider({ url: rpcUrl });
  let targets: Target[];
  if (contractId) {
    const views = (await provider.callFunction({ contractId, method: "get_assets", args: {} })) as unknown as AssetView[] | undefined;
    if (!Array.isArray(views)) throw new Error(`${contractId}.get_assets returned no asset list`);
    targets = targetsFromContract(views);
    console.log(`oracle:push: ${network} / ${contractId} / ${targets.length} registered assets${dryRun ? " / dry run" : ""}`);
  } else {
    targets = targetsFromTable();
    console.log(
      `oracle:push: no NEXT_PUBLIC_LENDING_CONTRACT_ID, using the LENDING_ASSETS table (${targets.length} assets) / dry run`,
    );
  }

  const references = [...new Set(targets.map((target) => target.referenceSymbol).filter((symbol): symbol is string => Boolean(symbol)))];
  const { quotes, missing: missingPrices } = await collectPrices(references);
  const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol.toUpperCase(), quote]));
  const missingBySymbol = new Map(missingPrices.map((item) => [item.symbol.toUpperCase(), item.reason]));

  const prices: PriceReport[] = [];
  for (const target of targets) {
    const label = `${target.symbol.padEnd(8)} ${target.tokenId}`;
    if (!target.referenceSymbol) {
      console.log(`  skip ${label}: no reference symbol known (not in LENDING_ASSETS)`);
      continue;
    }
    const quote = quoteBySymbol.get(target.referenceSymbol.toUpperCase());
    if (!quote) {
      const reason = missingBySymbol.get(target.referenceSymbol.toUpperCase()) ?? "no price returned";
      console.log(`  skip ${label}: ${target.referenceSymbol} missing (${reason})`);
      continue;
    }
    if (quote.ageSeconds > target.maxPriceAgeSec) {
      console.log(
        `  skip ${label}: ${target.referenceSymbol} is stale (${quote.ageSeconds}s old from ${quote.source}, max ${target.maxPriceAgeSec}s)`,
      );
      continue;
    }
    let priceWad: string;
    try {
      priceWad = decimalToPriceWad(quote.priceDecimal);
    } catch (error) {
      console.log(`  skip ${label}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (target.currentPriceWad) {
      const moved = deviationBps(target.currentPriceWad, priceWad);
      if (moved > BigInt(target.maxPriceChangeBps)) {
        console.log(
          `  skip ${label}: moves ${moved} bps vs the fresh on-chain price (max ${target.maxPriceChangeBps}); the owner must force_price`,
        );
        continue;
      }
    }
    prices.push({ token_id: target.tokenId, price_wad: priceWad });
    console.log(
      `  ok   ${label}: ${target.referenceSymbol} $${quote.priceDecimal} via ${quote.source} (${quote.ageSeconds}s old) -> price_wad ${priceWad}`,
    );
  }

  if (dryRun) {
    console.log("oracle:push: dry run, payload for report_prices (not submitted):");
    console.log(JSON.stringify({ prices }, null, 2));
    if (missing.length > 0) console.log(`oracle:push: a real push would also need ${missing.join(", ")}.`);
    return;
  }

  if (prices.length === 0) {
    console.error("oracle:push: nothing to report (every reference was missing or stale). Nothing was submitted.");
    process.exitCode = 1;
    return;
  }
  if (!reporter || !secret || !contractId) {
    process.exitCode = 1;
    return;
  }

  const signer = KeyPairSigner.fromSecretKey(toKeyPairString(secret));
  const account = new Account(reporter, provider, signer);
  const outcome = await account.callFunctionRaw({
    contractId,
    methodName: "report_prices",
    args: { prices },
    gas: GAS,
    deposit: BigInt(0),
    waitUntil: "FINAL",
  });
  const hash = outcome.transaction?.hash ?? "";
  const status = outcome.status as unknown as Record<string, unknown> | undefined;
  if (status && typeof status === "object" && "Failure" in status) {
    console.error(`oracle:push: report_prices failed: ${JSON.stringify(status.Failure)}`);
    if (hash) console.error(`oracle:push: ${explorerUrl}/txns/${hash}`);
    process.exitCode = 1;
    return;
  }
  console.log(`oracle:push: reported ${prices.length} prices in ${hash || "(hash unavailable)"}`);
  if (hash) console.log(`oracle:push: ${explorerUrl}/txns/${hash}`);
}

main().catch((error: unknown) => {
  console.error(`oracle:push: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
