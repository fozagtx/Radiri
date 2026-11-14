"use client";

import { useEffect, useState } from "react";
import { MarketNotice } from "@/components/shared/account-summary";
import { AssetLabel, Note, PageHeader, Pill, PriceTag, Section, SkeletonRows } from "@/components/shared/bits";
import { amountOf } from "@/components/shared/format";
import { useLending } from "@/components/shared/lending-provider";
import { ModeBanner } from "@/components/shared/mode-banner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NETWORK } from "@/lib/config";
import { formatBpsPercent, pricedAsset, u128OrZero, ZERO } from "@/lib/risk";
import type { RheaLendingSnapshot } from "@/lib/rhea/lending";
import type { CatalogAsset } from "@/types/protocol";

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error"; error: string };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}

function useJson<T>(url: string): Load<T> {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  useEffect(() => {
    let cancelled = false;
    getJson<T>(url).then(
      (data) => !cancelled && setLoad({ state: "ready", data }),
      (error: unknown) => !cancelled && setLoad({ state: "error", error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [url]);
  return load;
}

function usd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "–";
  if (value >= 1) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${value.toPrecision(3)}`;
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return <Pill tone={on ? "good" : "neutral"}>{on ? label : `no ${label}`}</Pill>;
}

function RadiriMarkets() {
  const lending = useLending();
  if (lending.marketsState !== "ready" || !lending.market) return <SkeletonRows rows={4} />;
  const { market } = lending;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Asset</TableHead>
          <TableHead>Eligibility</TableHead>
          <TableHead className="text-right">LTV / liq. / bonus</TableHead>
          <TableHead className="text-right">Pool cash</TableHead>
          <TableHead className="text-right">Borrowed</TableHead>
          <TableHead className="text-right">Utilization</TableHead>
          <TableHead className="text-right">Borrow / supply APR</TableHead>
          <TableHead>Oracle price</TableHead>
          <TableHead className="text-right">Collateral cap</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lending.assets.map((asset) => {
          const check = pricedAsset(market.assets, asset.config.token_id, market.nowMs).price;
          const cap = u128OrZero(asset.config.collateral_cap);
          return (
            <TableRow key={asset.config.token_id}>
              <TableCell>
                <AssetLabel asset={asset} showCategory />
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  <Flag on={asset.config.can_collateralize} label="collateral" />
                  <Flag on={asset.config.can_borrow} label="borrow" />
                  {asset.config.paused ? <Pill tone="bad">paused</Pill> : null}
                </div>
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatBpsPercent(asset.config.ltv_bps, 0)} / {formatBpsPercent(asset.config.liquidation_threshold_bps, 0)} /{" "}
                {formatBpsPercent(asset.config.liquidation_bonus_bps, 0)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{amountOf(asset, asset.cash, 2)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{amountOf(asset, asset.total_borrowed, 2)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{formatBpsPercent(asset.utilization_bps)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatBpsPercent(asset.borrow_apr_bps)} / {formatBpsPercent(asset.supply_apr_bps)}
              </TableCell>
              <TableCell>
                <PriceTag asset={asset} check={check} />
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{cap === ZERO ? "none" : amountOf(asset, cap, 0)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function SwapAssets() {
  const memes = useJson<{ assets: CatalogAsset[] }>("/api/assets?category=meme&eligible=swap");
  const stocks = useJson<{ assets: CatalogAsset[] }>("/api/assets?category=stock&eligible=swap");
  if (memes.state === "loading" || stocks.state === "loading") return <SkeletonRows rows={4} />;
  if (memes.state === "error" || stocks.state === "error") {
    return <Note tone="bad">1Click catalog unavailable: {memes.state === "error" ? memes.error : stocks.state === "error" ? stocks.error : ""}</Note>;
  }
  const rows = [...stocks.data.assets, ...memes.data.assets];
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Asset</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Chain</TableHead>
          <TableHead className="text-right">1Click price</TableHead>
          <TableHead>Eligibility</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((asset) => (
          <TableRow key={asset.id}>
            <TableCell>
              <span className="font-medium">{asset.symbol}</span>
              {asset.name ? <span className="ml-1.5 text-[11px] text-muted-foreground">{asset.name}</span> : null}
            </TableCell>
            <TableCell className="text-xs">{asset.category === "stock" ? "Tokenized stock" : "Meme coin"}</TableCell>
            <TableCell className="font-mono text-xs">{asset.chain}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{usd(asset.priceUsd)}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                <Flag on={asset.eligibility.swap} label="swap" />
                <Flag on={asset.eligibility.collateral} label="collateral" />
                <Flag on={asset.eligibility.borrow} label="borrow" />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RheaReference() {
  const rhea = useJson<RheaLendingSnapshot>("/api/rhea/lending");
  if (rhea.state === "loading") return <SkeletonRows rows={4} />;
  if (rhea.state === "error") return <Note tone="bad">RHEA Lending could not be read: {rhea.error}</Note>;
  const reserves = rhea.data.reserves.filter((reserve) => reserve.canUseAsCollateral || reserve.canBorrow);
  return (
    <div className="flex flex-col gap-2">
      <Note tone="neutral">
        {rhea.data.reserves.length} reserves on <span className="font-mono">{rhea.data.contractId}</span>. None of them is a meme coin
        or a tokenized stock, which is why Radiri runs its own lending markets for those assets.
      </Note>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Asset</TableHead>
            <TableHead>Eligibility</TableHead>
            <TableHead className="text-right">Supplied</TableHead>
            <TableHead className="text-right">Borrowed</TableHead>
            <TableHead className="text-right">Utilization</TableHead>
            <TableHead className="text-right">Borrow APY (derived)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reserves.map((reserve) => (
            <TableRow key={reserve.tokenId}>
              <TableCell>
                <span className="font-medium">{reserve.symbol}</span>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  <Flag on={reserve.canUseAsCollateral} label="collateral" />
                  <Flag on={reserve.canBorrow} label="borrow" />
                </div>
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{reserve.suppliedUsd === null ? (reserve.supplied ?? "–") : usd(reserve.suppliedUsd)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{reserve.borrowedUsd === null ? (reserve.borrowed ?? "–") : usd(reserve.borrowedUsd)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{(reserve.utilization * 100).toFixed(2)}%</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{(reserve.borrowApyDerived * 100).toFixed(2)}%</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function MarketsView() {
  const lending = useLending();
  return (
    <>
      <PageHeader
        title="Markets"
        description="Radiri lending markets for meme coins and tokenized stocks, the assets 1Click can swap, and RHEA Lending as a reference."
      />
      <ModeBanner />
      <div className="mb-3">
        <MarketNotice />
      </div>
      <div className="flex flex-col gap-3">
        <Section
          title="Radiri lending markets"
          description={
            lending.mode === "near"
              ? `Read from ${lending.contractId} on NEAR ${NETWORK}. Each asset's collateral and borrow eligibility is set on chain.`
              : "Simulated pools seeded locally, with the same risk parameters the contract is deployed with. Test tokens have no value."
          }
        >
          <RadiriMarkets />
        </Section>

        <Section
          title="Tokenized stocks and meme coins on 1Click"
          description="Live NEAR Intents catalog. Swap eligibility comes from 1Click; collateral and borrow eligibility only from the lending contract."
        >
          <SwapAssets />
        </Section>

        <Section title="RHEA Lending · NEAR mainnet · reference" description="Live reserves read from the RHEA Lending contract, read-only.">
          <RheaReference />
        </Section>
      </div>
    </>
  );
}
