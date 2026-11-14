/**
 * Exact conversion between human decimal strings and base units. Never uses float math for
 * amounts: a user typing "0.000000000000000001" PEPE gets exactly 1 base unit.
 */

import { pow10, RiskMathError, U128_MAX, WAD, ZERO } from "./fixed";

export class AmountParseError extends RiskMathError {
  constructor(message: string) {
    super(message);
    this.name = "AmountParseError";
  }
}

/** Strip grouping separators and surrounding whitespace from a typed amount. */
export function normalizeAmountInput(input: string): string {
  return input.replace(/[\s,_]/g, "");
}

const DECIMAL_PATTERN = /^(\d*)(?:\.(\d*))?$/;

/**
 * "1234.5" with 6 decimals -> 1234500000n. Rejects negatives, exponents, more fractional digits
 * than the token has, and values above u128.
 */
export function parseUnits(input: string, decimals: number): bigint {
  const text = normalizeAmountInput(input);
  if (text === "" || text === ".") throw new AmountParseError("Enter an amount");
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) throw new AmountParseError("Use digits and at most one decimal point");
  const whole = match[1] ?? "";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new AmountParseError(`At most ${decimals} decimal place${decimals === 1 ? "" : "s"} for this token`);
  }
  const unit = pow10(decimals);
  const value = BigInt(whole || "0") * unit + BigInt((fraction || "0").padEnd(decimals, "0").slice(0, decimals) || "0");
  if (value > U128_MAX) throw new AmountParseError("Amount is too large");
  return value;
}

/** parseUnits that returns null instead of throwing (for live inputs). */
export function tryParseUnits(input: string, decimals: number): bigint | null {
  try {
    return parseUnits(input, decimals);
  } catch {
    return null;
  }
}

/**
 * Exact base units -> decimal string, trailing zeros trimmed. `maxFractionDigits` truncates
 * (rounds toward zero) for display; omit it for the exact value.
 */
export function formatUnits(value: bigint, decimals: number, maxFractionDigits?: number): string {
  const negative = value < ZERO;
  const abs = negative ? -value : value;
  const unit = pow10(decimals);
  const whole = abs / unit;
  let fraction = decimals > 0 ? (abs % unit).toString().padStart(decimals, "0") : "";
  if (maxFractionDigits !== undefined && fraction.length > maxFractionDigits) {
    fraction = fraction.slice(0, maxFractionDigits);
  }
  fraction = fraction.replace(/0+$/, "");
  const body = fraction ? `${whole.toString()}.${fraction}` : whole.toString();
  return negative ? `-${body}` : body;
}

/** Group the integer part of a decimal string with commas: "1234567.89" -> "1,234,567.89". */
export function groupDecimal(text: string): string {
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const [whole, fraction] = body.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Parse a decimal string that may use scientific notation ("4.4e-6") into a wad (x1e18),
 * truncating digits beyond 18 decimals. Used for oracle prices that arrive as JSON numbers.
 */
export function decimalToWad(input: string): bigint {
  const text = input.trim().toLowerCase();
  const match = /^(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/.exec(text);
  if (!match || (match[1] === "" && (match[2] ?? "") === "")) {
    throw new AmountParseError(`not a non-negative decimal: "${input}"`);
  }
  const whole = match[1] ?? "";
  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? "0");
  if (!Number.isFinite(exponent) || Math.abs(exponent) > 200) throw new AmountParseError("exponent out of range");
  // digits * 10^(exponent - fraction.length) * 1e18
  const digits = BigInt(`${whole}${fraction}` || "0");
  const shift = exponent - fraction.length + 18;
  if (shift >= 0) return digits * pow10(shift);
  if (-shift > 77) return ZERO;
  return digits / pow10(-shift);
}

/** A JS number (e.g. priceUsd from an API) -> wad, via its shortest round-trip decimal form. */
export function numberToWad(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) throw new AmountParseError(`price must be a finite non-negative number (got ${value})`);
  return decimalToWad(String(value));
}

/** wad -> JS number, for display only (never for settlement math). */
export function wadToNumber(value: bigint): number {
  const negative = value < ZERO;
  const abs = negative ? -value : value;
  const whole = abs / WAD;
  const fraction = abs % WAD;
  const result = Number(whole) + Number(fraction) / 1e18;
  return negative ? -result : result;
}

/** Base units -> JS number of whole tokens, for display only. */
export function unitsToNumber(value: bigint, decimals: number): number {
  return Number(formatUnits(value, decimals));
}
