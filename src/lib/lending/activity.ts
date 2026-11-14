/**
 * Unified activity feed (ActivityItem) from lending activity (contract or simulation) and 1Click
 * swap records. Pure mapping, no I/O.
 */

import { EXPLORER_URL } from "@/lib/config";
import { formatTokenAmount, u128OrZero } from "@/lib/risk";
import type { ActivityEntry, ActivityItem, ActivityKind, SwapRecord, SwapStatusValue } from "@/types/protocol";

/** Documented NEAR Intents explorer: swaps are found there by searching the deposit address. */
export const INTENTS_EXPLORER_URL = "https://explorer.near-intents.org";

export const ACTIVITY_TITLE: Record<ActivityKind | "swap", string> = {
  deposit_collateral: "Deposited collateral",
  withdraw_collateral: "Withdrew collateral",
  supply: "Supplied to pool",
  withdraw_supply: "Withdrew supply",
  borrow: "Borrowed",
  repay: "Repaid debt",
  liquidated: "Position liquidated",
  liquidate: "Liquidated an account",
  swap: "Cross-chain swap",
};

export interface TokenInfo {
  symbol: string;
  decimals: number;
}

export function lendingActivityItems(
  entries: ActivityEntry[],
  options: { source: "lending-contract" | "simulation"; tokenInfo: (tokenId: string) => TokenInfo | undefined },
): ActivityItem[] {
  return entries.map((entry, index) => {
    const info = options.tokenInfo(entry.token_id);
    const amount = info ? formatTokenAmount(u128OrZero(entry.amount), info.decimals) : `${entry.amount} base units`;
    const symbol = info?.symbol ?? entry.token_id;
    const counterparty =
      entry.counterparty && (entry.kind === "liquidated" || entry.kind === "liquidate")
        ? entry.kind === "liquidated"
          ? ` · by ${entry.counterparty}`
          : ` · borrower ${entry.counterparty}`
        : "";
    const onChain = options.source === "lending-contract" && entry.block_height > 0;
    return {
      id: `${options.source}:${entry.block_height}:${entry.timestamp_ms}:${entry.kind}:${index}`,
      kind: entry.kind,
      title: ACTIVITY_TITLE[entry.kind] ?? entry.kind,
      detail: `${amount} ${symbol}${counterparty}`,
      timestamp: new Date(entry.timestamp_ms).toISOString(),
      status: "success",
      source: options.source,
      explorerUrl: onChain ? `${EXPLORER_URL}/blocks/${entry.block_height}` : null,
    };
  });
}

export function swapStatus(value: SwapStatusValue): ActivityItem["status"] {
  switch (value) {
    case "SUCCESS":
      return "success";
    case "REFUNDED":
      return "refunded";
    case "FAILED":
      return "failed";
    default:
      return "pending";
  }
}

export function swapActivityItems(records: SwapRecord[]): ActivityItem[] {
  return records.map((record) => {
    const { origin, destination } = record.quote;
    return {
      id: `1click:${record.depositAddress}`,
      kind: "swap",
      title: `Swap ${origin.symbol} → ${destination.symbol}`,
      detail: `${record.quote.amountIn} ${origin.symbol} (${origin.chain}) → ${record.quote.amountOut} ${destination.symbol} (${destination.chain}) · deposit ${record.depositAddress} · ${record.lastStatus}`,
      timestamp: record.updatedAt || record.createdAt,
      status: swapStatus(record.lastStatus),
      source: "1click",
      explorerUrl: INTENTS_EXPLORER_URL,
    };
  });
}

/** Newest first; unparseable timestamps sink to the bottom. */
export function mergeActivity(...groups: ActivityItem[][]): ActivityItem[] {
  const time = (item: ActivityItem) => {
    const parsed = Date.parse(item.timestamp);
    return Number.isFinite(parsed) ? parsed : -Infinity;
  };
  return groups.flat().sort((a, b) => time(b) - time(a));
}
