"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { TokenAvatar } from "@/components/app/token-avatar";
import { chainName } from "@/lib/intents/chains";
import { cn } from "@/lib/utils";
import type { CatalogAsset } from "@/types/protocol";

export type SwapCategory = "meme" | "stock";

function usd(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "";
  if (value >= 1) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${value.toPrecision(3)}`;
}

/** Only meme coins and tokenized stocks are offered: this product swaps between those two. */
export function swappable(assets: CatalogAsset[]): CatalogAsset[] {
  return assets.filter((asset) => asset.category === "meme" || asset.category === "stock");
}

/** Full-card token list: search, meme / stock tabs, logos with chain badges, live 1Click prices. */
export function TokenSelector({
  title,
  assets,
  initialCategory,
  selectedId,
  onSelect,
  onClose,
}: {
  title: string;
  assets: CatalogAsset[];
  initialCategory: SwapCategory;
  selectedId: string | null;
  onSelect: (asset: CatalogAsset) => void;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<SwapCategory>(initialCategory);
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return swappable(assets)
      .filter((asset) => asset.category === category)
      .filter((asset) => !q || asset.symbol.toLowerCase().includes(q) || (asset.name ?? "").toLowerCase().includes(q) || chainName(asset.chain).toLowerCase().includes(q))
      .sort((a, b) => (b.priceUsd ? 1 : 0) - (a.priceUsd ? 1 : 0) || a.symbol.localeCompare(b.symbol) || a.chain.localeCompare(b.chain));
  }, [assets, category, query]);

  return (
    <div className="radiri-rise flex max-h-[min(640px,80vh)] flex-col">
      <div className="flex items-center gap-2 px-2 pt-1 pb-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to swap"
          className="grid size-9 place-items-center rounded-full text-foreground/70 transition-colors hover:bg-foreground/6 hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </button>
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      </div>

      <label className="mx-2 flex items-center gap-2 rounded-2xl border border-foreground/10 bg-background px-3 py-2.5 focus-within:border-foreground/35">
        <Search className="size-4 text-muted-foreground" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, ticker or network"
          className="w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
        />
      </label>

      <div role="tablist" aria-label="Asset type" className="mx-2 mt-3 grid grid-cols-2 gap-1 rounded-full bg-foreground/5 p-1">
        {(["meme", "stock"] as const).map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={category === id}
            onClick={() => setCategory(id)}
            className={cn(
              "rounded-full py-1.5 text-[13px] font-medium transition-colors",
              category === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {id === "meme" ? "Meme coins" : "Tokenized stocks"}
          </button>
        ))}
      </div>

      <ul className="mt-2 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {rows.length === 0 ? <li className="px-3 py-6 text-center text-[13px] text-muted-foreground">No match.</li> : null}
        {rows.map((asset) => {
          const selected = asset.id === selectedId;
          return (
            <li key={asset.id}>
              <button
                type="button"
                onClick={() => onSelect(asset)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-foreground/5",
                  selected && "bg-foreground/6",
                )}
              >
                <TokenAvatar symbol={asset.symbol} category={asset.category} chain={asset.chain} size="lg" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[14.5px] font-semibold tracking-tight">{asset.symbol}</span>
                  <span className="truncate text-[12px] text-muted-foreground">
                    {asset.name && asset.name !== asset.symbol ? `${asset.name} · ` : ""}
                    {chainName(asset.chain)}
                  </span>
                </span>
                <span className="font-mono text-[13px] tabular-nums text-foreground/80">{usd(asset.priceUsd) || "no price"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
