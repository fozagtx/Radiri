import { describe, expect, it } from "vitest";
import {
  formatAge,
  formatBpsPercent,
  formatHealthFactor,
  formatPriceWad,
  formatSignificant,
  formatTokenAmount,
  formatUsdWad,
  healthBand,
} from "./display";
import { WAD } from "./fixed";

const n = (value: string | number) => BigInt(value);
const hf = (text: string) => n(text);

describe("healthBand", () => {
  it("uses >= 1.5 safe, 1.1-1.5 warn, < 1.1 danger, < 1 liquidatable", () => {
    expect(healthBand(null)).toBe("none");
    expect(healthBand(hf("1500000000000000000"))).toBe("safe");
    expect(healthBand(hf("1499999999999999999"))).toBe("warn");
    expect(healthBand(hf("1100000000000000000"))).toBe("warn");
    expect(healthBand(hf("1099999999999999999"))).toBe("danger");
    expect(healthBand(WAD)).toBe("danger");
    expect(healthBand(WAD - n(1))).toBe("liquidatable");
  });
});

describe("formatters", () => {
  it("formats health factors by truncation", () => {
    expect(formatHealthFactor(null)).toBe("∞");
    expect(formatHealthFactor(hf("1599999999999999999"))).toBe("1.59");
    expect(formatHealthFactor(WAD)).toBe("1.00");
    expect(formatHealthFactor(WAD * n(5_000))).toBe("> 1,000");
  });

  it("formats USD values from wads", () => {
    expect(formatUsdWad(WAD * n(1_234_567) + WAD / n(2))).toBe("$1,234,567.50");
    expect(formatUsdWad(n("4400000000000"))).toBe("$0.0000044");
    expect(formatUsdWad(n(0))).toBe("$0.00");
    expect(formatUsdWad(null)).toBe("n/a");
    expect(formatUsdWad(WAD * n(2_500_000), { compact: true })).toBe("$2.5M");
    expect(formatUsdWad(-WAD)).toBe("-$1.00");
  });

  it("formats prices with significant digits below $1", () => {
    expect(formatPriceWad(n("4412345678901"))).toBe("$0.000004412");
    expect(formatPriceWad(WAD * n(230) + WAD / n(4))).toBe("$230.25");
    expect(formatSignificant(n(123456), 3, 2)).toBe("123.45");
  });

  it("formats token amounts and tiny dust", () => {
    expect(formatTokenAmount(n(10) ** n(27), 18)).toBe("1,000,000,000");
    expect(formatTokenAmount(n(1), 18)).toBe("< 0.000001");
    expect(formatTokenAmount(n(123_456_789), 8, 4)).toBe("1.2345");
    expect(formatTokenAmount(n(0), 8)).toBe("0");
  });

  it("formats bps and ages", () => {
    expect(formatBpsPercent(2_500)).toBe("25.00%");
    expect(formatBpsPercent(null)).toBe("n/a");
    expect(formatAge(null)).toBe("no price");
    expect(formatAge(12_000)).toBe("12 s");
    expect(formatAge(5 * 60_000)).toBe("5 min");
    expect(formatAge(3 * 3_600_000)).toBe("3 h");
    expect(formatAge(72 * 3_600_000)).toBe("3 d");
  });
});
