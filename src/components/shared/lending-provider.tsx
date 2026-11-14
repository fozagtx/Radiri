"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { LENDING_CONTRACT_ID } from "@/lib/config";
import { type ExecutionResult, type FaucetResult, getLendingClient, type LendingClientExt, type WalletBalance } from "@/lib/lending";
import { type AccountRisk, assetMap, computeAccountRisk, emptyHoldings, type Holdings, holdingsFromAccount, type MarketContext } from "@/lib/risk";
import { useNearWallet } from "@/lib/wallets/near";
import type { AccountView, ActivityEntry, AssetView, LendingAction, LendingConfigView, LendingMode } from "@/types/protocol";
import { useNow } from "./use-now";

type LoadState = "idle" | "loading" | "ready" | "error";

export interface OracleState {
  refreshing: boolean;
  /** Why the last automatic price refresh did not happen, if it did not. */
  error: string | null;
  lastTxHash: string | null;
}

export interface LendingContextValue {
  mode: LendingMode;
  contractId: string;
  client: LendingClientExt;
  /** Connected NEAR testnet wallet account, if any. Positions are shown for this account. */
  walletAccountId: string | null;
  walletReady: boolean;
  accountId: string | null;
  config: LendingConfigView | null;
  assets: AssetView[];
  assetIndex: Map<string, AssetView>;
  account: AccountView | null;
  activity: ActivityEntry[];
  holdings: Holdings;
  /** Risk recomputed locally with the current clock (null until markets and the clock are ready). */
  risk: AccountRisk | null;
  market: MarketContext | null;
  oracle: OracleState;
  balances: Record<string, WalletBalance | null>;
  nowMs: number;
  marketsState: LoadState;
  accountState: LoadState;
  marketsError: string | null;
  accountError: string | null;
  refresh: () => Promise<void>;
  loadBalances: () => Promise<void>;
  execute: (action: LendingAction) => Promise<ExecutionResult>;
  faucet: (tokenId: string, amount: string) => Promise<FaucetResult>;
}

const LendingContext = createContext<LendingContextValue | null>(null);

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const POLL_MS = 30_000;
/** Do not ask the server to push prices more often than this. */
const ORACLE_RETRY_MS = 60_000;

export function LendingProvider({ children }: { children: React.ReactNode }) {
  const wallet = useNearWallet();
  const walletAccountId = wallet.accountId;
  const signAndSend = wallet.signAndSendTransactions;
  const nowMs = useNow(5_000);

  const client = useMemo(
    () => getLendingClient({ signer: walletAccountId ? { signAndSendTransactions: signAndSend } : null }),
    [walletAccountId, signAndSend],
  );
  const accountId = walletAccountId;

  const [config, setConfig] = useState<LendingConfigView | null>(null);
  const [assets, setAssets] = useState<AssetView[]>([]);
  const [account, setAccount] = useState<AccountView | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [balances, setBalances] = useState<Record<string, WalletBalance | null>>({});
  const [marketsState, setMarketsState] = useState<LoadState>("idle");
  const [accountState, setAccountState] = useState<LoadState>("idle");
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [oracle, setOracle] = useState<OracleState>({ refreshing: false, error: null, lastTxHash: null });
  const lastOracleAttempt = useRef(0);

  const loadMarkets = useCallback(async () => {
    setMarketsState((state) => (state === "ready" ? state : "loading"));
    try {
      const [nextConfig, nextAssets] = await Promise.all([client.getConfig(), client.getAssets()]);
      setConfig(nextConfig);
      setAssets(nextAssets);
      setMarketsError(null);
      setMarketsState("ready");
      return nextAssets;
    } catch (error) {
      setMarketsError(message(error));
      setMarketsState("error");
      return null;
    }
  }, [client]);

  const loadAccount = useCallback(async () => {
    if (!accountId) {
      setAccount(null);
      setActivity([]);
      setAccountState("idle");
      return;
    }
    setAccountState((state) => (state === "ready" ? state : "loading"));
    try {
      const [nextAccount, nextActivity] = await Promise.all([client.getAccount(accountId), client.getActivity(accountId)]);
      setAccount(nextAccount);
      setActivity(nextActivity);
      setAccountError(null);
      setAccountState("ready");
    } catch (error) {
      setAccountError(message(error));
      setAccountState("error");
    }
  }, [client, accountId]);

  const loadBalances = useCallback(async () => {
    if (!accountId || assets.length === 0) {
      setBalances({});
      return;
    }
    const entries = await Promise.all(
      assets.map(async (asset) => [asset.config.token_id, await client.getWalletBalance(asset.config.token_id, accountId)] as const),
    );
    setBalances(Object.fromEntries(entries));
  }, [client, accountId, assets]);

  /** On-chain prices expire; ask the server to push live 1Click prices when any has. */
  const refreshOracleIfStale = useCallback(
    async (current: AssetView[] | null) => {
      if (!current || current.every((asset) => asset.price_fresh)) return false;
      if (Date.now() - lastOracleAttempt.current < ORACLE_RETRY_MS) return false;
      lastOracleAttempt.current = Date.now();
      setOracle((state) => ({ ...state, refreshing: true }));
      try {
        const res = await fetch("/api/oracle/refresh", { method: "POST" });
        const body = (await res.json()) as { submitted: boolean; reason: string; txHash: string | null };
        setOracle({ refreshing: false, error: res.ok ? null : body.reason, lastTxHash: body.txHash });
        return body.submitted;
      } catch (error) {
        setOracle({ refreshing: false, error: message(error), lastTxHash: null });
        return false;
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    const [nextAssets] = await Promise.all([loadMarkets(), loadAccount()]);
    if (await refreshOracleIfStale(nextAssets)) await Promise.all([loadMarkets(), loadAccount()]);
  }, [loadMarkets, loadAccount, refreshOracleIfStale]);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    const timer = setTimeout(() => void loadBalances(), 0);
    return () => clearTimeout(timer);
  }, [loadBalances]);

  const execute = useCallback(
    async (action: LendingAction) => {
      if (!accountId) throw new Error("Connect a NEAR testnet wallet first");
      const result = (await client.execute(accountId, action)) as ExecutionResult;
      await Promise.all([refresh(), loadBalances()]);
      return { ...result, notes: result.notes ?? [] };
    },
    [client, accountId, refresh, loadBalances],
  );

  const faucet = useCallback(
    async (tokenId: string, amount: string) => {
      if (!accountId) throw new Error("Connect a NEAR testnet wallet first");
      const result = await client.faucet(accountId, tokenId, amount);
      await loadBalances();
      return result;
    },
    [client, accountId, loadBalances],
  );

  const assetIndex = useMemo(() => assetMap(assets), [assets]);
  const holdings = useMemo(() => (account ? holdingsFromAccount(account) : emptyHoldings()), [account]);
  const market = useMemo<MarketContext | null>(
    () => (nowMs > 0 && assets.length > 0 ? { assets: assetIndex, globalPaused: config?.paused ?? false, nowMs } : null),
    [assetIndex, assets.length, config?.paused, nowMs],
  );
  const risk = useMemo(() => (market ? computeAccountRisk(market.assets, holdings, market.nowMs) : null), [market, holdings]);

  const value = useMemo<LendingContextValue>(
    () => ({
      mode: "near",
      contractId: LENDING_CONTRACT_ID,
      client,
      walletAccountId,
      walletReady: wallet.ready,
      accountId,
      config,
      assets,
      assetIndex,
      account,
      activity,
      holdings,
      risk,
      market,
      oracle,
      balances,
      nowMs,
      marketsState,
      accountState,
      marketsError,
      accountError,
      refresh,
      loadBalances,
      execute,
      faucet,
    }),
    [
      client,
      walletAccountId,
      wallet.ready,
      accountId,
      config,
      assets,
      assetIndex,
      account,
      activity,
      holdings,
      risk,
      market,
      oracle,
      balances,
      nowMs,
      marketsState,
      accountState,
      marketsError,
      accountError,
      refresh,
      loadBalances,
      execute,
      faucet,
    ],
  );

  return <LendingContext.Provider value={value}>{children}</LendingContext.Provider>;
}

export function useLending(): LendingContextValue {
  const ctx = useContext(LendingContext);
  if (!ctx) throw new Error("useLending must be used inside <LendingProvider>");
  return ctx;
}
