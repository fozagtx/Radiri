"use client";

import { Check } from "lucide-react";
import { TokenAvatar } from "@/components/app/token-avatar";
import { referenceOf } from "@/components/shared/format";
import { cn } from "@/lib/utils";
import type { AssetView } from "@/types/protocol";

export interface PickerOption {
  asset: AssetView;
  /** Secondary line (balance, APR, liquidity ...). */
  detail: React.ReactNode;
  /** Why it cannot be chosen, if it cannot. */
  disabledReason?: string | null;
}

/** Radio list of assets as token rows. Disabled options stay visible with their reason. */
export function AssetPicker({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: PickerOption[];
  value: string | null;
  onChange: (tokenId: string) => void;
}) {
  if (options.length === 0) return <p className="text-xs text-muted-foreground">No assets in this category on the lending contract.</p>;
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {options.map(({ asset, detail, disabledReason }) => {
        const selected = asset.config.token_id === value;
        const disabled = !!disabledReason;
        const reference = referenceOf(asset.config.token_id);
        return (
          <button
            key={asset.config.token_id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={disabled || undefined}
            title={disabledReason ?? undefined}
            onClick={() => {
              if (!disabled) onChange(asset.config.token_id);
            }}
            className={cn(
              "group flex min-w-0 items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-all",
              selected
                ? "border-foreground/70 bg-card shadow-[0_1px_0_rgba(25,25,25,0.04),0_8px_24px_-12px_rgba(25,25,25,0.25)]"
                : "border-foreground/10 bg-card/60 hover:border-foreground/30 hover:bg-card",
              disabled && "cursor-not-allowed opacity-50 hover:border-foreground/10",
            )}
          >
            <TokenAvatar symbol={asset.config.symbol} category={asset.config.category} size="md" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-1.5">
                <span className="text-[14px] font-semibold tracking-tight">{asset.config.symbol}</span>
                {reference ? <span className="truncate text-[11px] text-muted-foreground">{reference.symbol}</span> : null}
              </span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">{disabledReason ?? detail}</span>
            </span>
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full border transition-colors",
                selected ? "border-foreground bg-foreground text-background" : "border-foreground/20 text-transparent",
              )}
              aria-hidden
            >
              <Check className="size-3" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
