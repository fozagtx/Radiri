import type { AssetConfig } from "@/types/protocol";

/**
 * Canonical lending asset table. It drives:
 *   - contracts/lending/assets.testnet.json (register_asset calls in scripts/deploy-lending.sh),
 *   - the labelled SimulatedLendingClient when no lending contract is configured,
 *   - collateral / borrow eligibility in /api/assets before a contract is deployed.
 * When a contract is configured, its on-chain registry is authoritative and this table is ignored.
 *
 * Every token here is a TESTNET TEST TOKEN with no value. Each one's oracle price mirrors a real
 * reference asset (`referenceSymbol`) priced by 1Click `/v0/tokens`: the meme coin itself, or for
 * stocks the Ondo Global Markets tokenized stock (AAPLon, TSLAon, NVDAon on BNB Chain).
 *
 * Risk parameters are conservative testnet starting points, not production values. Rationale:
 *   - Meme coins: daily moves of 20-40% are common, so LTV 25% / liquidation at 40% leaves a
 *     ~37% price drop between the borrow limit and liquidation, and a 15% bonus keeps liquidators
 *     paid through thin liquidity. Max price age 300 s (the reporter pushes every 60 s).
 *   - Tokenized stocks: lower volatility but market-hours pricing, so LTV 50% / liquidation at
 *     65% and an 8% bonus. Max price age 900 s: if the reference price stops updating (for
 *     example outside market hours), new borrows and liquidations against stocks are blocked.
 * Production values require a volatility and liquidity study per asset.
 */

export interface LendingAssetSpec {
  config: AssetConfig;
  /** Real asset whose price the oracle mirrors. */
  referenceSymbol: string;
  /** Where the reference price comes from: the live 1Click `/v0/tokens` catalog. */
  referenceSource: "1click";
  /** Human-readable name shown in the UI. */
  name: string;
}

const MEME_INTEREST = { base_bps: 200, slope1_bps: 1200, slope2_bps: 30000, optimal_utilization_bps: 6000 };
const STOCK_INTEREST = { base_bps: 100, slope1_bps: 800, slope2_bps: 20000, optimal_utilization_bps: 7000 };

/** Account suffix the deploy script uses for test tokens, e.g. tpepe.<suffix>. */
export const TEST_TOKEN_SUFFIX = process.env.NEXT_PUBLIC_TEST_TOKEN_SUFFIX ?? "radiri.testnet";

function meme(symbol: string, reference: string, decimals: number, collateralCapWhole: bigint, name: string): LendingAssetSpec {
  const unit = BigInt(10) ** BigInt(decimals);
  return {
    name,
    referenceSymbol: reference,
    referenceSource: "1click",
    config: {
      token_id: `${symbol.toLowerCase()}.${TEST_TOKEN_SUFFIX}`,
      symbol,
      decimals,
      category: "meme",
      can_collateralize: true,
      can_borrow: true,
      ltv_bps: 2500,
      liquidation_threshold_bps: 4000,
      liquidation_bonus_bps: 1500,
      reserve_factor_bps: 2000,
      collateral_cap: (collateralCapWhole * unit).toString(),
      borrow_cap: "0",
      interest: MEME_INTEREST,
      max_price_age_sec: 300,
      max_price_change_bps: 5000,
      paused: false,
    },
  };
}

function stock(symbol: string, reference: string, collateralCapWhole: bigint, name: string): LendingAssetSpec {
  const decimals = 8;
  const unit = BigInt(10) ** BigInt(decimals);
  return {
    name,
    referenceSymbol: reference,
    referenceSource: "1click",
    config: {
      token_id: `${symbol.toLowerCase()}.${TEST_TOKEN_SUFFIX}`,
      symbol,
      decimals,
      category: "stock",
      can_collateralize: true,
      can_borrow: true,
      ltv_bps: 5000,
      liquidation_threshold_bps: 6500,
      liquidation_bonus_bps: 800,
      reserve_factor_bps: 1500,
      collateral_cap: (collateralCapWhole * unit).toString(),
      borrow_cap: "0",
      interest: STOCK_INTEREST,
      max_price_age_sec: 900,
      max_price_change_bps: 2000,
      paused: false,
    },
  };
}

/** Collateral caps are protocol-wide concentration limits, in whole tokens. */
export const LENDING_ASSETS: LendingAssetSpec[] = [
  meme("tPEPE", "PEPE", 18, BigInt(500_000_000_000), "Radiri Test PEPE (no value)"),
  meme("tWIF", "$WIF", 6, BigInt(20_000_000), "Radiri Test WIF (no value)"),
  meme("tSHIB", "SHIB", 18, BigInt(500_000_000_000), "Radiri Test SHIB (no value)"),
  meme("tBRETT", "BRETT", 18, BigInt(500_000_000), "Radiri Test BRETT (no value)"),
  stock("tAAPL", "AAPLon", BigInt(10_000), "Radiri Test Apple stock (no value)"),
  stock("tTSLA", "TSLAon", BigInt(10_000), "Radiri Test Tesla stock (no value)"),
  stock("tNVDA", "NVDAon", BigInt(10_000), "Radiri Test NVIDIA stock (no value)"),
];

export function lendingAssetByTokenId(tokenId: string): LendingAssetSpec | undefined {
  return LENDING_ASSETS.find((asset) => asset.config.token_id === tokenId);
}

export function lendingAssetBySymbol(symbol: string): LendingAssetSpec | undefined {
  return LENDING_ASSETS.find((asset) => asset.config.symbol.toLowerCase() === symbol.toLowerCase());
}
