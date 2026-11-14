"use client";

import { Input } from "@/components/ui/input";
import { formatTokenAmount, formatUnits, type MaxAmount, parseUnits } from "@/lib/risk";
import { cn } from "@/lib/utils";

const LIMITER_LABEL: Record<MaxAmount["limitedBy"], string> = {
  wallet: "wallet balance",
  health: "borrow limit",
  liquidity: "pool liquidity",
  cap: "protocol cap",
  position: "your position",
  blocked: "blocked",
  none: "",
};

/** Validates a typed amount exactly against the token's decimals. Null = no error. */
export function amountError(input: string, decimals: number): string | null {
  if (input.trim() === "") return null;
  try {
    parseUnits(input, decimals);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function AmountInput({
  id,
  label,
  value,
  onChange,
  decimals,
  symbol,
  max,
  balance,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  decimals: number;
  symbol: string;
  max?: MaxAmount | null;
  balance?: { label: string; amount: bigint | null } | null;
  disabled?: boolean;
}) {
  const error = amountError(value, decimals);
  const canMax = !!max && max.amount > BigInt(0) && !disabled;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </label>
        {balance ? (
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {balance.label}: {balance.amount === null ? "n/a" : `${formatTokenAmount(balance.amount, decimals)} ${symbol}`}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="0.0"
            value={value}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => onChange(event.currentTarget.value)}
            className="h-9 pr-16 text-[14px]"
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-[11px] text-muted-foreground">
            {symbol}
          </span>
        </div>
        <button
          type="button"
          disabled={!canMax}
          onClick={() => max && onChange(formatUnits(max.amount, decimals))}
          className={cn(
            "h-9 shrink-0 rounded-full border border-foreground/15 px-3 text-[12px] font-medium transition-colors",
            canMax ? "hover:border-foreground/35" : "cursor-not-allowed opacity-50",
          )}
        >
          Max
        </button>
      </div>
      <div className="flex min-h-4 items-center justify-between gap-2 text-[11px]">
        {error ? (
          <span id={`${id}-error`} className="text-destructive">
            {error}
          </span>
        ) : max ? (
          <span className="font-mono text-muted-foreground">
            {max.limitedBy === "blocked"
              ? "Max 0: blocked (see reasons)"
              : `Max ${formatTokenAmount(max.amount, decimals)} ${symbol}${LIMITER_LABEL[max.limitedBy] ? ` · ${LIMITER_LABEL[max.limitedBy]}` : ""}`}
          </span>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
