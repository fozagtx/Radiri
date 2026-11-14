import "server-only";

import type { OneClickTokenRow } from "@/config/assets";
import { fetchOneClickTokens } from "./client";

/**
 * In-process cache of the live 1Click catalog (`/v0/tokens?ondoTokens=true`). Every row is a live
 * 1Click row; nothing is synthesized. Prices carry their own `priceUpdatedAt`, so consumers judge
 * freshness from that, not from this cache.
 */

const CACHE_TTL_MS = 60_000;

export interface TokenSnapshot {
  tokens: OneClickTokenRow[];
  fetchedAt: string;
}

let cache: { at: number; snapshot: TokenSnapshot } | null = null;
let inflight: Promise<TokenSnapshot> | null = null;

export async function getOneClickTokens(force = false): Promise<TokenSnapshot> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.snapshot;
  if (inflight) return inflight;
  const pending = (async () => {
    try {
      const raw = await fetchOneClickTokens();
      const tokens: OneClickTokenRow[] = raw
        .filter((row) => row && typeof row.assetId === "string" && typeof row.symbol === "string")
        .map((row) => ({
          assetId: row.assetId,
          decimals: row.decimals,
          blockchain: String(row.blockchain),
          symbol: row.symbol,
          price: typeof row.price === "number" ? row.price : null,
          priceUpdatedAt: row.priceUpdatedAt ?? null,
          contractAddress: row.contractAddress ?? null,
          coingeckoId: row.coingeckoId ?? null,
        }));
      const snapshot: TokenSnapshot = { tokens, fetchedAt: new Date().toISOString() };
      cache = { at: Date.now(), snapshot };
      return snapshot;
    } finally {
      inflight = null;
    }
  })();
  inflight = pending;
  return pending;
}
