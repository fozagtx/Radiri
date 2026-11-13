"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { NearConnector as NearConnectorType } from "@hot-labs/near-connect";
import { NETWORK } from "@/lib/config";

type FunctionCall = { methodName: string; args: object; gas: string; deposit: string };

type WalletCtx = {
  accountId: string | null;
  ready: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  callMethod: (contractId: string, call: FunctionCall) => Promise<unknown>;
};

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const connectorRef = useRef<NearConnectorType | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Imported lazily: the connector touches window/iframes and must not run during SSR.
      const { NearConnector } = await import("@hot-labs/near-connect");
      const connector = new NearConnector({ network: NETWORK });
      connectorRef.current = connector;

      connector.on("wallet:signIn", (e) => setAccountId(e.accounts[0]?.accountId ?? null));
      connector.on("wallet:signOut", () => setAccountId(null));

      try {
        const { accounts } = await connector.getConnectedWallet();
        if (!cancelled) setAccountId(accounts[0]?.accountId ?? null);
      } catch {
        // No wallet connected yet.
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async () => {
    await connectorRef.current?.connect();
  }, []);

  const signOut = useCallback(async () => {
    await connectorRef.current?.disconnect();
    setAccountId(null);
  }, []);

  const callMethod = useCallback(async (contractId: string, call: FunctionCall) => {
    const connector = connectorRef.current;
    if (!connector) throw new Error("Wallet not ready");
    const wallet = await connector.wallet();
    return wallet.signAndSendTransaction({
      receiverId: contractId,
      actions: [{ type: "FunctionCall", params: call }],
    });
  }, []);

  return (
    <Ctx.Provider value={{ accountId, ready, signIn, signOut, callMethod }}>{children}</Ctx.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
