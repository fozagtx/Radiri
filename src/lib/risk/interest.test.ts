import { describe, expect, it } from "vitest";
import { configOf } from "./test-helpers";
import { WAD } from "./fixed";
import {
  accrueBorrowIndex,
  accruePool,
  borrowAprBps,
  debtFromScaled,
  debtGrowth,
  scaledForBorrow,
  scaledForRepay,
  sharesForSupply,
  sharesForWithdraw,
  supplyAprBps,
  supplyUnderlying,
  underlyingForShares,
  utilizationBps,
} from "./interest";

const n = (value: string | number) => BigInt(value);
const MEME = configOf("tPEPE").interest; // base 200, slope1 1200, slope2 30000, kink 6000
const STOCK = configOf("tAAPL").interest; // base 100, slope1 800, slope2 20000, kink 7000

describe("utilizationBps", () => {
  it("is borrowed / (cash + borrowed), floored, 0 for an empty pool", () => {
    expect(utilizationBps(n(0), n(0))).toBe(0);
    expect(utilizationBps(n(100), n(0))).toBe(0);
    expect(utilizationBps(n(0), n(100))).toBe(10_000);
    expect(utilizationBps(n(1), n(3))).toBe(7_500);
    expect(utilizationBps(n(2), n(1))).toBe(3_333);
  });

  it("handles 18-decimal meme pools", () => {
    const e27 = n(10) ** n(27);
    expect(utilizationBps(e27 * n(4), e27 * n(6))).toBe(6_000);
  });
});

describe("borrowAprBps (kinked model)", () => {
  it("is linear up to the kink", () => {
    expect(borrowAprBps(MEME, 0)).toBe(200);
    expect(borrowAprBps(MEME, 3_000)).toBe(800);
    expect(borrowAprBps(STOCK, 3_500)).toBe(500);
  });

  it("hits base + slope1 exactly at the kink", () => {
    expect(borrowAprBps(MEME, 6_000)).toBe(1_400);
    expect(borrowAprBps(STOCK, 7_000)).toBe(900);
  });

  it("jumps onto slope2 one bp past the kink (floored)", () => {
    // 1400 + 30000 * 1 / 4000 = 1407.5 -> 1407
    expect(borrowAprBps(MEME, 6_001)).toBe(1_407);
    expect(borrowAprBps(MEME, 10_000)).toBe(31_400);
    expect(borrowAprBps(STOCK, 10_000)).toBe(20_900);
  });

  it("handles degenerate kinks", () => {
    expect(borrowAprBps({ base_bps: 100, slope1_bps: 500, slope2_bps: 9000, optimal_utilization_bps: 0 }, 0)).toBe(100);
    expect(borrowAprBps({ base_bps: 100, slope1_bps: 500, slope2_bps: 9000, optimal_utilization_bps: 10_000 }, 10_000)).toBe(600);
    expect(() => borrowAprBps(MEME, 10_001)).toThrow();
  });
});

describe("supplyAprBps", () => {
  it("is borrow APR x U x (1 - reserve factor), floored at each step", () => {
    // 1400 * 6000 / 10000 = 840; 840 * 8000 / 10000 = 672
    expect(supplyAprBps(1_400, 6_000, 2_000)).toBe(672);
    expect(supplyAprBps(1_407, 6_001, 2_000)).toBe(675);
    expect(supplyAprBps(200, 0, 2_000)).toBe(0);
    expect(supplyAprBps(31_400, 10_000, 0)).toBe(31_400);
  });
});

describe("accrueBorrowIndex", () => {
  it("adds exactly one year of simple interest over 31,536,000 s", () => {
    expect(accrueBorrowIndex(WAD, 1_000, n(31_536_000))).toBe(n("1100000000000000000"));
  });

  it("floors the per-period rate", () => {
    // 1e17 * 86400 / 31536000 = 273972602739726.0...
    expect(accrueBorrowIndex(WAD, 1_000, n(86_400))).toBe(WAD + n("273972602739726"));
  });

  it("does nothing for dt <= 0 or 0% APR", () => {
    expect(accrueBorrowIndex(WAD, 1_000, n(0))).toBe(WAD);
    expect(accrueBorrowIndex(WAD, 0, n(1_000_000))).toBe(WAD);
  });

  it("compounds across accruals (index of an index)", () => {
    const once = accrueBorrowIndex(WAD, 1_000, n(31_536_000));
    expect(accrueBorrowIndex(once, 1_000, n(31_536_000))).toBe(n("1210000000000000000"));
  });
});

describe("scaled debt and debt growth", () => {
  it("grows debt with the index", () => {
    expect(scaledForBorrow(n(1_000_000_000), WAD)).toBe(n(1_000_000_000));
    expect(debtFromScaled(n(1_000_000_000), n("1100000000000000000"))).toBe(n(1_100_000_000));
    expect(debtGrowth(n(1_000_000_000), WAD, n("1100000000000000000"))).toBe(n(1_100_000_000));
  });

  it("rounds what the borrower owes up and what a repayment clears down", () => {
    expect(scaledForBorrow(n(1), n(3) * WAD)).toBe(n(1));
    expect(debtFromScaled(n(1), n(3) * WAD / n(2))).toBe(n(2));
    expect(scaledForRepay(n(2), n(3) * WAD)).toBe(n(0));
    expect(scaledForRepay(n(3), n(3) * WAD)).toBe(n(1));
  });

  it("is exact for 1e27-unit meme debts", () => {
    const principal = n(10) ** n(27);
    const index = accrueBorrowIndex(WAD, 1_400, n(31_536_000));
    expect(index).toBe(n("1140000000000000000"));
    expect(debtGrowth(principal, WAD, index)).toBe(n("1140000000000000000000000000"));
  });
});

describe("accruePool", () => {
  it("moves index, total borrowed and reserves together", () => {
    const result = accruePool(
      { cash: n(4_000_000_000), totalBorrowed: n(6_000_000_000), reserves: n(0), borrowIndex: WAD, lastAccrualMs: 0 },
      MEME,
      2_000,
      31_536_000_000,
    );
    expect(result.utilizationBps).toBe(6_000);
    expect(result.borrowAprBps).toBe(1_400);
    expect(result.borrowIndex).toBe(n("1140000000000000000"));
    expect(result.totalBorrowed).toBe(n(6_840_000_000));
    expect(result.interest).toBe(n(840_000_000));
    expect(result.reserves).toBe(n(168_000_000));
    expect(result.cash).toBe(n(4_000_000_000));
    expect(result.lastAccrualMs).toBe(31_536_000_000);
  });

  it("keeps sub-second remainders and ignores empty pools", () => {
    const pool = { cash: n(10), totalBorrowed: n(10), reserves: n(0), borrowIndex: WAD, lastAccrualMs: 1_000 };
    expect(accruePool(pool, MEME, 2_000, 1_999).lastAccrualMs).toBe(1_000);
    expect(accruePool(pool, MEME, 2_000, 3_500).lastAccrualMs).toBe(3_000);
    const empty = accruePool({ ...pool, totalBorrowed: n(0) }, MEME, 2_000, 9_000);
    expect(empty.borrowIndex).toBe(WAD);
    expect(empty.lastAccrualMs).toBe(9_000);
  });
});

describe("supply shares", () => {
  it("mints 1:1 first, then pro rata (floored); burns rounded up", () => {
    expect(sharesForSupply(n(1_000), n(0), n(0))).toBe(n(1_000));
    const underlying = supplyUnderlying(n(600), n(600), n(100)); // 1100
    expect(underlying).toBe(n(1_100));
    expect(sharesForSupply(n(110), n(1_000), underlying)).toBe(n(100));
    expect(sharesForSupply(n(1), n(1_000), underlying)).toBe(n(0));
    expect(sharesForWithdraw(n(11), n(1_000), underlying)).toBe(n(10));
    expect(sharesForWithdraw(n(1), n(1_000), underlying)).toBe(n(1));
    expect(underlyingForShares(n(100), n(1_000), underlying)).toBe(n(110));
    expect(supplyUnderlying(n(0), n(0), n(5))).toBe(n(0));
  });
});
