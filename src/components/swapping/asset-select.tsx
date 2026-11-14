"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { chainName } from "@/lib/intents/chains";
import { cn } from "@/lib/utils";
import type { CatalogAsset } from "@/types/protocol";

export type CategoryFilter = "meme" | "stock" | "all";

const FILTERS: { id: CategoryFilter; label: string }[] = [
  { id: "meme", label: "Meme coins" },
  { id: "stock", label: "Tokenized stocks" },
  { id: "all", label: "All" },
];

function usd(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "no price";
  return value >= 1 ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${value.toPrecision(3)}`;
}

export function assetLabel(asset: CatalogAsset): string {
  return `${asset.symbol} · ${chainName(asset.chain)}`;
}

/** Category pills + one select of "SYMBOL · Network" (asset and network are chosen together). */
export function AssetSelect({
  label,
  assets,
  filter,
  onFilterChange,
  value,
  onChange,
}: {
  label: string;
  assets: CatalogAsset[];
  filter: CategoryFilter;
  onFilterChange: (filter: CategoryFilter) => void;
  value: string | null;
  onChange: (assetId: string) => void;
}) {
  const visible = assets
    .filter((asset) => filter === "all" || asset.category === filter || asset.id === value)
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.chain.localeCompare(b.chain));
  const items = visible.map((asset) => ({ value: asset.id, label: assetLabel(asset) }));
  const selected = assets.find((asset) => asset.id === value) ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <div role="group" aria-label={`${label} type`} className="flex gap-1">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={filter === entry.id}
              onClick={() => onFilterChange(entry.id)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                filter === entry.id
                  ? "border-foreground bg-foreground text-background"
                  : "border-foreground/15 text-foreground/70 hover:border-foreground/35",
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      <Select
        value={value ?? ""}
        onValueChange={(next) => {
          if (typeof next === "string" && next) onChange(next);
        }}
        items={items}
      >
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue placeholder="Choose an asset" />
        </SelectTrigger>
        <SelectContent>
          {visible.map((asset) => (
            <SelectItem key={asset.id} value={asset.id}>
              {assetLabel(asset)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected ? (
        <span className="text-[11px] text-muted-foreground">
          {selected.category === "stock" ? "Tokenized stock" : selected.category === "meme" ? "Meme coin" : selected.category} on{" "}
          {chainName(selected.chain)} · 1Click price <span className="font-mono">{usd(selected.priceUsd)}</span>
          {selected.contractAddress ? (
            <>
              {" "}
              · contract <span className="font-mono">{selected.contractAddress.slice(0, 8)}…{selected.contractAddress.slice(-4)}</span>
            </>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
