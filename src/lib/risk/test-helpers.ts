/**
 * Fixtures for the risk-engine tests. Built from the canonical lending asset table so the tests
 * exercise the real risk parameters (meme LTV 25% / LT 40%, stock LTV 50% / LT 65%).
 */

import { LENDING_ASSETS } from "@/config/lending-assets";
import type { AssetConfig, AssetView } from "@/types/protocol";
import { assetMap } from "./account";
import { WAD } from "./fixed";
import type { MarketContext } from "./preview";

export const NOW_MS = 1_763_000_000_000;

export function configOf(symbol: string, overrides: Partial<AssetConfig> = {}): AssetConfig {
  const spec = LENDING_ASSETS.find((asset) => asset.config.symbol === symbol);
  if (!spec) throw new Error(`unknown fixture asset ${symbol}`);
  return { ...spec.config, ...overrides };
}

export interface ViewOptions {
  priceWad?: bigint | null;
  ageSec?: number;
  cash?: bigint;
  borrowed?: bigint;
  collateral?: bigint;
  priceFresh?: boolean;
  config?: Partial<AssetConfig>;
}

export function assetView(symbol: string, options: ViewOptions = {}): AssetView {
  const config = configOf(symbol, options.config);
  const priceWad = options.priceWad === undefined ? null : options.priceWad;
  return {
    config,
    cash: (options.cash ?? BigInt(0)).toString(),
    total_borrowed: (options.borrowed ?? BigInt(0)).toString(),
    reserves: "0",
    total_collateral: (options.collateral ?? BigInt(0)).toString(),
    total_supply_shares: (options.cash ?? BigInt(0)).toString(),
    borrow_index: WAD.toString(),
    utilization_bps: 0,
    borrow_apr_bps: config.interest.base_bps,
    supply_apr_bps: 0,
    price: priceWad === null ? null : { price_wad: priceWad.toString(), timestamp_ms: NOW_MS - (options.ageSec ?? 10) * 1000 },
    price_fresh: options.priceFresh ?? true,
    last_accrual_ms: NOW_MS,
  };
}

export const PEPE = configOf("tPEPE").token_id;
export const WIF = configOf("tWIF").token_id;
export const AAPL = configOf("tAAPL").token_id;
export const TSLA = configOf("tTSLA").token_id;

/** $0.0000044 per PEPE. */
export const PEPE_PRICE = BigInt("4400000000000");
/** $110 per AAPL share (round numbers make exact boundaries easy to reason about). */
export const AAPL_PRICE = WAD * BigInt(110);
export const TSLA_PRICE = WAD * BigInt(250);
/** $2 per WIF. */
export const WIF_PRICE = WAD * BigInt(2);

/** 1e9 whole PEPE = 1e27 base units, $4,400 at the fixture price. */
export const PEPE_BILLION = BigInt(10) ** BigInt(27);

export function market(views: AssetView[], globalPaused = false, nowMs = NOW_MS): MarketContext {
  return { assets: assetMap(views), globalPaused, nowMs };
}

export function standardViews(overrides: Partial<Record<"pepe" | "aapl" | "wif" | "tsla", ViewOptions>> = {}): AssetView[] {
  return [
    assetView("tPEPE", { priceWad: PEPE_PRICE, cash: PEPE_BILLION * BigInt(100), ...overrides.pepe }),
    assetView("tWIF", { priceWad: WIF_PRICE, cash: BigInt(10) ** BigInt(12), ...overrides.wif }),
    assetView("tAAPL", { priceWad: AAPL_PRICE, cash: BigInt(1_000) * BigInt(10) ** BigInt(8), ...overrides.aapl }),
    assetView("tTSLA", { priceWad: TSLA_PRICE, cash: BigInt(1_000) * BigInt(10) ** BigInt(8), ...overrides.tsla }),
  ];
}
