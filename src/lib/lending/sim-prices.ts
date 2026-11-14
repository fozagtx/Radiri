/**
 * Live reference prices for the simulation. `/api/pricing` (swap agent) returns observations for
 * the real assets each test token mirrors (1Click: meme coins, and Ondo tokenized stocks for equities). A missing
 * or stale observation leaves the test token without a fresh price, which blocks borrowing exactly
 * as the contract's oracle would.
 */

import type { OraclePrice, PriceObservation } from "@/types/protocol";
import { numberToWad } from "@/lib/risk";

export interface PricingResponse {
  observations: PriceObservation[];
  missing: { symbol: string; reason: string }[];
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/^\$/, "");
}

function isObservation(value: unknown): value is PriceObservation {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.symbol === "string" && typeof record.priceUsd === "number" && typeof record.observedAt === "string";
}

export function parsePricingResponse(body: unknown): PricingResponse {
  const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const observations = Array.isArray(record.observations) ? record.observations.filter(isObservation) : [];
  const missing = Array.isArray(record.missing)
    ? record.missing
        .filter((item): item is { symbol: string; reason: string } => {
          const entry = item as Record<string, unknown> | null;
          return !!entry && typeof entry.symbol === "string";
        })
        .map((item) => ({ symbol: item.symbol, reason: typeof item.reason === "string" ? item.reason : "no price" }))
    : [];
  return { observations, missing };
}

export async function fetchReferencePrices(symbols: string[], signal?: AbortSignal): Promise<PricingResponse> {
  const query = symbols.map((symbol) => encodeURIComponent(symbol)).join(",");
  let res: Response;
  try {
    res = await fetch(`/api/pricing?symbols=${query}`, { cache: "no-store", signal });
  } catch (error) {
    throw new Error(`/api/pricing unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string") detail = `${detail}: ${body.error}`;
    } catch {
      // keep the status line
    }
    throw new Error(`/api/pricing failed (${detail})`);
  }
  return parsePricingResponse(await res.json());
}

/** The freshest observation for a reference symbol ("PEPE", "$WIF", "AAPLon"). */
export function matchObservation(observations: PriceObservation[], referenceSymbol: string): PriceObservation | undefined {
  const exact = observations.filter((item) => item.symbol === referenceSymbol);
  const pool = exact.length ? exact : observations.filter((item) => normalizeSymbol(item.symbol) === normalizeSymbol(referenceSymbol));
  return pool.reduce<PriceObservation | undefined>(
    (best, item) => (!best || item.ageSeconds < best.ageSeconds ? item : best),
    undefined,
  );
}

/**
 * Oracle price for a test token from its reference observation. The timestamp is when the source
 * produced the price, so the contract's max_price_age_sec applies to the real age.
 */
export function observationToOraclePrice(observation: PriceObservation, fetchedAtMs: number): OraclePrice | null {
  if (!Number.isFinite(observation.priceUsd) || observation.priceUsd <= 0) return null;
  let priceWad: bigint;
  try {
    priceWad = numberToWad(observation.priceUsd);
  } catch {
    return null;
  }
  if (priceWad <= BigInt(0)) return null;
  const parsed = Date.parse(observation.observedAt);
  const timestampMs = Number.isFinite(parsed) ? parsed : fetchedAtMs - Math.max(0, observation.ageSeconds) * 1000;
  return { price_wad: priceWad.toString(), timestamp_ms: timestampMs };
}
