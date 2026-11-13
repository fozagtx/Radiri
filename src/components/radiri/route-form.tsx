import { ArrowLeftRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { StableAsset } from "@/lib/radiri/types";
import { ErrorNote } from "./bits";
import { chainLabel } from "./format";

export function assetKey(asset: StableAsset): string {
  return `${asset.symbol}:${asset.chain}`;
}

export function parseAssetKey(key: string): { symbol: string; chain: string } {
  const index = key.indexOf(":");
  return { symbol: key.slice(0, index), chain: key.slice(index + 1) };
}

function optionsFrom(assets: StableAsset[]): { value: string; label: string }[] {
  const seen = new Map<string, StableAsset>();
  for (const asset of assets) {
    const key = assetKey(asset);
    if (!seen.has(key)) seen.set(key, asset);
  }
  return Array.from(seen.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([value, asset]) => ({
      value,
      label: `${asset.symbol} on ${chainLabel(asset.chain)}`,
    }));
}

export function RouteForm({
  assets,
  catalogLoading,
  catalogError,
  onRetryCatalog,
  fromKey,
  toKey,
  amount,
  quoting,
  onFromChange,
  onToChange,
  onAmountChange,
  onSwap,
  onRecheck,
}: {
  assets: StableAsset[];
  catalogLoading: boolean;
  catalogError: string | null;
  onRetryCatalog: () => void;
  fromKey: string;
  toKey: string;
  amount: string;
  quoting: boolean;
  onFromChange: (key: string) => void;
  onToChange: (key: string) => void;
  onAmountChange: (amount: string) => void;
  onSwap: () => void;
  onRecheck: () => void;
}) {
  const options = optionsFrom(assets);
  const hasCatalog = options.length > 0;

  return (
    <form
      className="flex flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10"
      onSubmit={(event) => {
        event.preventDefault();
        onRecheck();
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-40 flex-1 flex-col gap-1">
          <span className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">From</span>
          {hasCatalog ? (
            <Select
              value={fromKey}
              onValueChange={(value) => {
                if (value) onFromChange(value);
              }}
              items={options}
            >
              <SelectTrigger className="w-full" aria-label="From stablecoin">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : catalogLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <Input value={`${parseAssetKey(fromKey).symbol} on ${chainLabel(parseAssetKey(fromKey).chain)}`} readOnly />
          )}
        </div>

        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Swap from and to"
          onClick={onSwap}
          className="mb-0.5"
        >
          <ArrowLeftRight aria-hidden />
        </Button>

        <div className="flex min-w-40 flex-1 flex-col gap-1">
          <span className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">To</span>
          {hasCatalog ? (
            <Select
              value={toKey}
              onValueChange={(value) => {
                if (value) onToChange(value);
              }}
              items={options}
            >
              <SelectTrigger className="w-full" aria-label="To stablecoin">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : catalogLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <Input value={`${parseAssetKey(toKey).symbol} on ${chainLabel(parseAssetKey(toKey).chain)}`} readOnly />
          )}
        </div>

        <div className="flex w-32 flex-col gap-1">
          <span className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">Amount in</span>
          <Input
            value={amount}
            onChange={(event) => onAmountChange(event.target.value)}
            inputMode="decimal"
            aria-label="Amount in"
            className="font-mono tabular-nums"
          />
        </div>

        <Button type="submit" disabled={quoting} className="mb-0.5">
          <RefreshCw className={quoting ? "animate-spin" : undefined} aria-hidden />
          {quoting ? "Quoting" : "Recheck"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-1.5 text-[0.7rem] text-muted-foreground">
        <span>
          Quotes are read only dry runs. Nothing signs, and no wallet is needed to compare routes.
        </span>
        <span>
          {catalogLoading
            ? "Loading stablecoin catalog."
            : hasCatalog
              ? `${options.length} stable assets from /api/stables`
              : "Catalog unavailable."}
        </span>
      </div>

      {catalogError ? (
        <div className="flex flex-col gap-1">
          <ErrorNote>{catalogError}</ErrorNote>
          <div>
            <Button type="button" size="xs" variant="outline" onClick={onRetryCatalog}>
              Retry catalog
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
