import { describe, expect, it } from "vitest";
import { WAD } from "./fixed";
import { computeLiquidation } from "./liquidation";
import { checkPrice, isPriceFresh, priceAgeMs } from "./oracle";
import { AAPL_PRICE, NOW_MS, PEPE_BILLION, PEPE_PRICE } from "./test-helpers";

const n = (value: string | number) => BigInt(value);

describe("price freshness", () => {
  const price = (ageMs: number, wad = "4400000000000") => ({ price_wad: wad, timestamp_ms: NOW_MS - ageMs });

  it("is fresh up to and including max_price_age_sec", () => {
    expect(isPriceFresh(price(0), 300, NOW_MS)).toBe(true);
    expect(isPriceFresh(price(300_000), 300, NOW_MS)).toBe(true);
    expect(isPriceFresh(price(300_001), 300, NOW_MS)).toBe(false);
    expect(checkPrice(price(300_001), 300, NOW_MS).status).toBe("stale");
  });

  it("rejects missing and zero prices", () => {
    expect(checkPrice(null, 300, NOW_MS).status).toBe("missing");
    expect(checkPrice(price(0, "0"), 300, NOW_MS).status).toBe("zero");
    expect(checkPrice(price(0, "garbage"), 300, NOW_MS).fresh).toBe(false);
  });

  it("never reports a negative age for a future timestamp", () => {
    expect(priceAgeMs(price(-5_000), NOW_MS)).toBe(0);
    expect(priceAgeMs(null, NOW_MS)).toBeNull();
  });

  it("applies each asset's own window (stocks 900 s)", () => {
    expect(isPriceFresh(price(600_000), 900, NOW_MS)).toBe(true);
    expect(isPriceFresh(price(600_000), 300, NOW_MS)).toBe(false);
  });
});

describe("computeLiquidation", () => {
  // Borrower owes 10 AAPL ($1,100) against tPEPE; liquidator sends 6 AAPL.
  const base = {
    debtAmount: n(1_000_000_000),
    transferredAmount: n(600_000_000),
    debtPriceWad: AAPL_PRICE,
    debtDecimals: 8,
    collateralAmount: PEPE_BILLION,
    collateralPriceWad: PEPE_PRICE,
    collateralDecimals: 18,
    liquidationBonusBps: 1_500,
  };

  it("caps repay at the 50% close factor, adds the bonus and refunds the rest", () => {
    const result = computeLiquidation(base);
    expect(result.maxRepay).toBe(n(500_000_000));
    expect(result.repay).toBe(n(500_000_000));
    expect(result.refund).toBe(n(100_000_000));
    // $550 x 1.15 = $632.50 of PEPE at $0.0000044 = 143,750,000 PEPE
    expect(result.seizeValueWad).toBe(n("632500000000000000000"));
    expect(result.seizeAmount).toBe(n("143750000000000000000000000"));
    expect(result.seizeCapped).toBe(false);
  });

  it("repays the whole transfer when it is below the close factor", () => {
    const result = computeLiquidation({ ...base, transferredAmount: n(100_000_000) });
    expect(result.repay).toBe(n(100_000_000));
    expect(result.refund).toBe(n(0));
    expect(result.seizeAmount).toBe(n("28750000000000000000000000"));
  });

  it("seizes everything and scales repay down (rounded up) when collateral runs out", () => {
    const result = computeLiquidation({ ...base, collateralAmount: n(10) ** n(26) });
    expect(result.seizeCapped).toBe(true);
    expect(result.seizeAmount).toBe(n(10) ** n(26));
    // 5e8 x 1e26 / 1.4375e26 = 347,826,086.95... -> 347,826,087
    expect(result.repay).toBe(n(347_826_087));
    expect(result.refund).toBe(n(600_000_000 - 347_826_087));
    expect(result.seizeValueWad).toBe(n("440000000000000000000"));
  });

  it("rounds the seized amount down", () => {
    const result = computeLiquidation({ ...base, transferredAmount: n(1), collateralPriceWad: n(3) * WAD });
    // value 1 unit AAPL = 1.1e12 wad, x1.15 = 1.265e12 wad; / $3 -> 421,666,666,666 base units (floor)
    expect(result.seizeAmount).toBe(n("421666666666"));
  });

  it("supports a custom close factor and rejects zero prices", () => {
    expect(computeLiquidation({ ...base, closeFactorBps: 10_000 }).repay).toBe(n(600_000_000));
    expect(() => computeLiquidation({ ...base, debtPriceWad: n(0) })).toThrow();
  });
});
