"use client";

import { useState } from "react";
import { ActionForm } from "@/components/shared/action-form";
import { AccountNotice, MarketNotice, SummaryTiles, usePortfolioTotals } from "@/components/shared/account-summary";
import { AssetLabel, PageHeader, PriceTag, Section, SkeletonRows } from "@/components/shared/bits";
import { amountOf, CATEGORY_LABEL } from "@/components/shared/format";
import { useLending } from "@/components/shared/lending-provider";
import { ModeBanner } from "@/components/shared/mode-banner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBpsPercent, formatPriceWad, formatUsdWad, liquidationPriceWad, type LendingActionKind, ZERO } from "@/lib/risk";
import { cn } from "@/lib/utils";

type Selection = { kind: LendingActionKind; tokenId: string } | null;

const BAR_FILLS = ["bg-foreground", "bg-foreground/70", "bg-foreground/50", "bg-foreground/35", "bg-foreground/22", "bg-foreground/12"];

function ActionButton({ label, onClick, active }: { label: string; onClick: () => void; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-[11.5px] transition-colors",
        active ? "border-foreground bg-foreground text-background" : "border-foreground/15 text-foreground/75 hover:border-foreground/35",
      )}
    >
      {label}
    </button>
  );
}

/** Share of collateral value per asset: one stacked bar plus a legend with the exact figures. */
function Allocation() {
  const { risk, assetIndex } = useLending();
  const lines = (risk?.collateral ?? []).filter((line) => line.valueWad > ZERO).sort((a, b) => (b.valueWad > a.valueWad ? 1 : -1));
  const total = lines.reduce((sum, line) => sum + line.valueWad, ZERO);
  if (total === ZERO) return <p className="py-2 text-xs text-muted-foreground">No priced collateral yet.</p>;
  const share = (value: bigint) => Number((value * BigInt(10_000)) / total) / 100;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-foreground/8" role="img" aria-label="Collateral allocation by asset">
        {lines.map((line, index) => (
          <div
            key={line.tokenId}
            className={cn("h-full", BAR_FILLS[index % BAR_FILLS.length], index > 0 && "border-l-2 border-card")}
            style={{ width: `${share(line.valueWad)}%` }}
          />
        ))}
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {lines.map((line, index) => {
          const asset = assetIndex.get(line.tokenId);
          return (
            <li key={line.tokenId} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-2">
                <span className={cn("size-2.5 rounded-sm", BAR_FILLS[index % BAR_FILLS.length])} aria-hidden />
                {asset?.config.symbol ?? line.tokenId}
                {asset ? <span className="text-muted-foreground">{CATEGORY_LABEL[asset.config.category]}</span> : null}
              </span>
              <span className="font-mono tabular-nums">
                {share(line.valueWad).toFixed(2)}% · {formatUsdWad(line.valueWad, { compact: true })}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function PortfolioView() {
  const lending = useLending();
  const totals = usePortfolioTotals();
  const [selection, setSelection] = useState<Selection>(null);
  const risk = lending.risk;
  const market = lending.market;
  const loading = lending.accountState === "loading" && !lending.account;

  const select = (kind: LendingActionKind, tokenId: string) =>
    setSelection((current) => (current?.kind === kind && current.tokenId === tokenId ? null : { kind, tokenId }));
  const isSelected = (kind: LendingActionKind, tokenId: string) => selection?.kind === kind && selection.tokenId === tokenId;
  const supplied = Object.entries(lending.holdings.supplied).filter(([, amount]) => amount > ZERO);

  return (
    <>
      <PageHeader
        title="Portfolio"
        description="Deposited collateral, borrowed assets and outstanding debt including accrued interest, with the health of the position."
      />
      <ModeBanner />
      <div className="mb-3 flex flex-col gap-2">
        <MarketNotice />
        <AccountNotice />
      </div>

      <div className="flex flex-col gap-3">
        <SummaryTiles totals={totals} />

        {selection ? (
          <Section
            title={`${selection.kind === "repay" ? "Repay" : selection.kind === "deposit_collateral" ? "Add collateral" : selection.kind === "withdraw_supply" ? "Withdraw supply" : "Withdraw collateral"} · ${lending.assetIndex.get(selection.tokenId)?.config.symbol ?? ""}`}
            action={<ActionButton label="Close" active={false} onClick={() => setSelection(null)} />}
          >
            <ActionForm key={`${selection.kind}-${selection.tokenId}`} kind={selection.kind} tokenId={selection.tokenId} onDone={() => setSelection(null)} />
          </Section>
        ) : null}

        <Section title="Collateral" description="Locked on the lending contract until the debt it backs allows a withdrawal.">
          {loading ? (
            <SkeletonRows rows={2} />
          ) : !risk || risk.collateral.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">No collateral deposited.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Oracle price</TableHead>
                  <TableHead className="text-right">LTV / liq.</TableHead>
                  <TableHead className="text-right">Liquidation price</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {risk.collateral.map((line) => {
                  const asset = lending.assetIndex.get(line.tokenId);
                  const liqPrice = market ? liquidationPriceWad(market.assets, lending.holdings, line.tokenId, market.nowMs) : null;
                  return (
                    <TableRow key={line.tokenId}>
                      <TableCell>{asset ? <AssetLabel asset={asset} showCategory /> : line.tokenId}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{asset ? amountOf(asset, line.amount, 4) : "–"}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatUsdWad(line.valueWad)}</TableCell>
                      <TableCell>{asset ? <PriceTag asset={asset} check={line.price} /> : "–"}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {asset ? `${formatBpsPercent(asset.config.ltv_bps, 0)} / ${formatBpsPercent(asset.config.liquidation_threshold_bps, 0)}` : "–"}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{liqPrice === null ? "–" : formatPriceWad(liqPrice)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <ActionButton label="Add" active={isSelected("deposit_collateral", line.tokenId)} onClick={() => select("deposit_collateral", line.tokenId)} />
                          <ActionButton label="Withdraw" active={isSelected("withdraw_collateral", line.tokenId)} onClick={() => select("withdraw_collateral", line.tokenId)} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Section>

        <Section title="Borrowed" description="Outstanding debt grows with the borrow index; amounts include interest accrued so far.">
          {loading ? (
            <SkeletonRows rows={2} />
          ) : !risk || risk.debt.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">No outstanding debt.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead className="text-right">Owed</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Oracle price</TableHead>
                  <TableHead className="text-right">Borrow APR</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {risk.debt.map((line) => {
                  const asset = lending.assetIndex.get(line.tokenId);
                  return (
                    <TableRow key={line.tokenId}>
                      <TableCell>{asset ? <AssetLabel asset={asset} showCategory /> : line.tokenId}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{asset ? amountOf(asset, line.amount, 6) : "–"}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatUsdWad(line.valueWad)}</TableCell>
                      <TableCell>{asset ? <PriceTag asset={asset} check={line.price} /> : "–"}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{asset ? formatBpsPercent(asset.borrow_apr_bps) : "–"}</TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <ActionButton label="Repay" active={isSelected("repay", line.tokenId)} onClick={() => select("repay", line.tokenId)} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Section>

        {supplied.length > 0 ? (
          <Section title="Supplied liquidity" description="Assets lent to the pool; they earn the supply APR.">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Supply APR</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {supplied.map(([tokenId, amount]) => {
                  const asset = lending.assetIndex.get(tokenId);
                  return (
                    <TableRow key={tokenId}>
                      <TableCell>{asset ? <AssetLabel asset={asset} showCategory /> : tokenId}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{asset ? amountOf(asset, amount, 4) : amount.toString()}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{asset ? formatBpsPercent(asset.supply_apr_bps) : "–"}</TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <ActionButton label="Withdraw" active={isSelected("withdraw_supply", tokenId)} onClick={() => select("withdraw_supply", tokenId)} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Section>
        ) : null}

        <Section title="Asset allocation" description="Share of collateral value by asset at current oracle prices.">
          <Allocation />
        </Section>
      </div>
    </>
  );
}
