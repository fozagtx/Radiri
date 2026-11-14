import "server-only";

import { Account, JsonRpcProvider, KeyPairSigner, type KeyPairString } from "near-api-js";
import { lendingAssetByTokenId } from "@/config/lending-assets";
import { LENDING_CONTRACT_ID, RPC_URL } from "@/lib/config";
import type { AssetView } from "@/types/protocol";
import { collectPrices } from "./index";
import { decimalToPriceWad } from "./wad";

/**
 * Pushes live 1Click reference prices to the lending contract's oracle with the reporter's
 * function-call key (it can only call report_prices). Used by `pnpm oracle:push` and by
 * POST /api/oracle/refresh, which the app calls when the on-chain prices have gone stale.
 */

const GAS = BigInt(100_000_000_000_000);
/** Skip the push when every on-chain price is younger than this. */
const MIN_INTERVAL_MS = 45_000;

export interface PushLine {
  symbol: string;
  tokenId: string;
  status: "reported" | "skipped";
  detail: string;
}

export interface PushResult {
  submitted: boolean;
  reason: string;
  txHash: string | null;
  lines: PushLine[];
}

function deviationBps(previousWad: string, nextWad: string): bigint {
  const previous = BigInt(previousWad);
  const next = BigInt(nextWad);
  if (previous === BigInt(0)) return BigInt(0);
  const diff = next > previous ? next - previous : previous - next;
  return (diff * BigInt(10_000)) / previous;
}

export function oracleReporterConfigured(): boolean {
  return Boolean(process.env.RADIRI_ORACLE_ACCOUNT?.trim() && process.env.RADIRI_ORACLE_PRIVATE_KEY?.trim());
}

let inflight: Promise<PushResult> | null = null;

export function pushOraclePrices(options: { force?: boolean; dryRun?: boolean } = {}): Promise<PushResult> {
  if (!inflight) {
    inflight = run(options).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function run({ force = false, dryRun = false }: { force?: boolean; dryRun?: boolean }): Promise<PushResult> {
  const reporter = process.env.RADIRI_ORACLE_ACCOUNT?.trim();
  const secret = process.env.RADIRI_ORACLE_PRIVATE_KEY?.trim();
  if (!dryRun && (!reporter || !secret)) {
    return { submitted: false, reason: "oracle reporter not configured (RADIRI_ORACLE_ACCOUNT / RADIRI_ORACLE_PRIVATE_KEY)", txHash: null, lines: [] };
  }

  const provider = new JsonRpcProvider({ url: RPC_URL });
  const views = (await provider.callFunction({ contractId: LENDING_CONTRACT_ID, method: "get_assets", args: {} })) as unknown as AssetView[] | undefined;
  if (!Array.isArray(views)) throw new Error(`${LENDING_CONTRACT_ID}.get_assets returned no asset list`);

  const now = Date.now();
  const youngest = Math.min(...views.map((view) => (view.price ? now - view.price.timestamp_ms : Number.POSITIVE_INFINITY)));
  if (!force && Number.isFinite(youngest) && views.every((view) => view.price_fresh) && youngest < MIN_INTERVAL_MS) {
    return { submitted: false, reason: "prices are already fresh", txHash: null, lines: [] };
  }

  const references = views.map((view) => lendingAssetByTokenId(view.config.token_id)?.referenceSymbol).filter((symbol): symbol is string => Boolean(symbol));
  const { quotes, missing } = await collectPrices([...new Set(references)]);
  const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol.toUpperCase(), quote]));
  const missingBySymbol = new Map(missing.map((item) => [item.symbol.toUpperCase(), item.reason]));

  const lines: PushLine[] = [];
  const prices: { token_id: string; price_wad: string }[] = [];
  for (const view of views) {
    const tokenId = view.config.token_id;
    const symbol = view.config.symbol;
    const reference = lendingAssetByTokenId(tokenId)?.referenceSymbol;
    if (!reference) {
      lines.push({ symbol, tokenId, status: "skipped", detail: "no reference asset known" });
      continue;
    }
    const quote = quoteBySymbol.get(reference.toUpperCase());
    if (!quote) {
      lines.push({ symbol, tokenId, status: "skipped", detail: `${reference}: ${missingBySymbol.get(reference.toUpperCase()) ?? "no price"}` });
      continue;
    }
    if (quote.ageSeconds > view.config.max_price_age_sec) {
      lines.push({ symbol, tokenId, status: "skipped", detail: `${reference} price is ${quote.ageSeconds}s old (max ${view.config.max_price_age_sec}s)` });
      continue;
    }
    const priceWad = decimalToPriceWad(quote.priceDecimal);
    if (view.price && view.price_fresh && deviationBps(view.price.price_wad, priceWad) > BigInt(view.config.max_price_change_bps)) {
      lines.push({ symbol, tokenId, status: "skipped", detail: `${reference} moved more than ${view.config.max_price_change_bps} bps; owner must force_price` });
      continue;
    }
    prices.push({ token_id: tokenId, price_wad: priceWad });
    lines.push({ symbol, tokenId, status: "reported", detail: `${reference} $${quote.priceDecimal} (${quote.ageSeconds}s old) -> ${priceWad}` });
  }

  if (prices.length === 0) return { submitted: false, reason: "no fresh reference price to report", txHash: null, lines };
  if (dryRun || !reporter || !secret) return { submitted: false, reason: "dry run", txHash: null, lines };

  const account = new Account(reporter, provider, KeyPairSigner.fromSecretKey(secret as KeyPairString));
  const outcome = await account.callFunctionRaw({
    contractId: LENDING_CONTRACT_ID,
    methodName: "report_prices",
    args: { prices },
    gas: GAS,
    deposit: BigInt(0),
    waitUntil: "FINAL",
  });
  const status = outcome.status as unknown as Record<string, unknown> | undefined;
  if (status && typeof status === "object" && "Failure" in status) {
    throw new Error(`report_prices failed: ${JSON.stringify(status.Failure)}`);
  }
  return { submitted: true, reason: `reported ${prices.length} prices`, txHash: outcome.transaction?.hash ?? null, lines };
}
