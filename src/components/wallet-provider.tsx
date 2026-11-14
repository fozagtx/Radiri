"use client";

/**
 * Compatibility layer: existing components import `WalletProvider` / `useWallet`. Both are thin
 * aliases over the NEAR Connect provider in `@/lib/wallets/near` (the lending network wallet).
 */

import { NearWalletProvider, useNearWallet, type NearWalletState } from "@/lib/wallets/near";

export const WalletProvider = NearWalletProvider;

export type WalletState = NearWalletState;

export function useWallet(): NearWalletState {
  return useNearWallet();
}
