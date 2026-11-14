import { describe, expect, it } from "vitest";
import {
  assetMap,
  computeAccountRisk,
  debtValueWad,
  emptyHoldings,
  healthFactorWad,
  holdingsFromAccount,
  isLiquidatable,
  liquidationPriceWad,
  maxBorrowByHealth,
  maxWithdrawByHealth,
  valueWad,
} from "./account";
import { WAD } from "./fixed";
import { AAPL, AAPL_PRICE, NOW_MS, PEPE, PEPE_BILLION, PEPE_PRICE, standardViews, TSLA, TSLA_PRICE, WIF } from "./test-helpers";

const n = (value: string | number) => BigInt(value);
const usd = (whole: number) => WAD * n(whole);
const AAPL_UNIT = n(10) ** n(8);

function holdings(collateral: Record<string, bigint>, debt: Record<string, bigint> = {}) {
  return { ...emptyHoldings(), collateral, debt };
}

describe("valueWad / debtValueWad", () => {
  it("values 1e27 PEPE base units at $4,400 exactly", () => {
    expect(valueWad(PEPE_BILLION, PEPE_PRICE, 18)).toBe(usd(4_400));
  });

  it("rounds collateral down and debt up", () => {
    // 1 base unit of an 18-decimal token at $0.0000044 = 4.4e-6 wei of USD: 0 down, 1 up.
    expect(valueWad(n(1), PEPE_PRICE, 18)).toBe(n(0));
    expect(debtValueWad(n(1), PEPE_PRICE, 18)).toBe(n(1));
    expect(valueWad(n(3), WAD, 8)).toBe(n(30_000_000_000));
    expect(debtValueWad(n(3), WAD + n(1), 0)).toBe(n(3) * (WAD + n(1)));
  });
});

describe("healthFactorWad", () => {
  it("is null without debt and exact otherwise", () => {
    expect(healthFactorWad(usd(100), n(0))).toBeNull();
    expect(healthFactorWad(usd(150), usd(100))).toBe(n("1500000000000000000"));
    expect(healthFactorWad(usd(100), usd(100))).toBe(WAD);
    expect(healthFactorWad(usd(100), usd(300))).toBe(n("333333333333333333"));
  });

  it("treats HF exactly 1 as not liquidatable and one wei more debt as liquidatable", () => {
    expect(isLiquidatable(usd(100), usd(100))).toBe(false);
    expect(isLiquidatable(usd(100), usd(100) + n(1))).toBe(true);
  });
});

describe("computeAccountRisk", () => {
  const assets = assetMap(standardViews());

  it("sums limit and threshold per asset with each asset's own parameters", () => {
    // $4,400 of PEPE (LTV 25%, LT 40%) + 10 AAPL = $1,100 (LTV 50%, LT 65%)
    const risk = computeAccountRisk(assets, holdings({ [PEPE]: PEPE_BILLION, [AAPL]: n(10) * AAPL_UNIT }), NOW_MS);
    expect(risk.collateralValueWad).toBe(usd(5_500));
    expect(risk.borrowLimitWad).toBe(usd(1_100 + 550));
    expect(risk.liquidationThresholdWad).toBe(usd(1_760 + 715));
    expect(risk.debtValueWad).toBe(n(0));
    expect(risk.healthFactorWad).toBeNull();
    expect(risk.pricesFresh).toBe(true);
    expect(risk.liquidatable).toBe(false);
  });

  it("computes HF exactly 1 at the liquidation threshold", () => {
    // LT of 1e9 PEPE is $1,760; 16 AAPL at $110 = $1,760.
    const atOne = computeAccountRisk(assets, holdings({ [PEPE]: PEPE_BILLION }, { [AAPL]: n(16) * AAPL_UNIT }), NOW_MS);
    expect(atOne.healthFactorWad).toBe(WAD);
    expect(atOne.liquidatable).toBe(false);
    const over = computeAccountRisk(assets, holdings({ [PEPE]: PEPE_BILLION }, { [AAPL]: n(16) * AAPL_UNIT + n(1) }), NOW_MS);
    expect(over.liquidatable).toBe(true);
    expect(over.healthFactorWad! < WAD).toBe(true);
  });

  it("reports LTV in bps and available capacity", () => {
    const risk = computeAccountRisk(assets, holdings({ [PEPE]: PEPE_BILLION }, { [AAPL]: n(5) * AAPL_UNIT }), NOW_MS);
    expect(risk.debtValueWad).toBe(usd(550));
    expect(risk.ltvBps).toBe(1_250);
    expect(risk.availableToBorrowWad).toBe(usd(550));
  });

  it("flags stale, unpriced and unknown assets", () => {
    const stale = assetMap(standardViews({ pepe: { priceWad: PEPE_PRICE, ageSec: 301 } }));
    const staleRisk = computeAccountRisk(stale, holdings({ [PEPE]: PEPE_BILLION }), NOW_MS);
    expect(staleRisk.staleTokens).toEqual([PEPE]);
    expect(staleRisk.pricesFresh).toBe(false);
    // stale prices still value the position (views do); only actions are blocked
    expect(staleRisk.collateralValueWad).toBe(usd(4_400));

    const missing = assetMap(standardViews({ aapl: { priceWad: null } }));
    const missingRisk = computeAccountRisk(missing, holdings({ [AAPL]: AAPL_UNIT }), NOW_MS);
    expect(missingRisk.unpricedTokens).toEqual([AAPL]);
    expect(missingRisk.collateralValueWad).toBe(n(0));

    const unknown = computeAccountRisk(assets, holdings({ "nope.testnet": n(5) }), NOW_MS);
    expect(unknown.unknownTokens).toEqual(["nope.testnet"]);
    expect(unknown.pricesFresh).toBe(false);
  });

  it("respects a contract view that already marked a price stale", () => {
    const viewStale = assetMap(standardViews({ pepe: { priceWad: PEPE_PRICE, priceFresh: false } }));
    expect(computeAccountRisk(viewStale, holdings({ [PEPE]: PEPE_BILLION }), NOW_MS).staleTokens).toEqual([PEPE]);
  });

  it("reads holdings from an AccountView", () => {
    const parsed = holdingsFromAccount({
      account_id: "alice.testnet",
      collateral: [{ token_id: PEPE, amount: PEPE_BILLION.toString(), value_wad: "0" }],
      supplied: [{ token_id: WIF, shares: "5", amount: "7" }],
      borrowed: [{ token_id: AAPL, amount: "123", value_wad: "0" }],
      collateral_value_wad: "0",
      borrow_limit_wad: "0",
      liquidation_threshold_wad: "0",
      debt_value_wad: "0",
      health_factor_wad: null,
      prices_fresh: true,
      liquidatable: false,
    });
    expect(parsed.collateral[PEPE]).toBe(PEPE_BILLION);
    expect(parsed.supplied[WIF]).toBe(n(7));
    expect(parsed.debt[AAPL]).toBe(n(123));
    expect(holdingsFromAccount(null)).toEqual(emptyHoldings());
  });
});

describe("maxBorrowByHealth", () => {
  const assets = assetMap(standardViews());

  it("borrows exactly up to the limit: 1e9 PEPE ($1,100 limit) -> 10 AAPL at $110", () => {
    const h = holdings({ [PEPE]: PEPE_BILLION });
    const max = maxBorrowByHealth(assets, h, AAPL, NOW_MS);
    expect(max).toBe(n(10) * AAPL_UNIT);
    const at = computeAccountRisk(assets, holdings({ [PEPE]: PEPE_BILLION }, { [AAPL]: max }), NOW_MS);
    expect(at.debtValueWad).toBe(at.borrowLimitWad);
    const over = computeAccountRisk(assets, holdings({ [PEPE]: PEPE_BILLION }, { [AAPL]: max + n(1) }), NOW_MS);
    expect(over.debtValueWad > over.borrowLimitWad).toBe(true);
  });

  it("is exact when the limit does not divide evenly (TSLA at $250)", () => {
    const h = holdings({ [PEPE]: PEPE_BILLION });
    const max = maxBorrowByHealth(assets, h, TSLA, NOW_MS);
    expect(max).toBe(n(440_000_000)); // $1,100 / $250 = 4.4 TSLA
    const odd = assetMap(standardViews({ tsla: { priceWad: n("230123456789000000000") } }));
    const oddMax = maxBorrowByHealth(odd, h, TSLA, NOW_MS);
    const ok = computeAccountRisk(odd, holdings({ [PEPE]: PEPE_BILLION }, { [TSLA]: oddMax }), NOW_MS);
    const bad = computeAccountRisk(odd, holdings({ [PEPE]: PEPE_BILLION }, { [TSLA]: oddMax + n(1) }), NOW_MS);
    expect(ok.debtValueWad <= ok.borrowLimitWad).toBe(true);
    expect(bad.debtValueWad > bad.borrowLimitWad).toBe(true);
  });

  it("accounts for existing debt in the same and other tokens", () => {
    const h = holdings({ [PEPE]: PEPE_BILLION }, { [AAPL]: n(4) * AAPL_UNIT, [TSLA]: n(1) * AAPL_UNIT });
    // limit 1100, debt 440 + 250 = 690 -> room 410 -> 3.72727272 AAPL
    expect(maxBorrowByHealth(assets, h, AAPL, NOW_MS)).toBe(n(372_727_272));
  });

  it("borrows memes against stocks with 18-decimal precision", () => {
    // 10 AAPL = $1,100 collateral, LTV 50% -> $550 limit -> 125,000,000 PEPE
    const h = holdings({ [AAPL]: n(10) * AAPL_UNIT });
    const max = maxBorrowByHealth(assets, h, PEPE, NOW_MS);
    expect(max).toBe(n(125_000_000) * n(10) ** n(18));
  });

  it("is zero when already over the limit or without a price", () => {
    expect(maxBorrowByHealth(assets, holdings({ [PEPE]: PEPE_BILLION }, { [AAPL]: n(11) * AAPL_UNIT }), AAPL, NOW_MS)).toBe(n(0));
    const noPrice = assetMap(standardViews({ aapl: { priceWad: null } }));
    expect(maxBorrowByHealth(noPrice, holdings({ [PEPE]: PEPE_BILLION }), AAPL, NOW_MS)).toBe(n(0));
  });
});

describe("maxWithdrawByHealth", () => {
  const assets = assetMap(standardViews());

  it("allows the full balance without debt", () => {
    expect(maxWithdrawByHealth(assets, holdings({ [PEPE]: PEPE_BILLION }), PEPE, NOW_MS)).toBe(PEPE_BILLION);
  });

  it("stops exactly where the remaining limit equals the debt", () => {
    // debt $550 needs $2,200 of PEPE at LTV 25% = 5e8 PEPE -> withdraw 5e8 PEPE
    const h = holdings({ [PEPE]: PEPE_BILLION }, { [AAPL]: n(5) * AAPL_UNIT });
    const max = maxWithdrawByHealth(assets, h, PEPE, NOW_MS);
    expect(max).toBe(PEPE_BILLION / n(2));
    const remaining = computeAccountRisk(assets, holdings({ [PEPE]: PEPE_BILLION - max }, { [AAPL]: n(5) * AAPL_UNIT }), NOW_MS);
    expect(remaining.borrowLimitWad).toBe(remaining.debtValueWad);
    const tooFar = computeAccountRisk(assets, holdings({ [PEPE]: PEPE_BILLION - max - n(1) }, { [AAPL]: n(5) * AAPL_UNIT }), NOW_MS);
    expect(tooFar.borrowLimitWad < tooFar.debtValueWad).toBe(true);
  });

  it("is exact with uneven prices and multiple collaterals", () => {
    const odd = assetMap(standardViews({ pepe: { priceWad: n("4412345678901") } }));
    const h = holdings({ [PEPE]: PEPE_BILLION, [AAPL]: n(2) * AAPL_UNIT }, { [TSLA]: n(3) * AAPL_UNIT });
    const max = maxWithdrawByHealth(odd, h, PEPE, NOW_MS);
    const ok = computeAccountRisk(odd, holdings({ [PEPE]: PEPE_BILLION - max, [AAPL]: n(2) * AAPL_UNIT }, { [TSLA]: n(3) * AAPL_UNIT }), NOW_MS);
    const bad = computeAccountRisk(odd, holdings({ [PEPE]: PEPE_BILLION - max - n(1), [AAPL]: n(2) * AAPL_UNIT }, { [TSLA]: n(3) * AAPL_UNIT }), NOW_MS);
    expect(ok.debtValueWad <= ok.borrowLimitWad).toBe(true);
    expect(bad.debtValueWad > bad.borrowLimitWad).toBe(true);
  });

  it("is zero when the account is already over its limit", () => {
    const h = holdings({ [PEPE]: PEPE_BILLION }, { [AAPL]: n(12) * AAPL_UNIT });
    expect(maxWithdrawByHealth(assets, h, PEPE, NOW_MS)).toBe(n(0));
  });
});

describe("liquidationPriceWad", () => {
  const assets = assetMap(standardViews());

  it("is the collateral price at which HF reaches 1", () => {
    // debt $880, LT 40% of 1e9 PEPE -> price = 880 / (1e9 * 0.4) = $0.0000022
    const h = holdings({ [PEPE]: PEPE_BILLION }, { [AAPL]: n(8) * AAPL_UNIT });
    const price = liquidationPriceWad(assets, h, PEPE, NOW_MS);
    expect(price).toBe(n("2200000000000"));
    const atPrice = assetMap(standardViews({ pepe: { priceWad: price! } }));
    expect(computeAccountRisk(atPrice, h, NOW_MS).healthFactorWad).toBe(WAD);
  });

  it("is null without debt, and when other collateral covers the debt", () => {
    expect(liquidationPriceWad(assets, holdings({ [PEPE]: PEPE_BILLION }), PEPE, NOW_MS)).toBeNull();
    const covered = holdings({ [PEPE]: PEPE_BILLION, [TSLA]: n(10) * AAPL_UNIT }, { [AAPL]: AAPL_UNIT });
    expect(liquidationPriceWad(assets, covered, PEPE, NOW_MS)).toBeNull();
    expect(TSLA_PRICE > AAPL_PRICE).toBe(true);
  });
});
