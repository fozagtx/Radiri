"use client";

import { useMemo } from "react";
import { useSwapHistory } from "@/hooks/use-swap-history";
import { lendingActivityItems, mergeActivity, swapActivityItems } from "@/lib/lending";
import type { ActivityItem } from "@/types/protocol";
import { useLending } from "@/components/shared/lending-provider";

/** Lending activity (contract or simulation) merged with this browser's 1Click swaps, newest first. */
export function useActivityItems(): ActivityItem[] {
  const { activity, mode, assetIndex } = useLending();
  const { records } = useSwapHistory();
  return useMemo(() => {
    const lending = lendingActivityItems(activity, {
      source: mode === "near" ? "lending-contract" : "simulation",
      tokenInfo: (tokenId) => {
        const asset = assetIndex.get(tokenId);
        return asset ? { symbol: asset.config.symbol, decimals: asset.config.decimals } : undefined;
      },
    });
    return mergeActivity(lending, swapActivityItems(records));
  }, [activity, mode, assetIndex, records]);
}
