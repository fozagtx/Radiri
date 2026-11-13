"use client";

/**
 * STUB owned by the swap agent: replace the internals with wagmi/viem (injected connector, plus
 * Reown WalletConnect when NEXT_PUBLIC_REOWN_PROJECT_ID is set). Keep these export names.
 */
export function EvmWalletProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export interface EvmWalletState {
  address: string | null;
  chainId: number | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export function useEvmWallet(): EvmWalletState {
  return { address: null, chainId: null, connect: async () => {}, disconnect: async () => {} };
}
