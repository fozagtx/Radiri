"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { CONTRACT_ID, NETWORK } from "@/lib/config";

type WalletCtx = {
  accountId: string | null;
  ready: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const selectorRef = useRef<WalletSelector | null>(null);
  const modalRef = useRef<WalletSelectorModal | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Loaded lazily: the selector touches window and must not run during SSR.
      const [{ setupWalletSelector }, { setupMyNearWallet }, { setupModal }] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/my-near-wallet"),
        import("@near-wallet-selector/modal-ui"),
      ]);
      await import("@near-wallet-selector/modal-ui/styles.css");

      const selector = await setupWalletSelector({
        network: NETWORK,
        modules: [setupMyNearWallet()],
      });
      if (cancelled) return;

      selectorRef.current = selector;
      modalRef.current = setupModal(selector, {
        contractId: CONTRACT_ID || "radiri.testnet",
        description: "Read-only route quotes. Radiri never signs a transaction.",
      });

      const sync = () => setAccountId(selector.store.getState().accounts[0]?.accountId ?? null);

      sync();
      selector.on("signedIn", sync);
      selector.on("signedOut", sync);
      selector.on("accountsChanged", sync);
      selector.store.observable.subscribe(sync);
      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async () => {
    modalRef.current?.show();
  }, []);

  const signOut = useCallback(async () => {
    const wallet = await selectorRef.current?.wallet();
    await wallet?.signOut();
    setAccountId(null);
  }, []);

  return <Ctx.Provider value={{ accountId, ready, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
