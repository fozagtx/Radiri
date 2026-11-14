import { LENDING_ASSETS } from "@/config/lending-assets";
import type { PriceSource } from "@/types/protocol";

/**
 * Staleness rules for price observations. Pure; client-safe.
 *
 * A price is fresh when its age (now - the time the SOURCE says it was produced) is at most the
 * max age configured for that symbol. Symbols mirrored by a lending asset use that asset's
 * `max_price_age_sec` (the same bound the contract enforces); anything else uses the source default.
 */

export const DEFAULT_MAX_AGE_SEC: Record<PriceSource, number> = {
  // 1Click refreshes /v0/tokens prices about once a minute.
  "1click": 300,
  "lending-oracle": 300,
};

/** Smallest max age among lending assets that mirror `symbol`, or null when none does. */
export function lendingMaxAgeFor(symbol: string): number | null {
  const wanted = symbol.trim().toUpperCase();
  const ages = LENDING_ASSETS.filter((spec) => spec.referenceSymbol.toUpperCase() === wanted).map(
    (spec) => spec.config.max_price_age_sec,
  );
  return ages.length ? Math.min(...ages) : null;
}

export function maxAgeFor(symbol: string, source: PriceSource): number {
  return lendingMaxAgeFor(symbol) ?? DEFAULT_MAX_AGE_SEC[source];
}

/** Whole seconds between `observedAt` and `nowMs`. A timestamp in the future counts as age 0. */
export function ageSeconds(observedAt: string | number | Date, nowMs: number = Date.now()): number {
  const at = observedAt instanceof Date ? observedAt.getTime() : typeof observedAt === "number" ? observedAt : Date.parse(observedAt);
  if (!Number.isFinite(at)) throw new Error(`invalid observation time: ${String(observedAt)}`);
  return Math.max(0, Math.floor((nowMs - at) / 1000));
}

export function isFresh(age: number, maxAgeSec: number): boolean {
  return Number.isFinite(age) && age >= 0 && age <= maxAgeSec;
}
