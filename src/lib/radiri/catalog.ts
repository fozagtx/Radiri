import type { Chain, StableAsset } from "./types";

const ONECLICK_API = "https://1click.chaindefuser.com/v0";
const CACHE_TTL_MS = 5 * 60_000;
const TOKEN_TIMEOUT_MS = 15_000;

/**
 * Symbols treated as stablecoins. Rows are never synthesized: every returned
 * asset is a live row from 1Click `/tokens` that matches this set.
 */
const STABLE_SYMBOLS = new Set([
  "USDC",
  "USDT",
  "DAI",
  "USDS",
  "SUSDS",
  "USDE",
  "SUSDE",
  "USD1",
  "USDG",
  "PYUSD",
  "FRAX",
  "TUSD",
  "USDD",
  "RLUSD",
  "EURC",
  "GHO",
  "LUSD",
  "CRVUSD",
  "FDUSD",
  "USDP",
  "USDBC",
  "USDT0",
  "SDAI",
  "ALUSD",
  "MIM",
  "DOLA",
  "USDY",
  "USD0",
]);

/** Raw row from `GET /v0/tokens`. */
interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: Chain;
  symbol: string;
  price?: number | null;
  priceUpdatedAt?: string;
  contractAddress?: string | null;
  coingeckoId?: string | null;
}

export interface CatalogSnapshot {
  assets: StableAsset[];
  fetchedAt: string;
}

let cache: { at: number; snapshot: CatalogSnapshot } | null = null;
let inflight: Promise<CatalogSnapshot> | null = null;

function toStableAsset(token: OneClickToken): StableAsset {
  return {
    assetId: token.assetId,
    symbol: token.symbol,
    chain: token.blockchain,
    decimals: token.decimals,
    priceUsd: typeof token.price === "number" && Number.isFinite(token.price) ? token.price : null,
    contractAddress: token.contractAddress ?? null,
  };
}

function isStable(token: OneClickToken): boolean {
  return (
    typeof token.assetId === "string" &&
    typeof token.symbol === "string" &&
    STABLE_SYMBOLS.has(token.symbol.toUpperCase()) &&
    Number.isInteger(token.decimals)
  );
}

function compareAssets(a: StableAsset, b: StableAsset): number {
  return a.symbol.localeCompare(b.symbol) || a.chain.localeCompare(b.chain) || a.assetId.localeCompare(b.assetId);
}

async function fetchTokens(): Promise<OneClickToken[]> {
  const res = await fetch(`${ONECLICK_API}/tokens`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`1Click /tokens failed with HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const payload: unknown = await res.json();
  if (!Array.isArray(payload)) throw new Error("1Click /tokens returned an unexpected payload (expected an array)");
  return payload as OneClickToken[];
}

/** Live stablecoin catalog, cached in-process for `CACHE_TTL_MS`. */
export async function getCatalog(force = false): Promise<CatalogSnapshot> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.snapshot;
  if (inflight) return inflight;
  const pending = (async () => {
    try {
      const tokens = await fetchTokens();
      const assets = tokens.filter(isStable).map(toStableAsset).sort(compareAssets);
      const snapshot: CatalogSnapshot = { assets, fetchedAt: new Date().toISOString() };
      cache = { at: Date.now(), snapshot };
      return snapshot;
    } finally {
      inflight = null;
    }
  })();
  inflight = pending;
  return pending;
}

export async function getStableAssets(): Promise<StableAsset[]> {
  const { assets } = await getCatalog();
  return assets;
}

export async function findAsset(symbol: string, chain: Chain): Promise<StableAsset | null> {
  const assets = await getStableAssets();
  const wantSymbol = symbol.trim().toUpperCase();
  const wantChain = chain.trim().toLowerCase();
  return assets.find((asset) => asset.symbol.toUpperCase() === wantSymbol && asset.chain.toLowerCase() === wantChain) ?? null;
}

/** `"USDC" + "eth"` -> `"USDC:eth"`. */
export function assetLabel(asset: Pick<StableAsset, "symbol" | "chain">): string {
  return `${asset.symbol}:${asset.chain}`;
}

/** Human units -> integer string in the token's smallest unit. */
export function toBaseUnits(human: number, decimals: number): string {
  if (!Number.isFinite(human) || human <= 0) throw new Error(`Invalid amount: ${human}`);
  const [whole, fraction = ""] = human.toFixed(Math.min(decimals, 18)).split(".");
  const padded = fraction.padEnd(decimals, "0").slice(0, decimals);
  return (BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(padded || "0")).toString();
}

/** Integer string in the token's smallest unit -> human units. */
export function fromBaseUnits(base: string | bigint, decimals: number): number {
  const raw = base.toString().trim();
  if (!/^-?\d+$/.test(raw)) throw new Error(`Invalid base-unit amount: ${base}`);
  const negative = raw.startsWith("-");
  const digits = (negative ? raw.slice(1) : raw).padStart(decimals + 1, "0");
  const cut = digits.length - decimals;
  const human = Number(`${digits.slice(0, cut)}.${digits.slice(cut)}`);
  return negative ? -human : human;
}
