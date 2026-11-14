/**
 * Exact conversion between human token amounts ("1.5") and integer base units ("1500000").
 * Pure string + bigint math: no floats touch an amount that is sent to 1Click or a wallet.
 * Safe to import from client and server code.
 */

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountError";
  }
}

/** u256 has 78 decimal digits; nothing on any supported chain uses more decimals than that. */
const MAX_DECIMALS = 77;
const HUMAN_AMOUNT = /^(\d*)(?:\.(\d*))?$/;
const BASE_AMOUNT = /^-?\d+$/;

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new AmountError(`decimals must be an integer between 0 and ${MAX_DECIMALS}, got ${decimals}`);
  }
}

/**
 * "1.5" with 6 decimals -> "1500000". Accepts plain decimal notation only (no sign, exponent,
 * separators or whitespace inside). Rejects more fractional digits than the token supports
 * instead of silently rounding.
 */
export function toBaseUnits(human: string, decimals: number): string {
  assertDecimals(decimals);
  if (typeof human !== "string") throw new AmountError("amount must be a string in decimal notation");
  const value = human.trim();
  const match = HUMAN_AMOUNT.exec(value);
  if (!value || !match || (match[1] === "" && (match[2] ?? "") === "")) {
    throw new AmountError(`"${human}" is not a decimal amount (use digits and an optional ".", e.g. 12.5)`);
  }
  const whole = match[1] || "0";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new AmountError(
      `"${human}" has ${fraction.length} decimal places; this token supports at most ${decimals}`,
    );
  }
  const scaled = BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  return scaled.toString();
}

/** Same as `toBaseUnits` but rejects zero. */
export function toPositiveBaseUnits(human: string, decimals: number): string {
  const base = toBaseUnits(human, decimals);
  if (BigInt(base) <= BigInt(0)) throw new AmountError(`amount must be greater than zero, got "${human}"`);
  return base;
}

/** "1500000" with 6 decimals -> "1.5". Exact; trailing fractional zeros are trimmed. */
export function fromBaseUnits(base: string | bigint, decimals: number): string {
  assertDecimals(decimals);
  const raw = typeof base === "bigint" ? base.toString() : String(base).trim();
  if (!BASE_AMOUNT.test(raw)) throw new AmountError(`"${String(base)}" is not an integer base-unit amount`);
  const negative = raw.startsWith("-");
  const digits = BigInt(negative ? raw.slice(1) : raw).toString();
  if (decimals === 0) return `${negative && digits !== "0" ? "-" : ""}${digits}`;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, "");
  const body = fraction ? `${whole}.${fraction}` : whole;
  return negative && body !== "0" ? `-${body}` : body;
}

/** Lossy, display-only conversion of an exact decimal string. Never feed the result back into a transfer. */
export function decimalToNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
