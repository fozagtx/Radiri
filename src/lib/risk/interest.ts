/**
 * Pool math: utilization, the kinked interest model, borrow-index accrual, scaled debt and
 * supply shares. Formulas from docs/ARCHITECTURE.md section 4, integer math with the stated
 * rounding (everything a user owes rounds up, everything a user receives rounds down).
 */

import type { InterestModel } from "@/types/protocol";
import { bps, BPS, mulDiv, mulDivUp, MS_PER_SECOND, RiskMathError, SECONDS_PER_YEAR, WAD, ZERO } from "./fixed";

/** utilization_bps = borrowed * 10_000 / (cash + borrowed), 0 when both are 0. */
export function utilizationBps(cash: bigint, borrowed: bigint): number {
  const total = cash + borrowed;
  if (total === ZERO) return 0;
  return Number(mulDiv(borrowed, BPS, total));
}

/**
 * Kinked model:
 *   U <= U_opt : base + slope1 * U / U_opt
 *   U >  U_opt : base + slope1 + slope2 * (U - U_opt) / (10_000 - U_opt)
 */
export function borrowAprBps(model: InterestModel, utilization: number): number {
  const base = bps(model.base_bps, "base_bps");
  const slope1 = bps(model.slope1_bps, "slope1_bps");
  const slope2 = bps(model.slope2_bps, "slope2_bps");
  const optimal = bps(model.optimal_utilization_bps, "optimal_utilization_bps");
  const u = bps(utilization, "utilization_bps");
  if (u > BPS) throw new RiskMathError("utilization above 100%");
  if (u <= optimal) {
    if (optimal === ZERO) return Number(base);
    return Number(base + (slope1 * u) / optimal);
  }
  const excessRange = BPS - optimal;
  if (excessRange === ZERO) return Number(base + slope1);
  return Number(base + slope1 + (slope2 * (u - optimal)) / excessRange);
}

/** supply_apr_bps = borrow_apr_bps * U / 10_000 * (10_000 - reserve_factor_bps) / 10_000 */
export function supplyAprBps(borrowApr: number, utilization: number, reserveFactorBps: number): number {
  const apr = BigInt(Math.max(0, Math.trunc(borrowApr)));
  const u = bps(utilization, "utilization_bps");
  const reserve = bps(reserveFactorBps, "reserve_factor_bps");
  if (reserve > BPS) throw new RiskMathError("reserve factor above 100%");
  return Number((((apr * u) / BPS) * (BPS - reserve)) / BPS);
}

/**
 * borrow_index_new = borrow_index * (1e18 + borrow_apr_bps * 1e18 / 10_000 * dt_sec / 31_536_000) / 1e18
 * Evaluated left to right with floor division, as written in the spec.
 */
export function accrueBorrowIndex(borrowIndex: bigint, aprBps: number, dtSec: bigint): bigint {
  if (dtSec <= ZERO) return borrowIndex;
  const apr = BigInt(Math.max(0, Math.trunc(aprBps)));
  const rate = (((apr * WAD) / BPS) * dtSec) / SECONDS_PER_YEAR;
  return mulDiv(borrowIndex, WAD + rate, WAD);
}

/** debt(account) = scaled_debt * borrow_index / 1e18, rounded up (the borrower owes the dust). */
export function debtFromScaled(scaledDebt: bigint, borrowIndex: bigint): bigint {
  return mulDivUp(scaledDebt, borrowIndex, WAD);
}

/** scaled_debt added by a borrow = principal * 1e18 / index, rounded up. */
export function scaledForBorrow(principal: bigint, borrowIndex: bigint): bigint {
  if (borrowIndex <= ZERO) throw new RiskMathError("borrow index must be positive");
  return mulDivUp(principal, WAD, borrowIndex);
}

/** scaled_debt removed by a repayment = repay * 1e18 / index, rounded down. */
export function scaledForRepay(repay: bigint, borrowIndex: bigint): bigint {
  if (borrowIndex <= ZERO) throw new RiskMathError("borrow index must be positive");
  return mulDiv(repay, WAD, borrowIndex);
}

/* ------------------------------------------------------------------ */
/* Pool accrual                                                         */
/* ------------------------------------------------------------------ */

export interface PoolState {
  cash: bigint;
  totalBorrowed: bigint;
  reserves: bigint;
  borrowIndex: bigint;
  lastAccrualMs: number;
}

export interface AccrualResult extends PoolState {
  interest: bigint;
  reserveIncrease: bigint;
  utilizationBps: number;
  borrowAprBps: number;
}

/**
 * Bring a pool's index forward to `nowMs` with the APR in force since the last accrual.
 *   total_borrowed_new = total_borrowed * index_new / index_old  (rounded up: debt never shrinks)
 *   interest           = total_borrowed_new - total_borrowed_old
 *   reserves          += interest * reserve_factor_bps / 10_000  (rest accrues to suppliers)
 */
export function accruePool(pool: PoolState, model: InterestModel, reserveFactorBps: number, nowMs: number): AccrualResult {
  const utilization = utilizationBps(pool.cash, pool.totalBorrowed);
  const apr = borrowAprBps(model, utilization);
  const elapsedMs = Math.max(0, Math.trunc(nowMs) - Math.trunc(pool.lastAccrualMs));
  const dtSec = BigInt(elapsedMs) / MS_PER_SECOND;
  if (dtSec === ZERO || pool.totalBorrowed === ZERO) {
    // Keep sub-second remainders for the next accrual: only advance the clock by whole seconds.
    const advancedMs = pool.totalBorrowed === ZERO ? Math.max(pool.lastAccrualMs, Math.trunc(nowMs)) : pool.lastAccrualMs;
    return { ...pool, lastAccrualMs: advancedMs, interest: ZERO, reserveIncrease: ZERO, utilizationBps: utilization, borrowAprBps: apr };
  }
  const index = accrueBorrowIndex(pool.borrowIndex, apr, dtSec);
  const totalBorrowed = mulDivUp(pool.totalBorrowed, index, pool.borrowIndex);
  const interest = totalBorrowed - pool.totalBorrowed;
  const reserveIncrease = mulDiv(interest, bps(reserveFactorBps, "reserve_factor_bps"), BPS);
  return {
    cash: pool.cash,
    totalBorrowed,
    reserves: pool.reserves + reserveIncrease,
    borrowIndex: index,
    lastAccrualMs: pool.lastAccrualMs + Number(dtSec * MS_PER_SECOND),
    interest,
    reserveIncrease,
    utilizationBps: utilization,
    borrowAprBps: apr,
  };
}

/** Debt of `principal` borrowed at `startIndex` once the index has grown to `currentIndex`. */
export function debtGrowth(principal: bigint, startIndex: bigint, currentIndex: bigint): bigint {
  return debtFromScaled(scaledForBorrow(principal, startIndex), currentIndex);
}

/* ------------------------------------------------------------------ */
/* Supply shares                                                        */
/* ------------------------------------------------------------------ */

/** Underlying owned by suppliers: cash + borrowed - reserves. */
export function supplyUnderlying(cash: bigint, totalBorrowed: bigint, reserves: bigint): bigint {
  const gross = cash + totalBorrowed;
  return gross > reserves ? gross - reserves : ZERO;
}

/** Shares minted for a supply of `amount` (rounded down). 1:1 for the first supplier. */
export function sharesForSupply(amount: bigint, totalShares: bigint, underlying: bigint): bigint {
  if (totalShares === ZERO || underlying === ZERO) return amount;
  return mulDiv(amount, totalShares, underlying);
}

/** Shares burned to withdraw `amount` of underlying (rounded up, the withdrawer pays the dust). */
export function sharesForWithdraw(amount: bigint, totalShares: bigint, underlying: bigint): bigint {
  if (underlying === ZERO) throw new RiskMathError("pool has no underlying");
  return mulDivUp(amount, totalShares, underlying);
}

/** Underlying owned by `shares` (rounded down). */
export function underlyingForShares(shares: bigint, totalShares: bigint, underlying: bigint): bigint {
  if (totalShares === ZERO) return ZERO;
  return mulDiv(shares, underlying, totalShares);
}
