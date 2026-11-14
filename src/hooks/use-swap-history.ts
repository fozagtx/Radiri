"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { SwapRecord } from "@/types/protocol";

/**
 * Swaps started from this browser, kept in localStorage under "radiri.swaps.v1" (every access is
 * wrapped in try/catch: private windows and blocked storage simply yield an empty history).
 * When the optional database index is enabled (/api/transactions), each record is mirrored there;
 * the server re-reads the swap from 1Click before storing anything.
 */
export interface SwapHistory {
  records: SwapRecord[];
  upsert: (record: SwapRecord) => void;
  remove: (depositAddress: string) => void;
}

const STORAGE_KEY = "radiri.swaps.v1";
const MAX_RECORDS = 100;
const EMPTY: SwapRecord[] = [];

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedRecords: SwapRecord[] = EMPTY;

function isRecord(value: unknown): value is SwapRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<SwapRecord>;
  return (
    typeof record.depositAddress === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.lastStatus === "string" &&
    Boolean(record.quote && typeof record.quote === "object")
  );
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function getSnapshot(): SwapRecord[] {
  const raw = readRaw();
  if (raw === cachedRaw) return cachedRecords;
  cachedRaw = raw;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cachedRecords = Array.isArray(parsed) ? parsed.filter(isRecord) : EMPTY;
  } catch {
    cachedRecords = EMPTY;
  }
  return cachedRecords;
}

function getServerSnapshot(): SwapRecord[] {
  return EMPTY;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function write(records: SwapRecord[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
  } catch {
    // Storage full or blocked: the in-page flow still works, history just is not kept.
  }
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  try {
    window.addEventListener("storage", onStorage);
  } catch {
    // no window events (tests)
  }
  return () => {
    listeners.delete(listener);
    try {
      window.removeEventListener("storage", onStorage);
    } catch {
      // ignore
    }
  };
}

function sameSwap(a: Pick<SwapRecord, "depositAddress" | "depositMemo">, b: Pick<SwapRecord, "depositAddress" | "depositMemo">) {
  return a.depositAddress === b.depositAddress && (a.depositMemo ?? null) === (b.depositMemo ?? null);
}

/* Mirror to the optional database index. */
let indexEnabled: Promise<boolean> | null = null;
const mirrored = new Map<string, string>();

function databaseEnabled(): Promise<boolean> {
  if (!indexEnabled) {
    indexEnabled = fetch("/api/transactions?limit=1", { cache: "no-store" })
      .then(async (res) => Boolean(((await res.json()) as { enabled?: boolean }).enabled))
      .catch(() => false);
  }
  return indexEnabled;
}

function mirror(record: SwapRecord): void {
  if (record.quote.dry) return;
  const key = `${record.depositAddress}|${record.depositMemo ?? ""}`;
  const signature = `${record.lastStatus}|${record.depositTxHash ?? ""}`;
  if (mirrored.get(key) === signature) return;
  mirrored.set(key, signature);
  void databaseEnabled().then((enabled) => {
    if (!enabled) return;
    return fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        depositAddress: record.depositAddress,
        depositMemo: record.depositMemo,
        depositTxHash: record.depositTxHash,
      }),
    }).catch(() => {
      mirrored.delete(key);
    });
  });
}

export function useSwapHistory(): SwapHistory {
  const records = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const upsert = useCallback((record: SwapRecord) => {
    const current = getSnapshot();
    const existing = current.find((item) => sameSwap(item, record));
    const merged: SwapRecord = existing ? { ...existing, ...record, createdAt: existing.createdAt } : record;
    const next = [merged, ...current.filter((item) => !sameSwap(item, record))].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    write(next);
    mirror(merged);
  }, []);

  const remove = useCallback((depositAddress: string) => {
    write(getSnapshot().filter((item) => item.depositAddress !== depositAddress));
  }, []);

  return { records, upsert, remove };
}
