/**
 * Typed wrappers for the lending contract views (docs/ARCHITECTURE.md section 4) and the NEP-141 /
 * NEP-145 views the transaction builders need. Every call reads chain state; nothing is cached.
 */

import type { AccountView, ActivityEntry, AssetView, LendingConfigView, OraclePrice, U128 } from "@/types/protocol";
import { viewCall, type ViewCallOptions } from "./rpc";

export interface StorageBalance {
  total: U128;
  available: U128;
}

export interface StorageBalanceBounds {
  min: U128;
  max: U128 | null;
}

export interface FungibleTokenMetadata {
  spec: string;
  name: string;
  symbol: string;
  decimals: number;
  icon?: string | null;
}

/** get_account_activity keeps the last 32 entries per account. */
export const ACTIVITY_LIMIT = 32;

export function getLendingConfig(contractId: string, options?: ViewCallOptions): Promise<LendingConfigView> {
  return viewCall<LendingConfigView>(contractId, "get_config", {}, options);
}

export function getLendingAssets(contractId: string, options?: ViewCallOptions): Promise<AssetView[]> {
  return viewCall<AssetView[]>(contractId, "get_assets", {}, options);
}

export function getLendingAsset(contractId: string, tokenId: string, options?: ViewCallOptions): Promise<AssetView | null> {
  return viewCall<AssetView | null>(contractId, "get_asset", { token_id: tokenId }, options);
}

export function getLendingPrice(contractId: string, tokenId: string, options?: ViewCallOptions): Promise<OraclePrice | null> {
  return viewCall<OraclePrice | null>(contractId, "get_price", { token_id: tokenId }, options);
}

export function getLendingAccount(contractId: string, accountId: string, options?: ViewCallOptions): Promise<AccountView | null> {
  return viewCall<AccountView | null>(contractId, "get_account", { account_id: accountId }, options);
}

export function getLendingActivity(
  contractId: string,
  accountId: string,
  fromIndex = 0,
  limit = ACTIVITY_LIMIT,
  options?: ViewCallOptions,
): Promise<ActivityEntry[]> {
  return viewCall<ActivityEntry[]>(
    contractId,
    "get_account_activity",
    { account_id: accountId, from_index: fromIndex, limit },
    options,
  );
}

export function isLiquidatableView(contractId: string, accountId: string, options?: ViewCallOptions): Promise<boolean> {
  return viewCall<boolean>(contractId, "is_liquidatable", { account_id: accountId }, options);
}

export function storageBalanceOf(contractId: string, accountId: string, options?: ViewCallOptions): Promise<StorageBalance | null> {
  return viewCall<StorageBalance | null>(contractId, "storage_balance_of", { account_id: accountId }, options);
}

export function storageBalanceBounds(contractId: string, options?: ViewCallOptions): Promise<StorageBalanceBounds> {
  return viewCall<StorageBalanceBounds>(contractId, "storage_balance_bounds", {}, options);
}

export function ftBalanceOf(tokenId: string, accountId: string, options?: ViewCallOptions): Promise<U128> {
  return viewCall<U128>(tokenId, "ft_balance_of", { account_id: accountId }, options);
}

export function ftMetadata(tokenId: string, options?: ViewCallOptions): Promise<FungibleTokenMetadata> {
  return viewCall<FungibleTokenMetadata>(tokenId, "ft_metadata", {}, options);
}
