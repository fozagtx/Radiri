/**
 * Price freshness, as the contract defines it: a price is fresh when it exists, is > 0 and
 * `now - timestamp <= max_price_age_sec` of that asset. Stale prices never authorise a borrow,
 * a collateral withdrawal against debt, or a liquidation.
 */

import type { OraclePrice } from "@/types/protocol";
import { u128, ZERO } from "./fixed";

export type PriceStatus = "fresh" | "stale" | "missing" | "zero";

export interface PriceCheck {
  status: PriceStatus;
  fresh: boolean;
  /** Milliseconds since the price timestamp, null when there is no price. Never negative. */
  ageMs: number | null;
  maxAgeMs: number;
}

export function priceAgeMs(price: OraclePrice | null, nowMs: number): number | null {
  if (!price) return null;
  return Math.max(0, Math.trunc(nowMs) - Math.trunc(price.timestamp_ms));
}

export function checkPrice(price: OraclePrice | null, maxPriceAgeSec: number, nowMs: number): PriceCheck {
  const maxAgeMs = Math.max(0, Math.trunc(maxPriceAgeSec)) * 1_000;
  if (!price) return { status: "missing", fresh: false, ageMs: null, maxAgeMs };
  const ageMs = priceAgeMs(price, nowMs) ?? 0;
  let wad: bigint;
  try {
    wad = u128(price.price_wad, "price_wad");
  } catch {
    return { status: "zero", fresh: false, ageMs, maxAgeMs };
  }
  if (wad === ZERO) return { status: "zero", fresh: false, ageMs, maxAgeMs };
  if (ageMs > maxAgeMs) return { status: "stale", fresh: false, ageMs, maxAgeMs };
  return { status: "fresh", fresh: true, ageMs, maxAgeMs };
}

export function isPriceFresh(price: OraclePrice | null, maxPriceAgeSec: number, nowMs: number): boolean {
  return checkPrice(price, maxPriceAgeSec, nowMs).fresh;
}
