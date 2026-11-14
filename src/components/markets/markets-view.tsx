"use client";

import { useEffect, useState } from "react";
import { TokenAvatar } from "@/components/app/token-avatar";
import { MarketNotice } from "@/components/shared/account-summary";
import { Note, Pill, SkeletonRows } from "@/components/shared/bits";
import { amountOf, referenceOf } from "@/components/shared/format";
import { useLending } from "@/components/shared/lending-provider";
import { ModeBanner } from "@/components/shared/mode-banner";
import { chainName } from "@/lib/intents/chains";
import { formatAge, formatBpsPercent, formatPriceWad, pricedAsset } from "@/lib/risk";
import type { RheaLendingSnapshot } from "@/lib/rhea/lending";
import { cn } from "@/lib/utils";
import type { AssetView, CatalogAsset, LendingCategory } from "@/types/protocol";

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error"; error: string };

function useJson<T>(url: string): Load<T> {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json()) as T & { error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        if (!cancelled) setLoad({ state: "ready", data: body });
      })
      .catch((error: unknown) => !cancelled && setLoad({ state: "error", error: error instanceof Error ? error.message : String(error) }));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return load;
}

function usd(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "–";
  if (value >= 1) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${value.toPrecision(3)}`;
}

function MarketCard({ asset, index }: { asset: AssetView; index: number }) {
  const { market } = useLending();
  const check = market ? pricedAsset(market.assets, asset.config.token_id, market.nowMs).price : null;
  const reference = referenceOf(asset.config.token_id);
  const price = asset.price ? BigInt(asset.price.price_wad) : null;
  return (
    <div
      className="radiri-rise flex flex-col gap-4 rounded-[24px] border border-foreground/10 bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_20px_50px_-30px_rgba(25,25,25,0.45)]"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-center gap-3">
        <TokenAvatar symbol={asset.config.symbol} category={asset.config.category} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[16px] font-semibold tracking-tight">{asset.config.symbol}</span>
            <Pill tone="warn">test</Pill>
          </div>
          <span className="text-[12px] text-muted-foreground">mirrors {reference?.symbol ?? "–"}</span>
        </div>
        <div className="text-right">
          <div className="font-mono text-[15px] tabular-nums">{formatPriceWad(price)}</div>
          <div className={cn("text-[11px]", check?.fresh ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>
            {check?.fresh ? "fresh" : "stale"} · {formatAge(check?.ageMs ?? null)}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1 flex justify-between text-[11.5px] text-muted-foreground">
          <span>Utilization</span>
          <span className="font-mono">{formatBpsPercent(asset.utilization_bps)}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-foreground/8">
          <div className="h-full rounded-full bg-foreground/70 transition-[width] duration-700" style={{ width: `${Math.min(100, asset.utilization_bps / 100)}%` }} />
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-[12px]">
        <div>
          <dt className="text-muted-foreground">Borrow APR</dt>
          <dd className="font-mono text-[14px]">{formatBpsPercent(asset.borrow_apr_bps)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Supply APR</dt>
          <dd className="font-mono text-[14px]">{formatBpsPercent(asset.supply_apr_bps)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Max LTV</dt>
          <dd className="font-mono text-[14px]">{formatBpsPercent(asset.config.ltv_bps, 0)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Liquidation</dt>
          <dd className="font-mono">{formatBpsPercent(asset.config.liquidation_threshold_bps, 0)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted-foreground">Available to borrow</dt>
          <dd className="truncate font-mono">{amountOf(asset, asset.cash, 2)}</dd>
        </div>
      </dl>
      <div className="flex gap-1.5">
        {asset.config.can_collateralize ? <Pill tone="good">collateral</Pill> : null}
        {asset.config.can_borrow ? <Pill tone="good">borrowable</Pill> : null}
        {asset.config.paused ? <Pill tone="bad">paused</Pill> : null}
      </div>
    </div>
  );
}

function LendingMarkets({ category }: { category: LendingCategory }) {
  const lending = useLending();
  if (lending.marketsState !== "ready") return <SkeletonRows rows={3} />;
  const assets = lending.assets.filter((asset) => asset.config.category === category);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {assets.map((asset, index) => (
        <MarketCard key={asset.config.token_id} asset={asset} index={index} />
      ))}
    </div>
  );
}

function SwapAssets() {
  const catalog = useJson<{ assets: CatalogAsset[] }>("/api/assets?eligible=swap");
  if (catalog.state === "loading") return <SkeletonRows rows={4} />;
  if (catalog.state === "error") return <Note tone="bad">NEAR Intents catalog unavailable: {catalog.error}</Note>;
  const groups: { title: string; rows: CatalogAsset[] }[] = [
    { title: "Tokenized stocks", rows: catalog.data.assets.filter((asset) => asset.category === "stock" && asset.priceUsd) },
    { title: "Meme coins", rows: catalog.data.assets.filter((asset) => asset.category === "meme" && asset.priceUsd) },
  ];
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.title}>
          <h3 className="mb-2 text-[13px] font-semibold text-muted-foreground">{group.title}</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {group.rows.map((asset) => (
              <div key={asset.id} className="flex items-center gap-3 rounded-2xl border border-foreground/8 bg-card px-3 py-2.5">
                <TokenAvatar symbol={asset.symbol} category={asset.category} chain={asset.chain} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold">{asset.symbol}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{chainName(asset.chain)}</div>
                </div>
                <span className="font-mono text-[12.5px] tabular-nums">{usd(asset.priceUsd)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RheaReference() {
  const rhea = useJson<RheaLendingSnapshot>("/api/rhea/lending");
  if (rhea.state !== "ready") return null;
  const lendable = rhea.data.reserves.filter((reserve) => reserve.canUseAsCollateral || reserve.canBorrow).length;
  return (
    <p className="text-[12px] text-muted-foreground">
      For reference, RHEA Lending on NEAR mainnet (<span className="font-mono">{rhea.data.contractId}</span>) has {rhea.data.reserves.length} reserves, {lendable} of
      them usable as collateral or borrowable, and none is a meme coin or a tokenized stock. That gap is what Radiri&apos;s markets fill.
    </p>
  );
}

export function MarketsView() {
  return (
    <div className="flex flex-col gap-6">
      <div className="radiri-rise">
        <h1 className="font-display text-[34px] leading-tight sm:text-[40px]">Markets</h1>
        <p className="text-[13.5px] text-muted-foreground">Live lending markets on NEAR testnet and every meme coin and stock you can swap through NEAR Intents.</p>
      </div>
      <ModeBanner />
      <MarketNotice />

      <section className="flex flex-col gap-3">
        <h2 className="text-[17px] font-semibold tracking-tight">Meme coin markets</h2>
        <LendingMarkets category="meme" />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-[17px] font-semibold tracking-tight">Tokenized stock markets</h2>
        <LendingMarkets category="stock" />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-[17px] font-semibold tracking-tight">Swap catalog · NEAR Intents</h2>
        <SwapAssets />
      </section>
      <RheaReference />
    </div>
  );
}
