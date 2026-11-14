"use client";

/**
 * NEAR wallet through NEAR Connect (@hot-labs/near-connect 0.12.0). API used, as declared in the
 * package's d.ts and the docs.near.org wallet-login guide:
 *   new NearConnector({ network, providers, features })
 *   connector.getConnectedWallet()            -> { wallet, accounts }   (restore a session)
 *   connector.connect()                       -> NearWalletBase         (opens the wallet picker)
 *   connector.disconnect(wallet)
 *   connector.on / off("wallet:signIn" | "wallet:signOut", cb)
 *   wallet.getAccounts()
 *   wallet.signAndSendTransactions({ transactions, network, signerId }) -> FinalExecutionOutcome[]
 * The connector touches window, localStorage and IndexedDB, so it is created lazily in the browser.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectorAction, EventMap, NearConnector, NearWalletBase } from "@hot-labs/near-connect";
import { NETWORK, RPC_URL, type NearNetwork } from "@/lib/config";

export interface NearTransactionInput {
  receiverId: string;
  actions: unknown[];
}

export interface NearWalletState {
  accountId: string | null;
  /** The connector finished restoring any previous session. */
  ready: boolean;
  network: NearNetwork;
  /** Wallet picker or sign-in in progress. */
  connecting: boolean;
  /** Last connector error (not set when the user just closes the picker). */
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Sign and send every transaction with one wallet prompt; resolves to the final outcomes. */
  signAndSendTransactions: (transactions: NearTransactionInput[]) => Promise<unknown[]>;
}

const NearWalletContext = createContext<NearWalletState | null>(null);

let connectorPromise: Promise<NearConnector> | null = null;

function getConnector(): Promise<NearConnector> {
  connectorPromise ??= import("@hot-labs/near-connect").then(
    ({ NearConnector }) =>
      new NearConnector({
        network: NETWORK,
        providers: NETWORK === "mainnet" ? { mainnet: [RPC_URL] } : { testnet: [RPC_URL] },
        // Lending actions batch storage registration + the call: require multi-transaction signing.
        features: { signAndSendTransactions: true },
      }),
  );
  return connectorPromise;
}

function isUserRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /reject|cancel|closed/i.test(message);
}

export function NearWalletProvider({ children }: { children: React.ReactNode }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const walletRef = useRef<NearWalletBase | null>(null);

  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | undefined;

    (async () => {
      let connector: NearConnector;
      try {
        connector = await getConnector();
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
          setReady(true);
        }
        return;
      }

      const restored = await connector.getConnectedWallet().catch(() => null);
      if (cancelled) return;
      if (restored) {
        walletRef.current = restored.wallet;
        setAccountId(restored.accounts[0]?.accountId ?? null);
      }

      const handleSignIn = (payload: EventMap["wallet:signIn"]) => {
        if (cancelled) return;
        walletRef.current = payload.wallet;
        setAccountId(payload.accounts[0]?.accountId ?? null);
        setError(null);
      };
      const handleSignOut = () => {
        if (cancelled) return;
        walletRef.current = null;
        setAccountId(null);
      };
      connector.on("wallet:signIn", handleSignIn);
      connector.on("wallet:signOut", handleSignOut);
      detach = () => {
        connector.off("wallet:signIn", handleSignIn);
        connector.off("wallet:signOut", handleSignOut);
      };
      setReady(true);
    })();

    return () => {
      cancelled = true;
      detach?.();
    };
  }, []);

  const signIn = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const connector = await getConnector();
      const wallet = await connector.connect();
      walletRef.current = wallet;
      const accounts = await wallet.getAccounts();
      setAccountId(accounts[0]?.accountId ?? null);
    } catch (caught) {
      if (!isUserRejection(caught)) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setConnecting(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      const connector = await getConnector();
      await connector.disconnect(walletRef.current ?? undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      walletRef.current = null;
      setAccountId(null);
    }
  }, []);

  const signAndSendTransactions = useCallback(
    async (transactions: NearTransactionInput[]) => {
      const connector = await getConnector();
      const wallet = walletRef.current ?? (await connector.wallet());
      const outcomes = await wallet.signAndSendTransactions({
        network: NETWORK,
        signerId: accountId ?? undefined,
        transactions: transactions.map((tx) => ({ receiverId: tx.receiverId, actions: tx.actions as ConnectorAction[] })),
      });
      return outcomes as unknown[];
    },
    [accountId],
  );

  const value = useMemo<NearWalletState>(
    () => ({ accountId, ready, network: NETWORK, connecting, error, signIn, signOut, signAndSendTransactions }),
    [accountId, ready, connecting, error, signIn, signOut, signAndSendTransactions],
  );

  return <NearWalletContext.Provider value={value}>{children}</NearWalletContext.Provider>;
}

export function useNearWallet(): NearWalletState {
  const ctx = useContext(NearWalletContext);
  if (!ctx) throw new Error("useNearWallet must be used inside <NearWalletProvider>");
  return ctx;
}
