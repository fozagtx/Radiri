/**
 * Browser-local state of the labelled lending simulation (localStorage key radiri.lending.sim.v1).
 * Every storage access is wrapped: private windows, blocked storage and SSR fall back to memory
 * for the session. Nothing here is ever presented as an on-chain position.
 */

import type { ActivityEntry } from "@/types/protocol";

export const SIM_STORAGE_KEY = "radiri.lending.sim.v1";
export const SIM_CHANGED_EVENT = "radiri:lending-sim-changed";

export interface SimPool {
  cash: string;
  total_borrowed: string;
  reserves: string;
  total_collateral: string;
  total_supply_shares: string;
  borrow_index: string;
  last_accrual_ms: number;
  /** Cash seeded by the simulation itself (labelled in the UI). */
  seeded: string;
}

export interface SimAccount {
  collateral: Record<string, string>;
  supply_shares: Record<string, string>;
  scaled_debt: Record<string, string>;
  /** Simulated test-token wallet: where faucet tokens and borrowed tokens land. */
  wallet: Record<string, string>;
}

export interface SimState {
  version: 1;
  createdAtMs: number;
  paused: boolean;
  pools: Record<string, SimPool>;
  accounts: Record<string, SimAccount>;
  activity: Record<string, ActivityEntry[]>;
}

let memoryState: SimState | null = null;

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function isSimState(value: unknown): value is SimState {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<SimState>;
  return record.version === 1 && typeof record.pools === "object" && typeof record.accounts === "object";
}

export function loadSimState(): SimState | null {
  const store = storage();
  if (store) {
    try {
      const raw = store.getItem(SIM_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isSimState(parsed)) {
          memoryState = parsed;
          return parsed;
        }
      }
    } catch {
      // fall through to the in-memory copy
    }
  }
  return memoryState;
}

export function saveSimState(state: SimState): void {
  memoryState = state;
  const store = storage();
  if (store) {
    try {
      store.setItem(SIM_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // quota or blocked storage: keep the in-memory copy for this session
    }
  }
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(SIM_CHANGED_EVENT));
  } catch {
    // no window
  }
}

export function clearSimState(): void {
  memoryState = null;
  const store = storage();
  if (store) {
    try {
      store.removeItem(SIM_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(SIM_CHANGED_EVENT));
  } catch {
    // no window
  }
}

/** Test hook: drop the in-memory copy. */
export function resetSimMemory(): void {
  memoryState = null;
}

export function emptySimAccount(): SimAccount {
  return { collateral: {}, supply_shares: {}, scaled_debt: {}, wallet: {} };
}
