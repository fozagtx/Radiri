/**
 * Account valuation and health, mirroring docs/ARCHITECTURE.md section 4:
 *
 *   value_wad(amount, price_wad, decimals) = amount * price_wad / 10^decimals
 *   borrow_limit_wad   = Σ_collateral value_wad * ltv_bps / 10_000
 *   liq_threshold_wad  = Σ_collateral value_wad * liquidation_threshold_bps / 10_000
 *   debt_wad           = Σ_debt value_wad(debt_amount)
 *   health_factor_wad  = liq_threshold_wad * 1e18 / debt_wad   (null when debt_wad == 0)
 *   can_borrow         : debt_wad_after <= borrow_limit_wad
 *   can_withdraw       : debt_wad <= borrow_limit_wad_after
 *   liquidatable       : debt_wad > liq_threshold_wad
 *
 * Rounding: collateral value rounds down, debt value rounds up (in the protocol's favour).
 * Each per-asset term is rounded, then summed.
 */

import type { AccountView, AssetView } from "@/types/protocol";
import { BPS, divUp, mulDiv, mulDivUp, pow10, saturatingSub, u128, u128OrZero, WAD, ZERO } from "./fixed";
import { checkPrice, type PriceCheck } from "./oracle";

export type AssetMap = ReadonlyMap<string, AssetView>;

export function assetMap(assets: readonly AssetView[]): Map<string, AssetView> {
  return new Map(assets.map((asset) => [asset.config.token_id, asset]));
}

/** Collateral-side value: rounds down. */
export function valueWad(amount: bigint, priceWad: bigint, decimals: number): bigint {
  return mulDiv(amount, priceWad, pow10(decimals));
}

/** Debt-side value: rounds up. */
export function debtValueWad(amount: bigint, priceWad: bigint, decimals: number): bigint {
  return mulDivUp(amount, priceWad, pow10(decimals));
}

export function healthFactorWad(liquidationThresholdWad: bigint, debtWad: bigint): bigint | null {
  if (debtWad === ZERO) return null;
  return mulDiv(liquidationThresholdWad, WAD, debtWad);
}

export function isLiquidatable(liquidationThresholdWad: bigint, debtWad: bigint): boolean {
  return debtWad > liquidationThresholdWad;
}

/* ------------------------------------------------------------------ */
/* Holdings                                                             */
/* ------------------------------------------------------------------ */

/** An account's balances in base units, keyed by token id. */
export interface Holdings {
  collateral: Record<string, bigint>;
  debt: Record<string, bigint>;
  /** Underlying owed to the account for its supply shares. Not part of health. */
  supplied: Record<string, bigint>;
}

export function emptyHoldings(): Holdings {
  return { collateral: {}, debt: {}, supplied: {} };
}

export function holdingsFromAccount(account: AccountView | null): Holdings {
  const holdings = emptyHoldings();
  if (!account) return holdings;
  for (const line of account.collateral) holdings.collateral[line.token_id] = u128OrZero(line.amount);
  for (const line of account.borrowed) holdings.debt[line.token_id] = u128OrZero(line.amount);
  for (const line of account.supplied) holdings.supplied[line.token_id] = u128OrZero(line.amount);
  return holdings;
}

export function cloneHoldings(holdings: Holdings): Holdings {
  return {
    collateral: { ...holdings.collateral },
    debt: { ...holdings.debt },
    supplied: { ...holdings.supplied },
  };
}

function positive(record: Record<string, bigint>): [string, bigint][] {
  return Object.entries(record).filter(([, amount]) => amount > ZERO);
}

/* ------------------------------------------------------------------ */
/* Account risk                                                         */
/* ------------------------------------------------------------------ */

export interface PricedAsset {
  asset: AssetView | undefined;
  priceWad: bigint | null;
  price: PriceCheck;
}

/** Price of an asset as the risk engine sees it. Freshness requires the view flag AND the local clock. */
export function pricedAsset(assets: AssetMap, tokenId: string, nowMs: number): PricedAsset {
  const asset = assets.get(tokenId);
  if (!asset) {
    return { asset, priceWad: null, price: { status: "missing", fresh: false, ageMs: null, maxAgeMs: 0 } };
  }
  const check = checkPrice(asset.price, asset.config.max_price_age_sec, nowMs);
  let priceWad: bigint | null = null;
  if (asset.price) {
    try {
      priceWad = u128(asset.price.price_wad, "price_wad");
    } catch {
      priceWad = null;
    }
  }
  const fresh = check.fresh && asset.price_fresh !== false;
  const price: PriceCheck = fresh || check.status !== "fresh" ? check : { ...check, status: "stale", fresh: false };
  return { asset, priceWad, price };
}

export interface CollateralLine {
  tokenId: string;
  amount: bigint;
  priceWad: bigint | null;
  valueWad: bigint;
  borrowLimitWad: bigint;
  liquidationThresholdWad: bigint;
  price: PriceCheck;
}

export interface DebtLine {
  tokenId: string;
  amount: bigint;
  priceWad: bigint | null;
  valueWad: bigint;
  price: PriceCheck;
}

export interface AccountRisk {
  collateral: CollateralLine[];
  debt: DebtLine[];
  collateralValueWad: bigint;
  borrowLimitWad: bigint;
  liquidationThresholdWad: bigint;
  debtValueWad: bigint;
  healthFactorWad: bigint | null;
  /** borrow_limit - debt, clamped at zero. */
  availableToBorrowWad: bigint;
  /** debt / collateral value in bps, null without collateral value. */
  ltvBps: number | null;
  /** Every asset with a balance has a fresh price. */
  pricesFresh: boolean;
  liquidatable: boolean;
  /** Token ids with a balance but no usable price (valued at 0). */
  unpricedTokens: string[];
  /** Token ids with a balance whose price is stale. */
  staleTokens: string[];
  /** Token ids with a balance that the market list does not contain. */
  unknownTokens: string[];
}

export function computeAccountRisk(assets: AssetMap, holdings: Holdings, nowMs: number): AccountRisk {
  const collateral: CollateralLine[] = [];
  const debt: DebtLine[] = [];
  const unpriced = new Set<string>();
  const stale = new Set<string>();
  const unknown = new Set<string>();
  let collateralValue = ZERO;
  let borrowLimit = ZERO;
  let liqThreshold = ZERO;
  let debtValue = ZERO;

  for (const [tokenId, amount] of positive(holdings.collateral)) {
    const { asset, priceWad, price } = pricedAsset(assets, tokenId, nowMs);
    if (!asset) unknown.add(tokenId);
    if (priceWad === null || priceWad === ZERO) unpriced.add(tokenId);
    else if (!price.fresh) stale.add(tokenId);
    const value = asset && priceWad ? valueWad(amount, priceWad, asset.config.decimals) : ZERO;
    const limit = asset ? mulDiv(value, BigInt(asset.config.ltv_bps), BPS) : ZERO;
    const threshold = asset ? mulDiv(value, BigInt(asset.config.liquidation_threshold_bps), BPS) : ZERO;
    collateralValue += value;
    borrowLimit += limit;
    liqThreshold += threshold;
    collateral.push({ tokenId, amount, priceWad, valueWad: value, borrowLimitWad: limit, liquidationThresholdWad: threshold, price });
  }

  for (const [tokenId, amount] of positive(holdings.debt)) {
    const { asset, priceWad, price } = pricedAsset(assets, tokenId, nowMs);
    if (!asset) unknown.add(tokenId);
    if (priceWad === null || priceWad === ZERO) unpriced.add(tokenId);
    else if (!price.fresh) stale.add(tokenId);
    const value = asset && priceWad ? debtValueWad(amount, priceWad, asset.config.decimals) : ZERO;
    debtValue += value;
    debt.push({ tokenId, amount, priceWad, valueWad: value, price });
  }

  return {
    collateral,
    debt,
    collateralValueWad: collateralValue,
    borrowLimitWad: borrowLimit,
    liquidationThresholdWad: liqThreshold,
    debtValueWad: debtValue,
    healthFactorWad: healthFactorWad(liqThreshold, debtValue),
    availableToBorrowWad: saturatingSub(borrowLimit, debtValue),
    ltvBps: collateralValue === ZERO ? null : Number(mulDivUp(debtValue, BPS, collateralValue)),
    pricesFresh: unpriced.size === 0 && stale.size === 0 && unknown.size === 0,
    liquidatable: isLiquidatable(liqThreshold, debtValue),
    unpricedTokens: [...unpriced],
    staleTokens: [...stale],
    unknownTokens: [...unknown],
  };
}

/* ------------------------------------------------------------------ */
/* Max borrow / max withdraw                                            */
/* ------------------------------------------------------------------ */

/**
 * Largest additional amount of `tokenId` the account can borrow before debt_wad_after exceeds
 * borrow_limit_wad, health only (liquidity, caps and freshness are checked in preview.ts).
 * Exact under the rounding rules: debt value of a token is ceil((d + x) * p / 10^dec), and
 * ceil(y) <= L  <=>  y <= L for integer L.
 */
export function maxBorrowByHealth(assets: AssetMap, holdings: Holdings, tokenId: string, nowMs: number): bigint {
  const asset = assets.get(tokenId);
  if (!asset || !asset.price) return ZERO;
  const priceWad = u128(asset.price.price_wad, "price_wad");
  if (priceWad === ZERO) return ZERO;
  const risk = computeAccountRisk(assets, holdings, nowMs);
  const existing = holdings.debt[tokenId] ?? ZERO;
  const unit = pow10(asset.config.decimals);
  const existingValue = existing > ZERO ? debtValueWad(existing, priceWad, asset.config.decimals) : ZERO;
  const otherDebt = risk.debtValueWad - existingValue;
  if (otherDebt >= risk.borrowLimitWad) return ZERO;
  const room = risk.borrowLimitWad - otherDebt;
  const maxTotal = mulDiv(room, unit, priceWad);
  return saturatingSub(maxTotal, existing);
}

/**
 * Largest amount of collateral `tokenId` the account can withdraw while keeping
 * debt_wad <= borrow_limit_wad_after. Exact inverse of the floor rounding of the limit.
 */
export function maxWithdrawByHealth(assets: AssetMap, holdings: Holdings, tokenId: string, nowMs: number): bigint {
  const balance = holdings.collateral[tokenId] ?? ZERO;
  if (balance === ZERO) return ZERO;
  const risk = computeAccountRisk(assets, holdings, nowMs);
  if (risk.debtValueWad === ZERO) return balance;
  const asset = assets.get(tokenId);
  const line = risk.collateral.find((item) => item.tokenId === tokenId);
  if (!asset || !line) return ZERO;
  const otherLimit = risk.borrowLimitWad - line.borrowLimitWad;
  if (risk.debtValueWad <= otherLimit) return balance;
  const ltv = BigInt(asset.config.ltv_bps);
  if (ltv === ZERO || line.priceWad === null || line.priceWad === ZERO) return ZERO;
  const needLimit = risk.debtValueWad - otherLimit;
  // floor(v * ltv / 1e4) >= need  <=>  v >= ceil(need * 1e4 / ltv)
  const minValue = mulDivUp(needLimit, BPS, ltv);
  // floor(c * p / 10^d) >= minValue  <=>  c >= ceil(minValue * 10^d / p)
  const minRemaining = mulDivUp(minValue, pow10(asset.config.decimals), line.priceWad);
  return saturatingSub(balance, minRemaining);
}

/* ------------------------------------------------------------------ */
/* Liquidation price                                                    */
/* ------------------------------------------------------------------ */

/**
 * Price of `tokenId` (wad, USD per whole token) at which the account becomes liquidatable,
 * holding every other price constant. Null when the account has no debt or this collateral
 * alone cannot push it under. Display only.
 */
export function liquidationPriceWad(assets: AssetMap, holdings: Holdings, tokenId: string, nowMs: number): bigint | null {
  const amount = holdings.collateral[tokenId] ?? ZERO;
  const asset = assets.get(tokenId);
  if (!asset || amount === ZERO) return null;
  const risk = computeAccountRisk(assets, holdings, nowMs);
  if (risk.debtValueWad === ZERO) return null;
  const line = risk.collateral.find((item) => item.tokenId === tokenId);
  const otherThreshold = risk.liquidationThresholdWad - (line?.liquidationThresholdWad ?? ZERO);
  // Debt of the same token moves with its price too; keep the estimate simple and say so.
  const debtSameToken = risk.debt.find((item) => item.tokenId === tokenId);
  if (debtSameToken) return null;
  if (risk.debtValueWad <= otherThreshold) return null;
  const gap = risk.debtValueWad - otherThreshold;
  const threshold = BigInt(asset.config.liquidation_threshold_bps);
  if (threshold === ZERO) return null;
  // amount * p / 10^d * lt / 1e4 = gap  ->  p = gap * 1e4 * 10^d / (amount * lt)
  return divUp(gap * BPS * pow10(asset.config.decimals), amount * threshold);
}
