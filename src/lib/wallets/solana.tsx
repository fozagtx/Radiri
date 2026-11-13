"use client";

/**
 * STUB owned by the swap agent: replace the internals with @solana/wallet-adapter-react
 * (wallet-standard discovery, NEXT_PUBLIC_SOLANA_RPC_URL). Keep these export names.
 */
export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export interface SolanaWalletState {
  address: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export function useSolanaWallet(): SolanaWalletState {
  return { address: null, connect: async () => {}, disconnect: async () => {} };
}
