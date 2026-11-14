/**
 * Exact price conversions for the lending oracle. `price_wad` = USD per WHOLE token x 1e18, a u128
 * decimal string (docs/ARCHITECTURE.md section 4). Pure bigint/string math; client-safe.
 */

export class PriceFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceFormatError";
  }
}

export const WAD_DECIMALS = 18;
const U128_MAX = (BigInt(1) << BigInt(128)) - BigInt(1);
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** Normalises "0004.2500" -> "4.25", "5." is rejected, "0.0" -> "0". */
function normaliseDecimal(value: string): string {
  const match = DECIMAL.exec(value);
  if (!match) throw new PriceFormatError(`"${value}" is not a non-negative decimal number`);
  const whole = BigInt(match[1]).toString();
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * The exact decimal a JS number denotes in its shortest round-trip form:
 * 4.4e-6 -> "0.0000044", 355.72 -> "355.72", 1e21 -> "1000000000000000000000".
 */
export function numberToDecimalString(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new PriceFormatError(`price must be a finite non-negative number, got ${value}`);
  const text = String(value);
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/i.exec(text);
  if (!match) throw new PriceFormatError(`cannot read number ${text}`);
  const digits = `${match[1]}${match[2] ?? ""}`;
  const pointIndex = match[1].length + Number(match[3] ?? 0);
  let decimal: string;
  if (pointIndex <= 0) decimal = `0.${"0".repeat(-pointIndex)}${digits}`;
  else if (pointIndex >= digits.length) decimal = `${digits}${"0".repeat(pointIndex - digits.length)}`;
  else decimal = `${digits.slice(0, pointIndex)}.${digits.slice(pointIndex)}`;
  return normaliseDecimal(decimal);
}

/** Pyth price (integer string `price`, exponent `expo`) -> exact decimal string. Negative prices are rejected. */
export function pythToDecimalString(price: string, expo: number): string {
  if (!/^-?\d+$/.test(price)) throw new PriceFormatError(`Pyth price "${price}" is not an integer`);
  if (!Number.isInteger(expo)) throw new PriceFormatError(`Pyth expo ${expo} is not an integer`);
  if (price.startsWith("-")) throw new PriceFormatError(`Pyth price ${price} is negative`);
  const digits = BigInt(price).toString();
  if (expo >= 0) return normaliseDecimal(`${digits}${"0".repeat(expo)}`);
  const places = -expo;
  const padded = digits.padStart(places + 1, "0");
  return normaliseDecimal(`${padded.slice(0, padded.length - places)}.${padded.slice(padded.length - places)}`);
}

/**
 * Exact decimal USD price -> price_wad string. Digits beyond 18 decimal places are truncated
 * (rounded down, never up). Rejects zero (the contract treats 0 as "no price") and u128 overflow.
 */
export function decimalToPriceWad(decimal: string): string {
  const normalised = normaliseDecimal(decimal.trim());
  const [whole, fraction = ""] = normalised.split(".");
  const wad = BigInt(whole) * BigInt(10) ** BigInt(WAD_DECIMALS) + BigInt(fraction.slice(0, WAD_DECIMALS).padEnd(WAD_DECIMALS, "0"));
  if (wad <= BigInt(0)) throw new PriceFormatError(`price ${decimal} rounds to 0 at 18 decimals`);
  if (wad > U128_MAX) throw new PriceFormatError(`price ${decimal} overflows u128 as price_wad`);
  return wad.toString();
}

/** price_wad -> exact decimal string ("4400000000000" -> "0.0000044"). */
export function priceWadToDecimalString(wad: string): string {
  if (!/^\d+$/.test(wad)) throw new PriceFormatError(`price_wad "${wad}" is not an unsigned integer`);
  const padded = BigInt(wad).toString().padStart(WAD_DECIMALS + 1, "0");
  return normaliseDecimal(`${padded.slice(0, -WAD_DECIMALS)}.${padded.slice(-WAD_DECIMALS)}`);
}
