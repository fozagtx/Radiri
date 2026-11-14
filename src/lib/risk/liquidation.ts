/**
 * Liquidation, docs/ARCHITECTURE.md section 4:
 *
 *   max_repay       = debt(borrower, debt_token) * close_factor_bps / 10_000   (close_factor_bps = 5_000)
 *   repay           = min(transferred_amount, max_repay)
 *   seize_value_wad = value_wad(repay, debt_price) * (10_000 + liquidation_bonus_bps(collateral)) / 10_000
 *   seize_amount    = seize_value_wad * 10^collateral_decimals / collateral_price   (rounded down)
 *   if seize_amount > borrower collateral: seize all, scale repay down proportionally (rounded up)
 *   refund          = transferred_amount - repay
 *
 * Only valid when the borrower is liquidatable and every price is fresh; `liquidationQuote`
 * enforces both when given the account context.
 */

import { BPS, CLOSE_FACTOR_BPS, mulDiv, mulDivUp, pow10, RiskMathError, ZERO } from "./fixed";
import { valueWad } from "./account";

export interface LiquidationInput {
  /** Borrower's current debt in the debt token (base units). */
  debtAmount: bigint;
  /** Amount the liquidator transferred with ft_transfer_call. */
  transferredAmount: bigint;
  debtPriceWad: bigint;
  debtDecimals: number;
  /** Borrower's collateral balance in the collateral token. */
  collateralAmount: bigint;
  collateralPriceWad: bigint;
  collateralDecimals: number;
  liquidationBonusBps: number;
  closeFactorBps?: number;
}

export interface LiquidationResult {
  maxRepay: bigint;
  repay: bigint;
  seizeValueWad: bigint;
  seizeAmount: bigint;
  refund: bigint;
  /** True when the seize hit the borrower's collateral balance and repay was scaled down. */
  seizeCapped: boolean;
}

export function computeLiquidation(input: LiquidationInput): LiquidationResult {
  const closeFactor = BigInt(input.closeFactorBps ?? CLOSE_FACTOR_BPS);
  if (input.debtPriceWad <= ZERO || input.collateralPriceWad <= ZERO) {
    throw new RiskMathError("liquidation needs positive prices");
  }
  if (input.liquidationBonusBps < 0) throw new RiskMathError("liquidation bonus must not be negative");

  const maxRepay = mulDiv(input.debtAmount, closeFactor, BPS);
  let repay = input.transferredAmount < maxRepay ? input.transferredAmount : maxRepay;
  const bonusFactor = BPS + BigInt(input.liquidationBonusBps);

  let seizeValue = mulDiv(valueWad(repay, input.debtPriceWad, input.debtDecimals), bonusFactor, BPS);
  let seizeAmount = mulDiv(seizeValue, pow10(input.collateralDecimals), input.collateralPriceWad);
  let seizeCapped = false;

  if (seizeAmount > input.collateralAmount) {
    // Seize everything and pay proportionally less: repay * collateral / seize, rounded up.
    repay = mulDivUp(repay, input.collateralAmount, seizeAmount);
    seizeAmount = input.collateralAmount;
    seizeValue = valueWad(seizeAmount, input.collateralPriceWad, input.collateralDecimals);
    seizeCapped = true;
  }

  return {
    maxRepay,
    repay,
    seizeValueWad: seizeValue,
    seizeAmount,
    refund: input.transferredAmount - repay,
    seizeCapped,
  };
}
