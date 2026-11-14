"use client";

import { useEffect, useState } from "react";
import type { CatalogAsset } from "@/types/protocol";

export type CatalogState =
  | { state: "loading" }
  | { state: "ready"; assets: CatalogAsset[]; fetchedAt: string }
  | { state: "error"; error: string };

/** Swap-eligible assets from the live 1Click catalog (GET /api/assets?eligible=swap). */
export function useSwapCatalog(): CatalogState {
  const [catalog, setCatalog] = useState<CatalogState>({ state: "loading" });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/assets?eligible=swap", { cache: "no-store" });
        const body = (await res.json()) as { assets?: CatalogAsset[]; fetchedAt?: string; error?: string };
        if (!res.ok || !body.assets) throw new Error(body.error ?? `HTTP ${res.status}`);
        if (!cancelled) setCatalog({ state: "ready", assets: body.assets, fetchedAt: body.fetchedAt ?? new Date().toISOString() });
      } catch (error) {
        if (!cancelled) setCatalog({ state: "error", error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return catalog;
}

export function findAsset(assets: CatalogAsset[], symbol: string, chain: string): CatalogAsset | undefined {
  return assets.find((asset) => asset.symbol === symbol && asset.chain === chain);
}
