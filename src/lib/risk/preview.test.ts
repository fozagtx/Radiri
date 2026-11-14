import { describe, expect, it } from "vitest";
import { emptyHoldings, type Holdings } from "./account";
import { WAD } from "./fixed";
import { maxActionAmount, previewAction, repayBuffer } from "./preview";
import { AAPL, market, NOW_MS, PEPE, PEPE_BILLION, standardViews, TSLA } from "./test-helpers";

const n = (value: string | number) => BigInt(value);
const AAPL_UNIT = n(10) ** n(8);

function holdings(collateral: Record<string, bigint> = {}, debt: Record<string, bigint> = {}, supplied: Record<string, bigint> = {}): Holdings {
  return { ...emptyHoldings(), collateral, debt, supplied };
}

const codes = (preview: { reasons: { code: string }[] }) => preview.reasons.map((reason) => reason.code);

describe("deposit_collateral", () => {
  it("adds collateral and raises the borrow limit", () => {
    const preview = previewAction(market(standardViews()), holdings(), { kind: "deposit_collateral", tokenId: PEPE, amount: PEPE_BILLION });
    expect(preview.ok).toBe(true);
    expect(preview.after.borrowLimitWad).toBe(WAD * n(1_100));
    expect(preview.before.borrowLimitWad).toBe(n(0));
  });

  it("enforces the collateral cap, eligibility, pause and wallet balance", () => {
    const capped = standardViews({ pepe: { priceWad: n("4400000000000"), collateral: n(10) ** n(29) * n(5), config: { collateral_cap: (n(10) ** n(29) * n(5)).toString() } } });
    expect(codes(previewAction(market(capped), holdings(), { kind: "deposit_collateral", tokenId: PEPE, amount: n(1) }))).toContain("collateral-cap");

    const ineligible = standardViews({ aapl: { priceWad: WAD, config: { can_collateralize: false } } });
    expect(codes(previewAction(market(ineligible), holdings(), { kind: "deposit_collateral", tokenId: AAPL, amount: n(1) }))).toContain("not-collateral");

    const paused = standardViews({ pepe: { priceWad: n("4400000000000"), config: { paused: true } } });
    expect(codes(previewAction(market(paused), holdings(), { kind: "deposit_collateral", tokenId: PEPE, amount: n(1) }))).toContain("asset-paused");

    expect(codes(previewAction(market(standardViews()), holdings(), { kind: "deposit_collateral", tokenId: PEPE, amount: n(10), walletBalance: n(9) }))).toEqual(["insufficient-balance"]);
    expect(codes(previewAction(market(standardViews()), holdings(), { kind: "deposit_collateral", tokenId: PEPE, amount: n(0) }))).toEqual(["zero-amount"]);
    expect(codes(previewAction(market(standardViews()), holdings(), { kind: "deposit_collateral", tokenId: "x.testnet", amount: n(1) }))).toContain("unknown-asset");
  });
});

describe("borrow", () => {
  const collateral = holdings({ [PEPE]: PEPE_BILLION });

  it("accepts a borrow exactly at the borrow limit and rejects one base unit more", () => {
    const at = previewAction(market(standardViews()), collateral, { kind: "borrow", tokenId: AAPL, amount: n(10) * AAPL_UNIT });
    expect(at.ok).toBe(true);
    expect(at.after.debtValueWad).toBe(at.after.borrowLimitWad);
    // HF at the limit = LT / limit = 40 / 25 = 1.6
    expect(at.after.healthFactorWad).toBe(n("1600000000000000000"));
    const over = previewAction(market(standardViews()), collateral, { kind: "borrow", tokenId: AAPL, amount: n(10) * AAPL_UNIT + n(1) });
    expect(codes(over)).toEqual(["health"]);
  });

  it("rejects a borrow when any account price is stale (collateral or borrowed asset)", () => {
    const staleCollateral = standardViews({ pepe: { priceWad: n("4400000000000"), ageSec: 301 } });
    const a = previewAction(market(staleCollateral), collateral, { kind: "borrow", tokenId: AAPL, amount: AAPL_UNIT });
    expect(codes(a)).toEqual(["stale-price"]);
    expect(a.reasons[0].tokenId).toBe(PEPE);

    const staleDebt = standardViews({ aapl: { priceWad: WAD * n(110), ageSec: 901 } });
    const b = previewAction(market(staleDebt), collateral, { kind: "borrow", tokenId: AAPL, amount: AAPL_UNIT });
    expect(codes(b)).toEqual(["stale-price"]);

    const missing = standardViews({ tsla: { priceWad: null } });
    expect(codes(previewAction(market(missing), collateral, { kind: "borrow", tokenId: TSLA, amount: AAPL_UNIT }))).toContain("missing-price");
  });

  it("rejects a borrow when an existing debt asset's price is stale", () => {
    const views = standardViews({ tsla: { priceWad: WAD * n(250), ageSec: 1_000 } });
    const withDebt = holdings({ [PEPE]: PEPE_BILLION }, { [TSLA]: n(1) });
    const preview = previewAction(market(views), withDebt, { kind: "borrow", tokenId: AAPL, amount: n(1) });
    expect(preview.reasons.map((reason) => reason.tokenId)).toEqual([TSLA]);
  });

  it("checks liquidity, borrow cap, eligibility and pauses", () => {
    const thin = standardViews({ aapl: { priceWad: WAD * n(110), cash: n(5) } });
    expect(codes(previewAction(market(thin), collateral, { kind: "borrow", tokenId: AAPL, amount: n(6) }))).toEqual(["liquidity"]);

    const cap = standardViews({ aapl: { priceWad: WAD * n(110), borrowed: n(90), cash: AAPL_UNIT * n(100), config: { borrow_cap: "100" } } });
    expect(codes(previewAction(market(cap), collateral, { kind: "borrow", tokenId: AAPL, amount: n(11) }))).toEqual(["borrow-cap"]);
    expect(previewAction(market(cap), collateral, { kind: "borrow", tokenId: AAPL, amount: n(10) }).ok).toBe(true);

    const noBorrow = standardViews({ aapl: { priceWad: WAD * n(110), cash: AAPL_UNIT * n(100), config: { can_borrow: false } } });
    expect(codes(previewAction(market(noBorrow), collateral, { kind: "borrow", tokenId: AAPL, amount: n(1) }))).toEqual(["not-borrowable"]);

    expect(codes(previewAction(market(standardViews(), true), collateral, { kind: "borrow", tokenId: AAPL, amount: n(1) }))).toEqual(["global-paused"]);
  });
});

describe("withdraw_collateral", () => {
  it("allows any withdrawal without debt, even with stale prices", () => {
    const stale = standardViews({ pepe: { priceWad: n("4400000000000"), ageSec: 10_000 } });
    const preview = previewAction(market(stale), holdings({ [PEPE]: PEPE_BILLION }), { kind: "withdraw_collateral", tokenId: PEPE, amount: PEPE_BILLION });
    expect(preview.ok).toBe(true);
  });

  it("requires fresh prices and a healthy remainder with debt", () => {
    const h = holdings({ [PEPE]: PEPE_BILLION }, { [AAPL]: n(5) * AAPL_UNIT });
    const half = PEPE_BILLION / n(2);
    expect(previewAction(market(standardViews()), h, { kind: "withdraw_collateral", tokenId: PEPE, amount: half }).ok).toBe(true);
    expect(codes(previewAction(market(standardViews()), h, { kind: "withdraw_collateral", tokenId: PEPE, amount: half + n(1) }))).toEqual(["health"]);
    const stale = standardViews({ aapl: { priceWad: WAD * n(110), ageSec: 10_000 } });
    expect(codes(previewAction(market(stale), h, { kind: "withdraw_collateral", tokenId: PEPE, amount: n(1) }))).toEqual(["stale-price"]);
    expect(codes(previewAction(market(standardViews()), h, { kind: "withdraw_collateral", tokenId: PEPE, amount: PEPE_BILLION + n(1) }))).toContain("exceeds-position");
  });

  it("is still allowed for a paused asset but not under a global pause", () => {
    const paused = standardViews({ pepe: { priceWad: n("4400000000000"), config: { paused: true } } });
    expect(previewAction(market(paused), holdings({ [PEPE]: n(5) }), { kind: "withdraw_collateral", tokenId: PEPE, amount: n(5) }).ok).toBe(true);
    expect(codes(previewAction(market(standardViews(), true), holdings({ [PEPE]: n(5) }), { kind: "withdraw_collateral", tokenId: PEPE, amount: n(5) }))).toEqual(["global-paused"]);
  });
});

describe("repay", () => {
  it("caps the repayment at the debt and refunds the excess", () => {
    const h = holdings({ [PEPE]: PEPE_BILLION }, { [AAPL]: n(500) });
    const preview = previewAction(market(standardViews()), h, { kind: "repay", tokenId: AAPL, amount: n(800) });
    expect(preview.ok).toBe(true);
    expect(preview.effectiveAmount).toBe(n(500));
    expect(preview.refund).toBe(n(300));
    expect(preview.holdingsAfter.debt[AAPL]).toBe(n(0));
    expect(preview.after.healthFactorWad).toBeNull();
  });

  it("stays open under a global pause and with stale prices", () => {
    const stale = standardViews({ aapl: { priceWad: WAD * n(110), ageSec: 10_000 } });
    const h = holdings({}, { [AAPL]: n(10) });
    expect(previewAction(market(stale, true), h, { kind: "repay", tokenId: AAPL, amount: n(10) }).ok).toBe(true);
    expect(codes(previewAction(market(standardViews()), holdings(), { kind: "repay", tokenId: AAPL, amount: n(1) }))).toEqual(["no-debt"]);
  });
});

describe("supply / withdraw_supply", () => {
  it("checks pool cash on withdrawal", () => {
    const thin = standardViews({ aapl: { priceWad: WAD * n(110), cash: n(5) } });
    const h = holdings({}, {}, { [AAPL]: n(10) });
    expect(codes(previewAction(market(thin), h, { kind: "withdraw_supply", tokenId: AAPL, amount: n(6) }))).toEqual(["liquidity"]);
    expect(previewAction(market(thin), h, { kind: "withdraw_supply", tokenId: AAPL, amount: n(5) }).ok).toBe(true);
    expect(previewAction(market(standardViews()), holdings(), { kind: "supply", tokenId: AAPL, amount: n(5), walletBalance: n(5) }).ok).toBe(true);
  });
});

describe("maxActionAmount", () => {
  it("returns min(health capacity, cash, cap) for borrow", () => {
    const h = holdings({ [PEPE]: PEPE_BILLION });
    expect(maxActionAmount(market(standardViews()), h, "borrow", AAPL)).toEqual({ amount: n(10) * AAPL_UNIT, limitedBy: "health" });
    const thin = standardViews({ aapl: { priceWad: WAD * n(110), cash: n(7) } });
    expect(maxActionAmount(market(thin), h, "borrow", AAPL)).toEqual({ amount: n(7), limitedBy: "liquidity" });
    const cap = standardViews({ aapl: { priceWad: WAD * n(110), cash: AAPL_UNIT * n(100), borrowed: n(10), config: { borrow_cap: "25" } } });
    expect(maxActionAmount(market(cap), h, "borrow", AAPL)).toEqual({ amount: n(15), limitedBy: "cap" });
  });

  it("is blocked (zero) when prices are stale or the market is paused", () => {
    const stale = standardViews({ pepe: { priceWad: n("4400000000000"), ageSec: 301 } });
    expect(maxActionAmount(market(stale), holdings({ [PEPE]: PEPE_BILLION }), "borrow", AAPL)).toEqual({ amount: n(0), limitedBy: "blocked" });
    expect(maxActionAmount(market(standardViews(), true), holdings(), "deposit_collateral", PEPE, n(5)).limitedBy).toBe("blocked");
  });

  it("max values pass previewAction", () => {
    const ctx = market(standardViews());
    const h = holdings({ [PEPE]: PEPE_BILLION, [AAPL]: n(3) * AAPL_UNIT }, { [TSLA]: n(2) * AAPL_UNIT });
    for (const kind of ["borrow", "withdraw_collateral"] as const) {
      for (const tokenId of [PEPE, AAPL, TSLA]) {
        const max = maxActionAmount(ctx, h, kind, tokenId);
        if (max.amount === n(0)) continue;
        expect(previewAction(ctx, h, { kind, tokenId, amount: max.amount }).ok).toBe(true);
        expect(previewAction(ctx, h, { kind, tokenId, amount: max.amount + n(1) }).ok).toBe(false);
      }
    }
  });

  it("adds an interest buffer to a full repay, limited by the wallet", () => {
    const h = holdings({}, { [AAPL]: n(1_000_000_000) });
    const max = maxActionAmount(market(standardViews()), h, "repay", AAPL);
    // 1 h of 1% APR (base 100 bps) on 1e9 = 1141.55 -> 1142
    expect(max.amount).toBe(n(1_000_000_000) + n(1_142));
    expect(repayBuffer(n(1), 100)).toBe(n(1));
    expect(maxActionAmount(market(standardViews()), h, "repay", AAPL, n(50))).toEqual({ amount: n(50), limitedBy: "wallet" });
  });

  it("caps deposits by wallet and collateral cap room", () => {
    const cap = standardViews({ pepe: { priceWad: n("4400000000000"), collateral: n(90), config: { collateral_cap: "100" } } });
    expect(maxActionAmount(market(cap), holdings(), "deposit_collateral", PEPE, n(50))).toEqual({ amount: n(10), limitedBy: "cap" });
    expect(maxActionAmount(market(standardViews()), holdings(), "deposit_collateral", PEPE, n(50)).amount).toBe(n(50));
  });

  it("works at NOW_MS", () => {
    expect(NOW_MS).toBeGreaterThan(0);
  });
});
