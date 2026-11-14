"use client";

import { EvmWalletProvider } from "@/lib/wallets/evm";
import { NearWalletProvider } from "@/lib/wallets/near";
import { SolanaWalletProvider } from "@/lib/wallets/solana";

/**
 * Client providers for the whole app: NEAR (lending network, NEAR Connect), EVM and Solana
 * (swap origins). Each provider owns its own wallet state; none of them signs anything on load.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NearWalletProvider>
      <EvmWalletProvider>
        <SolanaWalletProvider>{children}</SolanaWalletProvider>
      </EvmWalletProvider>
    </NearWalletProvider>
  );
}
