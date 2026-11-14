/**
 * Shared artifacts generated from the TypeScript side (see scripts/gen-lending-artifacts.ts):
 * the contract's register_asset arguments and cross-language math vectors. The Rust contract's
 * vector test asserts the same inputs give the same outputs, which pins the two implementations
 * together; src/lib/risk/vectors.test.ts fails when the committed files drift from this code.
 */
import { LENDING_ASSETS } from "@/config/lending-assets";
import type { AssetConfig, InterestModel } from "@/types/protocol";
import { debtValueWad, healthFactorWad, valueWad } from "./account";
import { accrueBorrowIndex, borrowAprBps, supplyAprBps, utilizationBps } from "./interest";
import { computeLiquidation } from "./liquidation";

/** Deploy-time token ids use this suffix; deploy-lending.sh rewrites it to the deploying account. */
export const ARTIFACT_TOKEN_SUFFIX = "radiri.testnet";

export function buildAssetsJson(): AssetConfig[] {
  return LENDING_ASSETS.map((spec) => ({
    ...spec.config,
    token_id: `${spec.config.symbol.toLowerCase()}.${ARTIFACT_TOKEN_SUFFIX}`,
  }));
}

export interface MathVector {
  fn: string;
  input: Record<string, string | number | InterestModel>;
  expected: Record<string, string | number | boolean | null>;
}

const W = BigInt("1000000000000000000");
const big = (value: string) => BigInt(value);
const MEME = LENDING_ASSETS.find((spec) => spec.config.category === "meme")!.config.interest;
const STOCK = LENDING_ASSETS.find((spec) => spec.config.category === "stock")!.config.interest;

export function buildMathVectors(): MathVector[] {
  const vectors: MathVector[] = [];

  const values: [string, string, number][] = [
    ["1000000000000000000000000000", "4400000000000", 18], // 1e9 PEPE at $0.0000044 (overflows u128 without a wide mul)
    ["2500000000", (BigInt(35552) * W / BigInt(100)).toString(), 8], // 25 tAAPL at $355.52
    ["5000000000", "148000000000000000", 6], // 5,000 WIF at $0.148
    ["1", "4400000000000", 18], // dust: rounds down to 0, debt rounds up
    ["0", "4400000000000", 18],
  ];
  for (const [amount, price, decimals] of values) {
    vectors.push({
      fn: "value_wad",
      input: { amount, price_wad: price, decimals },
      expected: {
        value_wad: valueWad(big(amount), big(price), decimals).toString(),
        debt_value_wad: debtValueWad(big(amount), big(price), decimals).toString(),
      },
    });
  }

  const health: [string, string][] = [
    [(BigInt(3520) * W).toString(), (BigInt(35552) * W / BigInt(100)).toString()],
    [W.toString(), W.toString()],
    [(BigInt(999) * W / BigInt(1000)).toString(), W.toString()],
    [W.toString(), "0"],
  ];
  for (const [threshold, debt] of health) {
    const hf = healthFactorWad(big(threshold), big(debt));
    vectors.push({
      fn: "health_factor_wad",
      input: { liquidation_threshold_wad: threshold, debt_value_wad: debt },
      expected: { health_factor_wad: hf === null ? null : hf.toString() },
    });
  }

  const utilizations: [string, string][] = [
    ["0", "0"],
    ["99900000000", "100000000"],
    ["1", "3"],
    ["0", "5"],
  ];
  for (const [cash, borrowed] of utilizations) {
    vectors.push({
      fn: "utilization_bps",
      input: { cash, borrowed },
      expected: { utilization_bps: utilizationBps(big(cash), big(borrowed)) },
    });
  }

  const rates: [InterestModel, number, number][] = [
    [MEME, 0, 2000],
    [MEME, 3000, 2000],
    [MEME, 6000, 2000],
    [MEME, 8000, 2000],
    [MEME, 10000, 2000],
    [STOCK, 7000, 1500],
    [STOCK, 9500, 1500],
  ];
  for (const [model, utilization, reserveFactor] of rates) {
    const apr = borrowAprBps(model, utilization);
    vectors.push({
      fn: "interest_rates",
      input: { model, utilization_bps: utilization, reserve_factor_bps: reserveFactor },
      expected: { borrow_apr_bps: apr, supply_apr_bps: supplyAprBps(apr, utilization, reserveFactor) },
    });
  }

  const accruals: [string, number, string][] = [
    [W.toString(), 1200, "31536000"],
    [W.toString(), 200, "3600"],
    [(BigInt(1_050_000) * W / BigInt(1_000_000)).toString(), 31_400, "86400"],
    [W.toString(), 0, "86400"],
  ];
  for (const [index, apr, dt] of accruals) {
    vectors.push({
      fn: "accrue_index",
      input: { borrow_index: index, apr_bps: apr, dt_sec: dt },
      expected: { borrow_index: accrueBorrowIndex(big(index), apr, big(dt)).toString() },
    });
  }

  const tAAPL = (BigInt(35552) * W / BigInt(100)).toString();
  const liquidations = [
    // Normal: liquidator repays within the close factor, seizes tPEPE with a 15% bonus.
    { debt: "100000000", transferred: "40000000", debtPrice: tAAPL, debtDec: 8, coll: "2000000000000000000000000000", collPrice: "4400000000000", collDec: 18, bonus: 1500 },
    // Over-pays: repay clipped to the 50% close factor, the rest refunded.
    { debt: "100000000", transferred: "100000000", debtPrice: tAAPL, debtDec: 8, coll: "2000000000000000000000000000", collPrice: "4400000000000", collDec: 18, bonus: 1500 },
    // Collateral exhausted: seize capped at the borrower's balance, repay scaled down.
    { debt: "100000000", transferred: "50000000", debtPrice: tAAPL, debtDec: 8, coll: "10000000000000000000000000", collPrice: "4400000000000", collDec: 18, bonus: 1500 },
  ];
  for (const item of liquidations) {
    const result = computeLiquidation({
      debtAmount: big(item.debt),
      transferredAmount: big(item.transferred),
      debtPriceWad: big(item.debtPrice),
      debtDecimals: item.debtDec,
      collateralAmount: big(item.coll),
      collateralPriceWad: big(item.collPrice),
      collateralDecimals: item.collDec,
      liquidationBonusBps: item.bonus,
      closeFactorBps: 5000,
    });
    vectors.push({
      fn: "liquidation",
      input: {
        debt_amount: item.debt,
        transferred_amount: item.transferred,
        debt_price_wad: item.debtPrice,
        debt_decimals: item.debtDec,
        borrower_collateral: item.coll,
        collateral_price_wad: item.collPrice,
        collateral_decimals: item.collDec,
        liquidation_bonus_bps: item.bonus,
        close_factor_bps: 5000,
      },
      expected: {
        max_repay: result.maxRepay.toString(),
        repay: result.repay.toString(),
        seize_value_wad: result.seizeValueWad.toString(),
        seize_amount: result.seizeAmount.toString(),
        refund: result.refund.toString(),
        capped: result.seizeCapped,
      },
    });
  }

  return vectors;
}
