import type { OneClickTokenRow } from "@/config/assets";

/**
 * Picks the 1Click `/v0/tokens` row that prices a symbol. Pure; client-safe.
 * Several chains can list the same symbol: prefer a usable price (> 0, parseable priceUpdatedAt),
 * then the most recent update, then a stable chain order.
 */

const CHAIN_PREFERENCE = ["eth", "sol", "base", "near", "bsc", "arb", "op", "pol", "avax"];

function chainRank(chain: string): number {
  const index = CHAIN_PREFERENCE.indexOf(chain.toLowerCase());
  return index < 0 ? CHAIN_PREFERENCE.length : index;
}

function updatedMs(token: OneClickTokenRow): number {
  const ms = token.priceUpdatedAt ? Date.parse(token.priceUpdatedAt) : NaN;
  return Number.isFinite(ms) ? ms : -1;
}

export function hasUsablePrice(token: OneClickTokenRow): boolean {
  return typeof token.price === "number" && Number.isFinite(token.price) && token.price > 0 && updatedMs(token) > 0;
}

/** Rows whose symbol matches (case-insensitive), also accepting "WIF" for "$WIF". Deprecated rows excluded. */
export function rowsForSymbol(tokens: OneClickTokenRow[], symbol: string): OneClickTokenRow[] {
  const wanted = symbol.trim().toUpperCase();
  const candidates = new Set([wanted, wanted.startsWith("$") ? wanted.slice(1) : `$${wanted}`]);
  const exact = tokens.filter((token) => token.symbol.toUpperCase() === wanted && !/\(deprecated\)/i.test(token.symbol));
  if (exact.length) return exact;
  return tokens.filter((token) => candidates.has(token.symbol.toUpperCase()) && !/\(deprecated\)/i.test(token.symbol));
}

export function pickPricedRow(tokens: OneClickTokenRow[], symbol: string): OneClickTokenRow | null {
  const rows = rowsForSymbol(tokens, symbol).filter(hasUsablePrice);
  rows.sort((a, b) => updatedMs(b) - updatedMs(a) || chainRank(a.blockchain) - chainRank(b.blockchain));
  return rows[0] ?? null;
}
