"use client";

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { ConnectionProvider, WalletProvider, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";

/**
 * Solana wallets for 1Click deposits: @solana/wallet-adapter-react with Wallet Standard discovery
 * (wallets = [], every installed standard wallet appears on its own). RPC: NEXT_PUBLIC_SOLANA_RPC_URL,
 * default the public mainnet endpoint. The user signs every transaction in their own wallet.
 */

// @solana/spl-token instruction encoders use the global Buffer; browsers have none.
if (typeof globalThis !== "undefined" && !(globalThis as { Buffer?: unknown }).Buffer) {
  (globalThis as { Buffer?: unknown }).Buffer = Buffer;
}

export const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";

export interface SolanaWalletInfo {
  name: string;
  icon: string;
  /** "Installed" | "Loadable" | "NotDetected" | "Unsupported" */
  readyState: string;
}

export interface SolanaDepositParams {
  /** SPL mint, or null for native SOL. */
  mint: string | null;
  /** 1Click deposit address (an owner address; SPL tokens go to its associated token account). */
  to: string;
  /** Exact base units. */
  amount: bigint;
  /** Mint decimals (transferChecked). */
  decimals: number;
}

export interface SolanaWalletState {
  address: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** False when no SolanaWalletProvider is mounted above the caller. */
  available: boolean;
  connecting: boolean;
  wallets: SolanaWalletInfo[];
  connectWith: (walletName: string) => Promise<void>;
  /** Sends the deposit (SOL transfer or SPL transferChecked, creating the recipient ATA if needed); returns the signature. */
  sendDeposit: (params: SolanaDepositParams) => Promise<string>;
}

const notMounted = async (): Promise<never> => {
  throw new Error("Solana wallets are not available here (SolanaWalletProvider is not mounted)");
};

const DISCONNECTED: SolanaWalletState = {
  address: null,
  connect: notMounted,
  disconnect: async () => {},
  available: false,
  connecting: false,
  wallets: [],
  connectWith: notMounted,
  sendDeposit: notMounted,
};

const SolanaContext = createContext<SolanaWalletState | null>(null);

function SolanaBridge({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const pending = useRef<{ name: string; resolve: () => void; reject: (error: unknown) => void } | null>(null);

  // select() is asynchronous; connect once the selected adapter is in place.
  useEffect(() => {
    const request = pending.current;
    if (!request || wallet.wallet?.adapter.name !== request.name) return;
    pending.current = null;
    if (wallet.connected) {
      request.resolve();
      return;
    }
    wallet.connect().then(request.resolve, request.reject);
  }, [wallet, wallet.wallet, wallet.connected]);

  const connectWith = useCallback(
    (walletName: string) =>
      new Promise<void>((resolve, reject) => {
        const target = wallet.wallets.find((item) => item.adapter.name === walletName);
        if (!target) {
          reject(new Error(`Solana wallet ${walletName} was not detected`));
          return;
        }
        if (wallet.wallet?.adapter.name === walletName) {
          if (wallet.connected) resolve();
          else wallet.connect().then(resolve, reject);
          return;
        }
        pending.current = { name: walletName, resolve, reject };
        wallet.select(target.adapter.name);
      }),
    [wallet],
  );

  const connect = useCallback(async () => {
    if (wallet.connected) return;
    if (wallet.wallet) {
      await wallet.connect();
      return;
    }
    const installed = wallet.wallets.find((item) => String(item.readyState) === "Installed");
    if (!installed) throw new Error("No Solana wallet detected. Install a Wallet Standard wallet (e.g. Phantom, Solflare, Backpack).");
    await connectWith(installed.adapter.name);
  }, [wallet, connectWith]);

  const disconnect = useCallback(async () => {
    await wallet.disconnect();
  }, [wallet]);

  const sendDeposit = useCallback(
    async ({ mint, to, amount, decimals }: SolanaDepositParams): Promise<string> => {
      const owner = wallet.publicKey;
      if (!owner) throw new Error("Connect a Solana wallet first");
      if (amount <= BigInt(0)) throw new Error("Deposit amount must be positive");
      const recipient = new PublicKey(to);
      const transaction = new Transaction();

      if (mint === null) {
        transaction.add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: recipient, lamports: amount }));
      } else {
        const mintKey = new PublicKey(mint);
        const mintAccount = await connection.getAccountInfo(mintKey);
        if (!mintAccount) throw new Error(`Mint ${mint} was not found on Solana mainnet`);
        const programId = mintAccount.owner;
        if (!programId.equals(TOKEN_PROGRAM_ID) && !programId.equals(TOKEN_2022_PROGRAM_ID)) {
          throw new Error(`Mint ${mint} is not owned by the SPL Token or Token-2022 program`);
        }
        const source = getAssociatedTokenAddressSync(mintKey, owner, false, programId);
        const destination = getAssociatedTokenAddressSync(mintKey, recipient, true, programId);
        transaction.add(
          createAssociatedTokenAccountIdempotentInstruction(owner, destination, recipient, mintKey, programId),
          createTransferCheckedInstruction(source, mintKey, destination, owner, amount, decimals, [], programId),
        );
      }

      return wallet.sendTransaction(transaction, connection);
    },
    [wallet, connection],
  );

  const value = useMemo<SolanaWalletState>(
    () => ({
      address: wallet.publicKey?.toBase58() ?? null,
      connect,
      disconnect,
      available: true,
      connecting: wallet.connecting,
      wallets: wallet.wallets.map((item) => ({
        name: item.adapter.name,
        icon: item.adapter.icon,
        readyState: String(item.readyState),
      })),
      connectWith,
      sendDeposit,
    }),
    [wallet.publicKey, wallet.connecting, wallet.wallets, connect, disconnect, connectWith, sendDeposit],
  );

  return <SolanaContext.Provider value={value}>{children}</SolanaContext.Provider>;
}

export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  const outer = useContext(SolanaContext);
  if (outer) return <>{children}</>;
  return (
    <ConnectionProvider endpoint={SOLANA_RPC_URL}>
      <WalletProvider wallets={[]} autoConnect localStorageKey="radiri.solanaWallet">
        <SolanaBridge>{children}</SolanaBridge>
      </WalletProvider>
    </ConnectionProvider>
  );
}

/** Solana wallet state; a disconnected placeholder (available = false) outside SolanaWalletProvider. */
export function useSolanaWallet(): SolanaWalletState {
  return useContext(SolanaContext) ?? DISCONNECTED;
}
