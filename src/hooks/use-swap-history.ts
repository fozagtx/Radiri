"use client";

import type { SwapRecord } from "@/types/protocol";

/**
 * STUB owned by the swap agent: replace with a localStorage-backed store (key "radiri.swaps.v1",
 * try/catch around every access) that also mirrors to /api/transactions when a database is set.
 * Keep this signature.
 */
export interface SwapHistory {
  records: SwapRecord[];
  upsert: (record: SwapRecord) => void;
  remove: (depositAddress: string) => void;
}

export function useSwapHistory(): SwapHistory {
  return { records: [], upsert: () => {}, remove: () => {} };
}
