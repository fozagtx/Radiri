"use client";

import { cn } from "@/lib/utils";
import type { AssetView } from "@/types/protocol";

export interface PickerOption {
  asset: AssetView;
  /** Secondary line (balance, APR, liquidity ...). */
  detail: React.ReactNode;
  /** Why it cannot be chosen, if it cannot. */
  disabledReason?: string | null;
}

/** Pill radio group of assets. Disabled options stay visible with their reason. */
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
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {options.map(({ asset, detail, disabledReason }) => {
        const selected = asset.config.token_id === value;
        const disabled = !!disabledReason;
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
              "flex min-w-0 flex-col items-start gap-0.5 rounded-xl border px-2.5 py-2 text-left transition-colors",
              selected
                ? "border-foreground bg-foreground/[0.04] ring-1 ring-foreground/60"
                : "border-foreground/12 hover:border-foreground/30",
              disabled && "cursor-not-allowed opacity-55 hover:border-foreground/12",
            )}
          >
            <span className="text-[13px] font-semibold">{asset.config.symbol}</span>
            <span className="w-full truncate font-mono text-[10.5px] text-muted-foreground">{disabledReason ?? detail}</span>
          </button>
        );
      })}
    </div>
  );
}
