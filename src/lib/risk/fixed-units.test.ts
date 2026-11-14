import { describe, expect, it } from "vitest";
import { divUp, mulDiv, mulDivUp, pow10, u128, U128_MAX, WAD } from "./fixed";
import { decimalToWad, formatUnits, groupDecimal, numberToWad, parseUnits, tryParseUnits, wadToNumber } from "./units";

const n = (value: string | number) => BigInt(value);

describe("mulDiv / mulDivUp", () => {
  it("rounds down and up exactly", () => {
    expect(mulDiv(n(7), n(3), n(2))).toBe(n(10));
    expect(mulDivUp(n(7), n(3), n(2))).toBe(n(11));
    expect(mulDivUp(n(6), n(3), n(2))).toBe(n(9));
    expect(divUp(n(10), n(3))).toBe(n(4));
  });

  it("keeps products beyond u128 exact (1e27 PEPE base units x 4.4e12 price)", () => {
    const amount = n(10) ** n(27);
    const price = n("4400000000000");
    expect(amount * price > U128_MAX).toBe(true);
    expect(mulDiv(amount, price, pow10(18))).toBe(n("4400000000000000000000"));
  });

  it("rejects negative operands and zero divisors", () => {
    expect(() => mulDiv(n(-1), n(1), n(1))).toThrow();
    expect(() => mulDiv(n(1), n(1), n(0))).toThrow();
  });
});

describe("u128", () => {
  it("parses decimal strings and rejects everything else", () => {
    expect(u128("0")).toBe(n(0));
    expect(u128(U128_MAX.toString())).toBe(U128_MAX);
    expect(() => u128((U128_MAX + n(1)).toString())).toThrow();
    expect(() => u128("-1")).toThrow();
    expect(() => u128("1.5")).toThrow();
    expect(() => u128("01")).toThrow();
    expect(() => u128("1e18")).toThrow();
  });
});

describe("parseUnits / formatUnits", () => {
  it("converts exactly in both directions", () => {
    expect(parseUnits("1234.5", 6)).toBe(n(1_234_500_000));
    expect(parseUnits("0.000000000000000001", 18)).toBe(n(1));
    expect(parseUnits("1,000,000", 8)).toBe(n(100_000_000_000_000));
    expect(parseUnits(".5", 2)).toBe(n(50));
    expect(parseUnits("5.", 2)).toBe(n(500));
    expect(formatUnits(n(1_234_500_000), 6)).toBe("1234.5");
    expect(formatUnits(n(1), 18)).toBe("0.000000000000000001");
    expect(formatUnits(n(0), 18)).toBe("0");
  });

  it("round-trips huge meme amounts (1e27 base units, 18 decimals)", () => {
    const amount = n(10) ** n(27) + n(123);
    const text = formatUnits(amount, 18);
    expect(text).toBe("1000000000.000000000000000123");
    expect(parseUnits(text, 18)).toBe(amount);
  });

  it("rejects malformed input and excess precision", () => {
    expect(() => parseUnits("", 6)).toThrow();
    expect(() => parseUnits("-1", 6)).toThrow();
    expect(() => parseUnits("1e6", 6)).toThrow();
    expect(() => parseUnits("1.2.3", 6)).toThrow();
    expect(() => parseUnits("0.1234567", 6)).toThrow(/6 decimal/);
    expect(() => parseUnits("1", 0)).not.toThrow();
    expect(() => parseUnits("1.0", 0)).toThrow();
    expect(() => parseUnits("9".repeat(60), 18)).toThrow(/too large/);
    expect(tryParseUnits("abc", 6)).toBeNull();
  });

  it("truncates display digits without rounding up", () => {
    expect(formatUnits(n("1999999"), 6, 2)).toBe("1.99");
    expect(groupDecimal("1234567.891")).toBe("1,234,567.891");
  });
});

describe("price conversion to wad", () => {
  it("handles plain and scientific notation", () => {
    expect(decimalToWad("4.4e-6")).toBe(n("4400000000000"));
    expect(decimalToWad("0.0000044")).toBe(n("4400000000000"));
    expect(decimalToWad("230.15")).toBe(n("230150000000000000000"));
    expect(decimalToWad("1e3")).toBe(WAD * n(1000));
    expect(decimalToWad("1.23456789012345678999")).toBe(n("1234567890123456789"));
    expect(numberToWad(0.0000044)).toBe(n("4400000000000"));
    expect(numberToWad(1.5e-20)).toBe(n(0));
    expect(() => numberToWad(Number.NaN)).toThrow();
    expect(() => numberToWad(-1)).toThrow();
  });

  it("converts wads to numbers for display", () => {
    expect(wadToNumber(WAD * n(3) / n(2))).toBe(1.5);
    expect(wadToNumber(n("4400000000000"))).toBeCloseTo(0.0000044, 12);
  });
});
