/**
 * Action preview: the account state after a hypothetical deposit / withdraw / supply / borrow /
 * repay, plus every reason the contract would reject it. The UI shows the same reasons before the
 * user signs, so a transaction the contract would reject is never sent.
 *
 * Checks mirror docs/ARCHITECTURE.md section 4:
 *   - global pause blocks deposit, supply, borrow and both withdrawals; repay stays open;
 *   - a paused asset blocks new collateral, supply and borrow of that asset;
 *   - borrow needs fresh prices for every collateral and debt asset plus the borrowed asset,
 *     cash >= amount, the borrow cap, and debt_wad_after <= borrow_limit_wad;
 *   - withdraw_collateral needs fresh prices whenever the account has debt, and
 *     debt_wad <= borrow_limit_wad_after.
 */

import type { LendingAction } from "@/types/protocol";
import {
  type AccountRisk,
  type AssetMap,
  cloneHoldings,
  computeAccountRisk,
  type Holdings,
  maxBorrowByHealth,
  maxWithdrawByHealth,
  pricedAsset,
} from "./account";
import { BPS, minBig, mulDivUp, ONE, saturatingSub, SECONDS_PER_YEAR, u128OrZero, ZERO } from "./fixed";

export type LendingActionKind = LendingAction["kind"];

export type BlockReasonCode =
  | "zero-amount"
  | "unknown-asset"
  | "global-paused"
  | "asset-paused"
  | "not-collateral"
  | "not-borrowable"
  | "collateral-cap"
  | "borrow-cap"
  | "liquidity"
  | "missing-price"
  | "stale-price"
  | "health"
  | "insufficient-balance"
  | "exceeds-position"
  | "no-debt";

export interface BlockReason {
  code: BlockReasonCode;
  message: string;
  tokenId?: string;
}

export interface MarketContext {
  assets: AssetMap;
  /** Global pause from get_config. */
  globalPaused: boolean;
  nowMs: number;
}

export interface PreviewRequest {
  kind: LendingActionKind;
  tokenId: string;
  amount: bigint;
  /** The user's wallet balance of the token, when known (deposit, supply, repay). */
  walletBalance?: bigint | null;
}

export interface ActionPreview {
  request: PreviewRequest;
  /** Amount the contract would actually move (repay is capped to the debt). */
  effectiveAmount: bigint;
  /** Excess the contract refunds (repay above the debt). */
  refund: bigint;
  before: AccountRisk;
  after: AccountRisk;
  holdingsAfter: Holdings;
  reasons: BlockReason[];
  ok: boolean;
}

function symbolOf(ctx: MarketContext, tokenId: string): string {
  return ctx.assets.get(tokenId)?.config.symbol ?? tokenId;
}

/** Every token with a balance in the account, plus `extra`. */
function accountTokens(holdings: Holdings, extra?: string): string[] {
  const tokens = new Set<string>();
  for (const [id, amount] of Object.entries(holdings.collateral)) if (amount > ZERO) tokens.add(id);
  for (const [id, amount] of Object.entries(holdings.debt)) if (amount > ZERO) tokens.add(id);
  if (extra) tokens.add(extra);
  return [...tokens];
}

export function priceReasons(ctx: MarketContext, tokenIds: string[]): BlockReason[] {
  const reasons: BlockReason[] = [];
  for (const tokenId of tokenIds) {
    const { asset, price } = pricedAsset(ctx.assets, tokenId, ctx.nowMs);
    const symbol = symbolOf(ctx, tokenId);
    if (!asset || price.status === "missing" || price.status === "zero") {
      reasons.push({ code: "missing-price", tokenId, message: `${symbol} has no oracle price` });
    } else if (!price.fresh) {
      const age = price.ageMs === null ? "unknown" : `${Math.round(price.ageMs / 1000)} s`;
      reasons.push({
        code: "stale-price",
        tokenId,
        message: `${symbol} price is stale (age ${age}, max ${Math.round(price.maxAgeMs / 1000)} s)`,
      });
    }
  }
  return reasons;
}

function hasDebt(holdings: Holdings): boolean {
  return Object.values(holdings.debt).some((amount) => amount > ZERO);
}

export function previewAction(ctx: MarketContext, holdings: Holdings, request: PreviewRequest): ActionPreview {
  const reasons: BlockReason[] = [];
  const { kind, tokenId, amount } = request;
  const asset = ctx.assets.get(tokenId);
  const symbol = symbolOf(ctx, tokenId);
  const after = cloneHoldings(holdings);
  let effectiveAmount = amount;
  let refund = ZERO;

  if (amount <= ZERO) reasons.push({ code: "zero-amount", message: "Enter an amount above zero" });
  if (!asset) reasons.push({ code: "unknown-asset", tokenId, message: `${symbol} is not registered on the lending contract` });

  const blockedByGlobalPause = kind !== "repay";
  if (ctx.globalPaused && blockedByGlobalPause) {
    reasons.push({ code: "global-paused", message: "The lending contract is paused: only repay is open" });
  }

  const opensExposure = kind === "deposit_collateral" || kind === "supply" || kind === "borrow";
  if (asset?.config.paused && opensExposure) {
    reasons.push({ code: "asset-paused", tokenId, message: `${symbol} is paused for new deposits and borrows` });
  }

  const wallet = request.walletBalance;
  const needsWallet = kind === "deposit_collateral" || kind === "supply" || kind === "repay";
  if (needsWallet && wallet !== undefined && wallet !== null && amount > wallet) {
    reasons.push({ code: "insufficient-balance", tokenId, message: `Wallet holds less ${symbol} than this amount` });
  }

  switch (kind) {
    case "deposit_collateral": {
      if (asset && !asset.config.can_collateralize) {
        reasons.push({ code: "not-collateral", tokenId, message: `${symbol} is not accepted as collateral` });
      }
      if (asset) {
        const cap = u128OrZero(asset.config.collateral_cap);
        const total = u128OrZero(asset.total_collateral);
        if (cap > ZERO && total + amount > cap) {
          reasons.push({ code: "collateral-cap", tokenId, message: `${symbol} collateral cap reached (room ${saturatingSub(cap, total)} base units)` });
        }
      }
      after.collateral[tokenId] = (after.collateral[tokenId] ?? ZERO) + amount;
      break;
    }
    case "withdraw_collateral": {
      const balance = holdings.collateral[tokenId] ?? ZERO;
      if (amount > balance) reasons.push({ code: "exceeds-position", tokenId, message: `More than your ${symbol} collateral` });
      after.collateral[tokenId] = saturatingSub(balance, amount);
      if (hasDebt(holdings)) reasons.push(...priceReasons(ctx, accountTokens(holdings)));
      break;
    }
    case "supply": {
      after.supplied[tokenId] = (after.supplied[tokenId] ?? ZERO) + amount;
      break;
    }
    case "withdraw_supply": {
      const balance = holdings.supplied[tokenId] ?? ZERO;
      if (amount > balance) reasons.push({ code: "exceeds-position", tokenId, message: `More than your ${symbol} supply` });
      if (asset && amount > u128OrZero(asset.cash)) {
        reasons.push({ code: "liquidity", tokenId, message: `Pool has less ${symbol} cash than this amount` });
      }
      after.supplied[tokenId] = saturatingSub(balance, amount);
      break;
    }
    case "borrow": {
      if (asset && !asset.config.can_borrow) {
        reasons.push({ code: "not-borrowable", tokenId, message: `${symbol} cannot be borrowed` });
      }
      if (asset) {
        const cash = u128OrZero(asset.cash);
        if (amount > cash) reasons.push({ code: "liquidity", tokenId, message: `Pool has only ${cash} base units of ${symbol} available` });
        const cap = u128OrZero(asset.config.borrow_cap);
        const borrowed = u128OrZero(asset.total_borrowed);
        if (cap > ZERO && borrowed + amount > cap) {
          reasons.push({ code: "borrow-cap", tokenId, message: `${symbol} borrow cap reached` });
        }
      }
      reasons.push(...priceReasons(ctx, accountTokens(holdings, tokenId)));
      after.debt[tokenId] = (after.debt[tokenId] ?? ZERO) + amount;
      break;
    }
    case "repay": {
      const debt = holdings.debt[tokenId] ?? ZERO;
      if (debt === ZERO) reasons.push({ code: "no-debt", tokenId, message: `No ${symbol} debt to repay` });
      effectiveAmount = minBig(amount, debt);
      refund = amount - effectiveAmount;
      after.debt[tokenId] = debt - effectiveAmount;
      break;
    }
  }

  const beforeRisk = computeAccountRisk(ctx.assets, holdings, ctx.nowMs);
  const afterRisk = computeAccountRisk(ctx.assets, after, ctx.nowMs);

  if (kind === "borrow" && afterRisk.debtValueWad > afterRisk.borrowLimitWad) {
    reasons.push({ code: "health", tokenId, message: "Debt after this borrow would exceed your borrow limit" });
  }
  if (kind === "withdraw_collateral" && afterRisk.debtValueWad > afterRisk.borrowLimitWad) {
    reasons.push({ code: "health", tokenId, message: "Your debt would exceed the borrow limit after this withdrawal" });
  }

  return {
    request,
    effectiveAmount,
    refund,
    before: beforeRisk,
    after: afterRisk,
    holdingsAfter: after,
    reasons,
    ok: reasons.length === 0,
  };
}

/* ------------------------------------------------------------------ */
/* Max amounts for the "Max" buttons                                   */
/* ------------------------------------------------------------------ */

export type MaxLimiter = "wallet" | "health" | "liquidity" | "cap" | "position" | "blocked" | "none";

export interface MaxAmount {
  amount: bigint;
  limitedBy: MaxLimiter;
}

function pick(candidates: [bigint, MaxLimiter][]): MaxAmount {
  let best: MaxAmount = { amount: candidates[0][0], limitedBy: candidates[0][1] };
  for (const [amount, limiter] of candidates.slice(1)) {
    if (amount < best.amount) best = { amount, limitedBy: limiter };
  }
  return best;
}

/** One hour of interest on `debt` at `aprBps`, at least one base unit. */
export function repayBuffer(debt: bigint, aprBps: number): bigint {
  if (debt === ZERO) return ZERO;
  const hour = mulDivUp(debt, BigInt(Math.max(0, aprBps)) * BigInt(3_600), BPS * SECONDS_PER_YEAR);
  return hour > ZERO ? hour : ONE;
}

/**
 * Largest amount that passes previewAction for this action, or zero with `limitedBy: "blocked"`
 * when a non-amount reason (pause, eligibility, stale price) blocks it entirely.
 */
export function maxActionAmount(
  ctx: MarketContext,
  holdings: Holdings,
  kind: LendingActionKind,
  tokenId: string,
  walletBalance?: bigint | null,
): MaxAmount {
  const asset = ctx.assets.get(tokenId);
  if (!asset) return { amount: ZERO, limitedBy: "blocked" };
  const wallet = walletBalance ?? null;
  const blocked = (code: BlockReasonCode[]) =>
    previewAction(ctx, holdings, { kind, tokenId, amount: ONE, walletBalance: null }).reasons.some((reason) =>
      code.includes(reason.code),
    );

  switch (kind) {
    case "deposit_collateral": {
      if (blocked(["global-paused", "asset-paused", "not-collateral"])) return { amount: ZERO, limitedBy: "blocked" };
      const cap = u128OrZero(asset.config.collateral_cap);
      const candidates: [bigint, MaxLimiter][] = [];
      if (wallet !== null) candidates.push([wallet, "wallet"]);
      if (cap > ZERO) candidates.push([saturatingSub(cap, u128OrZero(asset.total_collateral)), "cap"]);
      return candidates.length ? pick(candidates) : { amount: ZERO, limitedBy: "none" };
    }
    case "supply": {
      if (blocked(["global-paused", "asset-paused"])) return { amount: ZERO, limitedBy: "blocked" };
      return wallet !== null ? { amount: wallet, limitedBy: "wallet" } : { amount: ZERO, limitedBy: "none" };
    }
    case "withdraw_collateral": {
      if (blocked(["global-paused", "stale-price", "missing-price"])) return { amount: ZERO, limitedBy: "blocked" };
      const balance = holdings.collateral[tokenId] ?? ZERO;
      return pick([
        [balance, "position"],
        [maxWithdrawByHealth(ctx.assets, holdings, tokenId, ctx.nowMs), "health"],
      ]);
    }
    case "withdraw_supply": {
      if (blocked(["global-paused"])) return { amount: ZERO, limitedBy: "blocked" };
      return pick([
        [holdings.supplied[tokenId] ?? ZERO, "position"],
        [u128OrZero(asset.cash), "liquidity"],
      ]);
    }
    case "borrow": {
      if (blocked(["global-paused", "asset-paused", "not-borrowable", "stale-price", "missing-price"])) {
        return { amount: ZERO, limitedBy: "blocked" };
      }
      const candidates: [bigint, MaxLimiter][] = [
        [maxBorrowByHealth(ctx.assets, holdings, tokenId, ctx.nowMs), "health"],
        [u128OrZero(asset.cash), "liquidity"],
      ];
      const cap = u128OrZero(asset.config.borrow_cap);
      if (cap > ZERO) candidates.push([saturatingSub(cap, u128OrZero(asset.total_borrowed)), "cap"]);
      return pick(candidates);
    }
    case "repay": {
      const debt = holdings.debt[tokenId] ?? ZERO;
      if (debt === ZERO) return { amount: ZERO, limitedBy: "position" };
      const withBuffer = debt + repayBuffer(debt, asset.borrow_apr_bps);
      const candidates: [bigint, MaxLimiter][] = [[withBuffer, "position"]];
      if (wallet !== null) candidates.push([wallet, "wallet"]);
      return pick(candidates);
    }
  }
}
