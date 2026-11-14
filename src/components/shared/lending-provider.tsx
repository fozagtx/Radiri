"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { LENDING_CONTRACT_ID, LENDING_MODE } from "@/lib/config";
import {
  type ExecutionResult,
  type FaucetResult,
  getLendingClient,
  type LendingClientExt,
  LOCAL_SIM_ACCOUNT,
  type PriceFeedStatus,
  SIM_CHANGED_EVENT,
  type WalletBalance,
} from "@/lib/lending";
import {
  type AccountRisk,
  assetMap,
  computeAccountRisk,
  emptyHoldings,
  type Holdings,
  holdingsFromAccount,
  type MarketContext,
} from "@/lib/risk";
import { useNearWallet } from "@/lib/wallets/near";
import type { AccountView, ActivityEntry, AssetView, LendingAction, LendingConfigView, LendingMode } from "@/types/protocol";
import { useNow } from "./use-now";

type LoadState = "idle" | "loading" | "ready" | "error";

export interface LendingContextValue {
  mode: LendingMode;
  contractId: string | null;
  client: LendingClientExt;
  /** Connected NEAR wallet account, if any. */
  walletAccountId: string | null;
  walletReady: boolean;
  /** Account whose lending positions are shown: the wallet on chain; wallet or a local id in simulation. */
  accountId: string | null;
  isLocalSimAccount: boolean;
  config: LendingConfigView | null;
  assets: AssetView[];
  assetIndex: Map<string, AssetView>;
  account: AccountView | null;
  activity: ActivityEntry[];
  holdings: Holdings;
  /** Risk recomputed locally with the current clock (null until markets and the clock are ready). */
  risk: AccountRisk | null;
  market: MarketContext | null;
  priceFeed: PriceFeedStatus | null;
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

export function LendingProvider({ children }: { children: React.ReactNode }) {
  const wallet = useNearWallet();
  const walletAccountId = wallet.accountId;
  const signAndSend = wallet.signAndSendTransactions;
  const nowMs = useNow(5_000);

  const client = useMemo(
    () => getLendingClient({ signer: walletAccountId ? { signAndSendTransactions: signAndSend } : null }),
    [walletAccountId, signAndSend],
  );

  const accountId = LENDING_MODE === "near" ? walletAccountId : walletAccountId ?? (wallet.ready ? LOCAL_SIM_ACCOUNT : null);

  const [config, setConfig] = useState<LendingConfigView | null>(null);
  const [assets, setAssets] = useState<AssetView[]>([]);
  const [account, setAccount] = useState<AccountView | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [balances, setBalances] = useState<Record<string, WalletBalance | null>>({});
  const [priceFeed, setPriceFeed] = useState<PriceFeedStatus | null>(null);
  const [marketsState, setMarketsState] = useState<LoadState>("idle");
  const [accountState, setAccountState] = useState<LoadState>("idle");
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  const loadMarkets = useCallback(async () => {
    setMarketsState((state) => (state === "ready" ? state : "loading"));
    try {
      const [nextConfig, nextAssets] = await Promise.all([client.getConfig(), client.getAssets()]);
      setConfig(nextConfig);
      setAssets(nextAssets);
      setPriceFeed(client.getPriceFeedStatus());
      setMarketsError(null);
      setMarketsState("ready");
      return nextAssets;
    } catch (error) {
      setMarketsError(message(error));
      setMarketsState("error");
      setPriceFeed(client.getPriceFeedStatus());
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

  const refresh = useCallback(async () => {
    await Promise.all([loadMarkets(), loadAccount()]);
  }, [loadMarkets, loadAccount]);

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

  // Simulation writes from other tabs or components.
  useEffect(() => {
    if (LENDING_MODE !== "simulation") return;
    const onChange = () => {
      void loadAccount();
      void loadBalances();
    };
    window.addEventListener(SIM_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(SIM_CHANGED_EVENT, onChange);
  }, [loadAccount, loadBalances]);

  const execute = useCallback(
    async (action: LendingAction) => {
      if (!accountId) throw new Error(LENDING_MODE === "near" ? "Connect a NEAR wallet first" : "Simulation account not ready");
      const result = (await client.execute(accountId, action)) as ExecutionResult;
      await Promise.all([refresh(), loadBalances()]);
      return { ...result, notes: result.notes ?? [] };
    },
    [client, accountId, refresh, loadBalances],
  );

  const faucet = useCallback(
    async (tokenId: string, amount: string) => {
      if (!accountId) throw new Error("Connect a NEAR wallet first");
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
      mode: LENDING_MODE,
      contractId: LENDING_MODE === "near" ? LENDING_CONTRACT_ID : null,
      client,
      walletAccountId,
      walletReady: wallet.ready,
      accountId,
      isLocalSimAccount: LENDING_MODE === "simulation" && accountId === LOCAL_SIM_ACCOUNT,
      config,
      assets,
      assetIndex,
      account,
      activity,
      holdings,
      risk,
      market,
      priceFeed,
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
      priceFeed,
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
