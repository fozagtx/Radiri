/**
 * Display helpers. These convert exact values into strings and bands for the UI; nothing here
 * feeds back into settlement math.
 */

import { WAD, ZERO } from "./fixed";
import { formatUnits, groupDecimal, wadToNumber } from "./units";

export type HealthBand = "none" | "safe" | "warn" | "danger" | "liquidatable";

const HF_SAFE = (WAD * BigInt(150)) / BigInt(100);
const HF_WARN = (WAD * BigInt(110)) / BigInt(100);

/**
 * Health-factor bands: >= 1.5 safe, 1.1-1.5 warn, < 1.1 danger, < 1 liquidatable.
 * `null` (no debt) is "none". Exactly 1.0 is "danger", not liquidatable (the contract
 * liquidates only when debt > threshold).
 */
export function healthBand(healthFactorWad: bigint | null): HealthBand {
  if (healthFactorWad === null) return "none";
  if (healthFactorWad < WAD) return "liquidatable";
  if (healthFactorWad < HF_WARN) return "danger";
  if (healthFactorWad < HF_SAFE) return "warn";
  return "safe";
}

export const HEALTH_BAND_LABEL: Record<HealthBand, string> = {
  none: "No debt",
  safe: "Safe",
  warn: "Watch",
  danger: "At risk",
  liquidatable: "Liquidatable",
};

/** "1.53", "∞" for no debt, "> 1,000" for huge values. Truncates, never rounds up. */
export function formatHealthFactor(healthFactorWad: bigint | null): string {
  if (healthFactorWad === null) return "∞";
  if (healthFactorWad > WAD * BigInt(1_000)) return "> 1,000";
  return formatFixed(healthFactorWad, 18, 2);
}

/** Fixed number of fraction digits, truncated toward zero, grouped. */
export function formatFixed(value: bigint, decimals: number, fractionDigits: number): string {
  const text = formatUnits(value, decimals, fractionDigits);
  const [whole, fraction = ""] = text.split(".");
  const padded = fractionDigits > 0 ? `${whole}.${fraction.padEnd(fractionDigits, "0")}` : whole;
  return groupDecimal(padded);
}

/** USD from a wad: "$1,234.56"; small values keep significant digits ("$0.0000044"). */
export function formatUsdWad(value: bigint | null, options: { compact?: boolean } = {}): string {
  if (value === null) return "n/a";
  const negative = value < ZERO;
  const abs = negative ? -value : value;
  const sign = negative ? "-" : "";
  if (abs === ZERO) return "$0.00";
  if (options.compact && abs >= WAD * BigInt(1_000_000)) {
    return `${sign}$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(wadToNumber(abs))}`;
  }
  if (abs >= WAD / BigInt(100)) return `${sign}$${formatFixed(abs, 18, 2)}`;
  return `${sign}$${formatSignificant(abs, 18, 3)}`;
}

/** Price per whole token from a wad: keeps 4 significant digits for sub-cent prices. */
export function formatPriceWad(value: bigint | null): string {
  if (value === null) return "n/a";
  if (value >= WAD) return `$${formatFixed(value, 18, 2)}`;
  return `$${formatSignificant(value, 18, 4)}`;
}

/** Decimal string with `digits` significant digits after leading zeros, truncated. */
export function formatSignificant(value: bigint, decimals: number, digits: number): string {
  const text = formatUnits(value, decimals);
  const [whole, fraction = ""] = text.split(".");
  if (whole !== "0" && whole !== "-0") {
    return groupDecimal(fraction ? `${whole}.${fraction.slice(0, Math.max(0, digits))}`.replace(/\.$/, "") : whole);
  }
  const leading = fraction.length - fraction.replace(/^0+/, "").length;
  const cut = fraction.slice(0, leading + digits).replace(/0+$/, "");
  return cut ? `0.${cut}` : "0";
}

/** Token amount for tables: grouped, at most `maxFractionDigits` (default 6), truncated. */
export function formatTokenAmount(value: bigint, decimals: number, maxFractionDigits = 6): string {
  if (value === ZERO) return "0";
  const exact = formatUnits(value, decimals, maxFractionDigits);
  if (exact === "0" && value > ZERO) return maxFractionDigits > 0 ? `< 0.${"0".repeat(maxFractionDigits - 1)}1` : "< 1";
  return groupDecimal(exact);
}

/** Basis points -> "12.34%". */
export function formatBpsPercent(value: number | null, fractionDigits = 2): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${(value / 100).toFixed(fractionDigits)}%`;
}

export function bpsToPercent(value: number): number {
  return value / 100;
}

/** "12 s", "4 min", "3 h", "2 d" */
export function formatAge(ageMs: number | null): string {
  if (ageMs === null || !Number.isFinite(ageMs)) return "no price";
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  if (seconds < 90) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}
