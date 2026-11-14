import "server-only";

import { pythToDecimalString } from "./wad";

/**
 * Pyth Hermes client for US equity prices.
 *
 * Feed ids are DISCOVERED, never hard-coded: `GET /v2/price_feeds?query=<SYM>&asset_type=equity`,
 * keeping the feed whose attribute `symbol` is exactly `Equity.US.<SYM>/USD` (regular-hours US
 * equity feed; the `Equity.Index.*` 24/7 variants are gated behind the "pyth-indices" group).
 * Latest prices: `GET /v2/updates/price/latest?ids[]=…&parsed=true`.
 *
 * As of 2026-11-13 Hermes requires an API key for price updates: anonymous requests get HTTP 401
 * "unauthorized". Set PYTH_HERMES_API_KEY (server-side only) to send it as a Bearer token.
 */

const DEFAULT_HERMES_URL = "https://hermes.pyth.network";
const TIMEOUT_MS = 12_000;
const FEED_CACHE_MS = 24 * 60 * 60_000;

export function hermesBaseUrl(): string {
  return (process.env.PYTH_HERMES_URL?.trim() || DEFAULT_HERMES_URL).replace(/\/+$/, "");
}

function hermesHeaders(): Record<string, string> {
  const key = process.env.PYTH_HERMES_API_KEY?.trim();
  return { Accept: "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

export interface PythFeed {
  id: string;
  symbol: string;
  description: string;
}

interface FeedAttributes {
  symbol?: string;
  description?: string;
  asset_type?: string;
}

const feedCache = new Map<string, { at: number; feed: PythFeed | null }>();

async function hermesError(res: Response): Promise<string> {
  const body = (await res.text()).trim().slice(0, 300);
  const hint =
    res.status === 401 && !process.env.PYTH_HERMES_API_KEY?.trim()
      ? " (Hermes requires an API key for price updates; set PYTH_HERMES_API_KEY on the server)"
      : "";
  return `Pyth Hermes HTTP ${res.status}: ${body || res.statusText}${hint}`;
}

/** Finds the `Equity.US.<SYM>/USD` feed for a ticker, or null when Hermes lists none. */
export async function findEquityFeed(ticker: string): Promise<PythFeed | null> {
  const symbol = ticker.trim().toUpperCase();
  const cached = feedCache.get(symbol);
  if (cached && Date.now() - cached.at < FEED_CACHE_MS) return cached.feed;

  const url = new URL(`${hermesBaseUrl()}/v2/price_feeds`);
  url.searchParams.set("query", symbol);
  url.searchParams.set("asset_type", "equity");
  const res = await fetch(url, { cache: "no-store", headers: hermesHeaders(), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(await hermesError(res));
  const feeds = (await res.json()) as { id: string; attributes?: FeedAttributes }[];
  const wanted = `Equity.US.${symbol}/USD`;
  const match = Array.isArray(feeds) ? feeds.find((feed) => feed.attributes?.symbol === wanted) : undefined;
  const feed = match ? { id: match.id, symbol: wanted, description: match.attributes?.description ?? wanted } : null;
  feedCache.set(symbol, { at: Date.now(), feed });
  return feed;
}

export interface PythLatestPrice {
  id: string;
  /** Exact decimal USD price. */
  priceDecimal: string;
  publishTimeMs: number;
}

interface ParsedUpdate {
  id: string;
  price?: { price?: string; expo?: number; publish_time?: number };
}

/** Latest parsed prices for feed ids. Throws with the verbatim Hermes reason on HTTP errors. */
export async function fetchLatestPrices(ids: string[]): Promise<Map<string, PythLatestPrice>> {
  const out = new Map<string, PythLatestPrice>();
  if (ids.length === 0) return out;
  const url = new URL(`${hermesBaseUrl()}/v2/updates/price/latest`);
  for (const id of ids) url.searchParams.append("ids[]", id);
  url.searchParams.set("parsed", "true");
  url.searchParams.set("encoding", "hex");
  const res = await fetch(url, { cache: "no-store", headers: hermesHeaders(), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(await hermesError(res));
  const body = (await res.json()) as { parsed?: ParsedUpdate[] };
  for (const update of body.parsed ?? []) {
    const price = update.price;
    if (!price || typeof price.price !== "string" || typeof price.expo !== "number" || typeof price.publish_time !== "number") {
      continue;
    }
    out.set(update.id.replace(/^0x/, "").toLowerCase(), {
      id: update.id,
      priceDecimal: pythToDecimalString(price.price, price.expo),
      publishTimeMs: price.publish_time * 1000,
    });
  }
  return out;
}
