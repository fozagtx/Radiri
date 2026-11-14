/**
 * SimulatedLendingClient: the labelled, browser-local lending simulation used when no lending
 * contract is configured. It runs every check through the same risk engine the contract mirrors
 * (eligibility, caps, liquidity, price freshness, health) against live reference prices, so a
 * stale or missing price blocks a borrow exactly as on chain. It never produces a transaction:
 * `txHashes` is always empty and the UI shows "Simulation · no on-chain transaction".
 */

import { LENDING_ASSETS, type LendingAssetSpec } from "@/config/lending-assets";
import type {
  AccountView,
  ActivityEntry,
  AssetView,
  LendingAction,
  LendingActionResult,
  LendingConfigView,
  OraclePrice,
} from "@/types/protocol";
import {
  accruePool,
  assetMap,
  borrowAprBps,
  checkPrice,
  CLOSE_FACTOR_BPS,
  computeAccountRisk,
  debtFromScaled,
  emptyHoldings,
  type Holdings,
  minBig,
  parseUnits,
  previewAction,
  saturatingSub,
  scaledForBorrow,
  scaledForRepay,
  sharesForSupply,
  sharesForWithdraw,
  supplyAprBps,
  supplyUnderlying,
  u128,
  u128OrZero,
  underlyingForShares,
  utilizationBps,
  WAD,
  ZERO,
} from "@/lib/risk";
import { fetchReferencePrices, matchObservation, observationToOraclePrice, type PricingResponse } from "./sim-prices";
import { clearSimState, emptySimAccount, loadSimState, saveSimState, type SimAccount, type SimPool, type SimState } from "./sim-store";
import { type FaucetResult, LendingActionError, type LendingClientExt, type PriceFeedStatus, type WalletBalance } from "./types";

/** Seed liquidity per test token, whole tokens. Simulation only, labelled in the UI. */
export const SIM_SEED_LIQUIDITY: Record<string, string> = {
  tPEPE: "40000000000",
  tWIF: "100000",
  tSHIB: "10000000000",
  tBRETT: "2000000",
  tAAPL: "1000",
  tTSLA: "500",
  tNVDA: "1500",
};

/** Faucet presets per test token, whole tokens. */
export const SIM_FAUCET_AMOUNT: Record<string, string> = {
  tPEPE: "2000000000",
  tWIF: "5000",
  tSHIB: "1000000000",
  tBRETT: "100000",
  tAAPL: "25",
  tTSLA: "10",
  tNVDA: "25",
};

/** Account id used for the simulation when no NEAR wallet is connected. */
export const LOCAL_SIM_ACCOUNT = "local-simulation";

const ACTIVITY_KEEP = 32;

export interface SimulatedClientOptions {
  specs?: LendingAssetSpec[];
  now?: () => number;
  fetchPrices?: (symbols: string[]) => Promise<PricingResponse>;
  priceTtlMs?: number;
}

function add(record: Record<string, string>, key: string, delta: bigint): void {
  record[key] = (u128OrZero(record[key]) + delta).toString();
}

function sub(record: Record<string, string>, key: string, delta: bigint): void {
  const next = saturatingSub(u128OrZero(record[key]), delta);
  if (next === ZERO) delete record[key];
  else record[key] = next.toString();
}

export class SimulatedLendingClient implements LendingClientExt {
  readonly mode = "simulation" as const;
  readonly contractId = null;

  private readonly specs: LendingAssetSpec[];
  private readonly now: () => number;
  private readonly fetchPrices: (symbols: string[]) => Promise<PricingResponse>;
  private readonly priceTtlMs: number;
  private prices = new Map<string, OraclePrice | null>();
  private sourceFresh = new Map<string, boolean>();
  private status: PriceFeedStatus = { source: "/api/pricing", fetchedAtMs: null, error: null, observations: [], missing: [] };
  private inflight: Promise<void> | null = null;

  constructor(options: SimulatedClientOptions = {}) {
    this.specs = options.specs ?? LENDING_ASSETS;
    this.now = options.now ?? (() => Date.now());
    this.fetchPrices = options.fetchPrices ?? ((symbols) => fetchReferencePrices(symbols));
    this.priceTtlMs = options.priceTtlMs ?? 30_000;
  }

  /* ---------------------------- state ---------------------------- */

  private seedState(nowMs: number): SimState {
    const pools: Record<string, SimPool> = {};
    for (const spec of this.specs) {
      const seed = parseUnits(SIM_SEED_LIQUIDITY[spec.config.symbol] ?? "0", spec.config.decimals).toString();
      pools[spec.config.token_id] = {
        cash: seed,
        total_borrowed: "0",
        reserves: "0",
        total_collateral: "0",
        total_supply_shares: seed,
        borrow_index: WAD.toString(),
        last_accrual_ms: nowMs,
        seeded: seed,
      };
    }
    return { version: 1, createdAtMs: nowMs, paused: false, pools, accounts: {}, activity: {} };
  }

  private load(nowMs: number): SimState {
    const state = loadSimState() ?? this.seedState(nowMs);
    // Assets added to the table after the state was created get a fresh pool.
    for (const spec of this.specs) {
      if (!state.pools[spec.config.token_id]) state.pools[spec.config.token_id] = this.seedState(nowMs).pools[spec.config.token_id];
    }
    return state;
  }

  private accrue(state: SimState, nowMs: number): void {
    for (const spec of this.specs) {
      const pool = state.pools[spec.config.token_id];
      if (!pool) continue;
      const result = accruePool(
        {
          cash: u128(pool.cash),
          totalBorrowed: u128(pool.total_borrowed),
          reserves: u128(pool.reserves),
          borrowIndex: u128(pool.borrow_index),
          lastAccrualMs: pool.last_accrual_ms,
        },
        spec.config.interest,
        spec.config.reserve_factor_bps,
        nowMs,
      );
      pool.total_borrowed = result.totalBorrowed.toString();
      pool.reserves = result.reserves.toString();
      pool.borrow_index = result.borrowIndex.toString();
      pool.last_accrual_ms = result.lastAccrualMs;
    }
  }

  /** Load, accrue to now and persist. */
  private current(): { state: SimState; nowMs: number } {
    const nowMs = this.now();
    const state = this.load(nowMs);
    this.accrue(state, nowMs);
    // Persist the accrual quietly: this runs on every read, and readers re-read on SIM_CHANGED_EVENT.
    saveSimState(state, { notify: false });
    return { state, nowMs };
  }

  reset(): void {
    clearSimState();
  }

  /* ---------------------------- prices ---------------------------- */

  async refreshPrices(force = false): Promise<void> {
    const fetchedAt = this.status.fetchedAtMs;
    if (!force && fetchedAt !== null && this.now() - fetchedAt < this.priceTtlMs && !this.status.error) return;
    if (this.inflight) return this.inflight;
    const symbols = [...new Set(this.specs.map((spec) => spec.referenceSymbol))];
    this.inflight = (async () => {
      try {
        const response = await this.fetchPrices(symbols);
        const fetchedAtMs = this.now();
        const next = new Map<string, OraclePrice | null>();
        const fresh = new Map<string, boolean>();
        for (const spec of this.specs) {
          const observation = matchObservation(response.observations, spec.referenceSymbol);
          next.set(spec.config.token_id, observation ? observationToOraclePrice(observation, fetchedAtMs) : null);
          fresh.set(spec.config.token_id, observation ? observation.fresh !== false : false);
        }
        this.prices = next;
        this.sourceFresh = fresh;
        this.status = { source: "/api/pricing", fetchedAtMs, error: null, observations: response.observations, missing: response.missing };
      } catch (error) {
        // Keep the previous prices: they age out on their own and stop authorising borrows.
        this.status = {
          ...this.status,
          fetchedAtMs: this.now(),
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  getPriceFeedStatus(): PriceFeedStatus {
    return this.status;
  }

  /* ---------------------------- views ---------------------------- */

  private assetView(spec: LendingAssetSpec, pool: SimPool, nowMs: number): AssetView {
    const cash = u128(pool.cash);
    const borrowed = u128(pool.total_borrowed);
    const utilization = utilizationBps(cash, borrowed);
    const borrowApr = borrowAprBps(spec.config.interest, utilization);
    const price = this.prices.get(spec.config.token_id) ?? null;
    const fresh = checkPrice(price, spec.config.max_price_age_sec, nowMs).fresh && this.sourceFresh.get(spec.config.token_id) !== false;
    return {
      config: spec.config,
      cash: pool.cash,
      total_borrowed: pool.total_borrowed,
      reserves: pool.reserves,
      total_collateral: pool.total_collateral,
      total_supply_shares: pool.total_supply_shares,
      borrow_index: pool.borrow_index,
      utilization_bps: utilization,
      borrow_apr_bps: borrowApr,
      supply_apr_bps: supplyAprBps(borrowApr, utilization, spec.config.reserve_factor_bps),
      price,
      price_fresh: fresh,
      last_accrual_ms: pool.last_accrual_ms,
    };
  }

  private views(state: SimState, nowMs: number): AssetView[] {
    return this.specs.map((spec) => this.assetView(spec, state.pools[spec.config.token_id], nowMs));
  }

  async getConfig(): Promise<LendingConfigView> {
    const { state } = this.current();
    return {
      owner_id: "simulation",
      guardian_id: "simulation",
      oracle_reporters: [],
      paused: state.paused,
      close_factor_bps: CLOSE_FACTOR_BPS,
    };
  }

  async getAssets(): Promise<AssetView[]> {
    await this.refreshPrices();
    const { state, nowMs } = this.current();
    return this.views(state, nowMs);
  }

  private holdings(state: SimState, accountId: string): Holdings {
    const account = state.accounts[accountId];
    const holdings = emptyHoldings();
    if (!account) return holdings;
    for (const [tokenId, amount] of Object.entries(account.collateral)) holdings.collateral[tokenId] = u128(amount);
    for (const [tokenId, scaled] of Object.entries(account.scaled_debt)) {
      const pool = state.pools[tokenId];
      if (pool) holdings.debt[tokenId] = debtFromScaled(u128(scaled), u128(pool.borrow_index));
    }
    for (const [tokenId, shares] of Object.entries(account.supply_shares)) {
      const pool = state.pools[tokenId];
      if (!pool) continue;
      const underlying = supplyUnderlying(u128(pool.cash), u128(pool.total_borrowed), u128(pool.reserves));
      holdings.supplied[tokenId] = underlyingForShares(u128(shares), u128(pool.total_supply_shares), underlying);
    }
    return holdings;
  }

  async getAccount(accountId: string): Promise<AccountView | null> {
    await this.refreshPrices();
    const { state, nowMs } = this.current();
    const account = state.accounts[accountId];
    const holdings = this.holdings(state, accountId);
    const hasPositions =
      Object.keys(account?.collateral ?? {}).length > 0 ||
      Object.keys(account?.supply_shares ?? {}).length > 0 ||
      Object.keys(account?.scaled_debt ?? {}).length > 0;
    if (!account || (!hasPositions && (state.activity[accountId]?.length ?? 0) === 0)) return null;
    const assets = assetMap(this.views(state, nowMs));
    const risk = computeAccountRisk(assets, holdings, nowMs);
    return {
      account_id: accountId,
      collateral: risk.collateral.map((line) => ({ token_id: line.tokenId, amount: line.amount.toString(), value_wad: line.valueWad.toString() })),
      supplied: Object.entries(account.supply_shares).map(([tokenId, shares]) => ({
        token_id: tokenId,
        shares,
        amount: (holdings.supplied[tokenId] ?? ZERO).toString(),
      })),
      borrowed: risk.debt.map((line) => ({ token_id: line.tokenId, amount: line.amount.toString(), value_wad: line.valueWad.toString() })),
      collateral_value_wad: risk.collateralValueWad.toString(),
      borrow_limit_wad: risk.borrowLimitWad.toString(),
      liquidation_threshold_wad: risk.liquidationThresholdWad.toString(),
      debt_value_wad: risk.debtValueWad.toString(),
      health_factor_wad: risk.healthFactorWad === null ? null : risk.healthFactorWad.toString(),
      prices_fresh: risk.pricesFresh,
      liquidatable: risk.liquidatable,
    };
  }

  async getActivity(accountId: string, limit = ACTIVITY_KEEP): Promise<ActivityEntry[]> {
    const state = this.load(this.now());
    return (state.activity[accountId] ?? []).slice(0, Math.max(0, limit));
  }

  async getWalletBalance(tokenId: string, accountId: string): Promise<WalletBalance | null> {
    const state = this.load(this.now());
    return { amount: u128OrZero(state.accounts[accountId]?.wallet[tokenId]), source: "simulation" };
  }

  /* ---------------------------- actions ---------------------------- */

  async faucet(accountId: string, tokenId: string, amount: string): Promise<FaucetResult> {
    const spec = this.specs.find((item) => item.config.token_id === tokenId);
    if (!spec) throw new LendingActionError(`${tokenId} is not a simulated test token`);
    const value = u128(amount, "amount");
    if (value === ZERO) throw new LendingActionError("Faucet amount must be above zero");
    const { state } = this.current();
    const account = (state.accounts[accountId] ??= emptySimAccount());
    add(account.wallet, tokenId, value);
    saveSimState(state);
    return { mode: "simulation", txHashes: [], explorerUrls: [], tokenId, amount };
  }

  async execute(accountId: string, action: LendingAction): Promise<LendingActionResult> {
    await this.refreshPrices();
    const { state, nowMs } = this.current();
    const amount = u128(action.amount, "amount");
    const account: SimAccount = (state.accounts[accountId] ??= emptySimAccount());
    const pool = state.pools[action.tokenId];
    const assets = assetMap(this.views(state, nowMs));
    const holdings = this.holdings(state, accountId);
    const walletBalance = u128OrZero(account.wallet[action.tokenId]);

    const preview = previewAction(
      { assets, globalPaused: state.paused, nowMs },
      holdings,
      { kind: action.kind, tokenId: action.tokenId, amount, walletBalance },
    );
    if (!preview.ok || !pool) {
      throw new LendingActionError(preview.reasons.map((reason) => reason.message).join("; ") || "Action rejected", {
        reasons: preview.reasons,
      });
    }

    let moved = amount;
    switch (action.kind) {
      case "deposit_collateral": {
        sub(account.wallet, action.tokenId, amount);
        add(account.collateral, action.tokenId, amount);
        pool.total_collateral = (u128(pool.total_collateral) + amount).toString();
        break;
      }
      case "withdraw_collateral": {
        sub(account.collateral, action.tokenId, amount);
        add(account.wallet, action.tokenId, amount);
        pool.total_collateral = saturatingSub(u128(pool.total_collateral), amount).toString();
        break;
      }
      case "supply": {
        const underlying = supplyUnderlying(u128(pool.cash), u128(pool.total_borrowed), u128(pool.reserves));
        const shares = sharesForSupply(amount, u128(pool.total_supply_shares), underlying);
        if (shares === ZERO) throw new LendingActionError("Amount is too small to mint a pool share");
        sub(account.wallet, action.tokenId, amount);
        add(account.supply_shares, action.tokenId, shares);
        pool.cash = (u128(pool.cash) + amount).toString();
        pool.total_supply_shares = (u128(pool.total_supply_shares) + shares).toString();
        break;
      }
      case "withdraw_supply": {
        const underlying = supplyUnderlying(u128(pool.cash), u128(pool.total_borrowed), u128(pool.reserves));
        const shares = minBig(sharesForWithdraw(amount, u128(pool.total_supply_shares), underlying), u128OrZero(account.supply_shares[action.tokenId]));
        sub(account.supply_shares, action.tokenId, shares);
        add(account.wallet, action.tokenId, amount);
        pool.cash = (u128(pool.cash) - amount).toString();
        pool.total_supply_shares = saturatingSub(u128(pool.total_supply_shares), shares).toString();
        break;
      }
      case "borrow": {
        const index = u128(pool.borrow_index);
        add(account.scaled_debt, action.tokenId, scaledForBorrow(amount, index));
        add(account.wallet, action.tokenId, amount);
        pool.cash = (u128(pool.cash) - amount).toString();
        pool.total_borrowed = (u128(pool.total_borrowed) + amount).toString();
        break;
      }
      case "repay": {
        const index = u128(pool.borrow_index);
        const scaled = u128OrZero(account.scaled_debt[action.tokenId]);
        const debt = debtFromScaled(scaled, index);
        moved = minBig(amount, debt);
        if (moved === debt) delete account.scaled_debt[action.tokenId];
        else sub(account.scaled_debt, action.tokenId, scaledForRepay(moved, index));
        sub(account.wallet, action.tokenId, moved);
        pool.cash = (u128(pool.cash) + moved).toString();
        pool.total_borrowed = saturatingSub(u128(pool.total_borrowed), moved).toString();
        break;
      }
    }

    const entry: ActivityEntry = {
      kind: action.kind,
      token_id: action.tokenId,
      amount: moved.toString(),
      counterparty: null,
      timestamp_ms: nowMs,
      block_height: 0,
    };
    state.activity[accountId] = [entry, ...(state.activity[accountId] ?? [])].slice(0, ACTIVITY_KEEP);
    saveSimState(state);
    return { mode: "simulation", txHashes: [], explorerUrls: [] };
  }
}

/** Seeded liquidity of a pool in base units (for the "seeded by the simulation" label). */
export function simSeededAmount(symbol: string, decimals: number): bigint {
  return parseUnits(SIM_SEED_LIQUIDITY[symbol] ?? "0", decimals);
}
