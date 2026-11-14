/**
 * Exact fixed-point primitives shared by every risk function.
 *
 * Mirrors the lending contract (docs/ARCHITECTURE.md section 4): amounts are u128 base units,
 * prices and USD values are 18-decimal fixed point ("wad"), ratios are basis points. The
 * contract multiplies through a 256-bit intermediate; bigint is arbitrary precision, so every
 * product here is exact and only the final division rounds.
 */

export const WAD = BigInt("1000000000000000000");
export const BPS = BigInt(10_000);
export const SECONDS_PER_YEAR = BigInt(31_536_000);
export const MS_PER_SECOND = BigInt(1_000);
export const U128_MAX = (BigInt(1) << BigInt(128)) - BigInt(1);

export const ZERO = BigInt(0);
export const ONE = BigInt(1);

/** Liquidation close factor fixed by the contract: at most half a debt per liquidation. */
export const CLOSE_FACTOR_BPS = 5_000;

export class RiskMathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RiskMathError";
  }
}

const POW10_CACHE = new Map<number, bigint>();

/** 10^n for token decimals (0..38). */
export function pow10(n: number): bigint {
  if (!Number.isInteger(n) || n < 0 || n > 77) throw new RiskMathError(`invalid decimals: ${n}`);
  const cached = POW10_CACHE.get(n);
  if (cached !== undefined) return cached;
  const value = BigInt(10) ** BigInt(n);
  POW10_CACHE.set(n, value);
  return value;
}

function assertNonNegative(label: string, value: bigint): void {
  if (value < ZERO) throw new RiskMathError(`${label} must not be negative (got ${value})`);
}

/** floor(a * b / d), all operands non-negative, d > 0. */
export function mulDiv(a: bigint, b: bigint, d: bigint): bigint {
  assertNonNegative("a", a);
  assertNonNegative("b", b);
  if (d <= ZERO) throw new RiskMathError("division by zero");
  return (a * b) / d;
}

/** ceil(a * b / d), all operands non-negative, d > 0. */
export function mulDivUp(a: bigint, b: bigint, d: bigint): bigint {
  assertNonNegative("a", a);
  assertNonNegative("b", b);
  if (d <= ZERO) throw new RiskMathError("division by zero");
  const product = a * b;
  const quotient = product / d;
  return product % d === ZERO ? quotient : quotient + ONE;
}

/** ceil(a / d), a >= 0, d > 0. */
export function divUp(a: bigint, d: bigint): bigint {
  return mulDivUp(a, ONE, d);
}

export function minBig(...values: bigint[]): bigint {
  if (values.length === 0) throw new RiskMathError("minBig needs at least one value");
  return values.reduce((low, value) => (value < low ? value : low));
}

export function maxBig(...values: bigint[]): bigint {
  if (values.length === 0) throw new RiskMathError("maxBig needs at least one value");
  return values.reduce((high, value) => (value > high ? value : high));
}

/** a - b clamped at zero. */
export function saturatingSub(a: bigint, b: bigint): bigint {
  return a > b ? a - b : ZERO;
}

const U128_PATTERN = /^(0|[1-9][0-9]*)$/;

/** Parse a U128 JSON string (base units, wad or shares). Rejects signs, decimals and overflow. */
export function u128(value: string | number | bigint, label = "value"): bigint {
  if (typeof value === "bigint") {
    if (value < ZERO || value > U128_MAX) throw new RiskMathError(`${label} out of u128 range`);
    return value;
  }
  const text = typeof value === "number" ? (Number.isSafeInteger(value) ? String(value) : "") : value.trim();
  if (!U128_PATTERN.test(text)) throw new RiskMathError(`${label} is not a u128 decimal string: "${String(value)}"`);
  const parsed = BigInt(text);
  if (parsed > U128_MAX) throw new RiskMathError(`${label} exceeds u128`);
  return parsed;
}

/** u128 parse that returns zero for absent values (views can omit zero balances). */
export function u128OrZero(value: string | null | undefined): bigint {
  if (value === null || value === undefined || value === "") return ZERO;
  return u128(value);
}

export function bps(value: number, label = "bps"): bigint {
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new RiskMathError(`${label} must be a u16 integer (got ${value})`);
  }
  return BigInt(value);
}
