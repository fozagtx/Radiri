"use client";

import { ArrowRight } from "lucide-react";
import {
  type ActionPreview,
  BPS,
  formatBpsPercent,
  formatPriceWad,
  formatTokenAmount,
  formatUsdWad,
  type Holdings,
  liquidationPriceWad,
  type MarketContext,
  mulDivUp,
  pricedAsset,
  ZERO,
} from "@/lib/risk";
import type { AccountRisk } from "@/lib/risk";
import { HealthValue, LimitMeter, PriceTag } from "./bits";

function limitUsedBps(risk: AccountRisk): number | null {
  if (risk.borrowLimitWad === ZERO) return risk.debtValueWad > ZERO ? 10_000 : null;
  return Number(mulDivUp(risk.debtValueWad, BPS, risk.borrowLimitWad));
}

function Row({ label, before, after, changed }: { label: string; before: React.ReactNode; after: React.ReactNode; changed: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-1.5 text-xs sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-center justify-end gap-1.5 font-mono tabular-nums sm:justify-start">
        {changed ? (
          <>
            <span className="text-muted-foreground">{before}</span>
            <ArrowRight className="size-3 text-muted-foreground" aria-label="becomes" />
            <span>{after}</span>
          </>
        ) : (
          <span>{after}</span>
        )}
      </dd>
    </div>
  );
}

/**
 * Before / after review of an action: health factor, borrow capacity, debt, LTV, the liquidation
 * price of the collateral in focus, APR, and the oracle prices the action depends on.
 */
export function ReviewPanel({
  preview,
  market,
  holdingsBefore,
  focusCollateralId,
}: {
  preview: ActionPreview;
  market: MarketContext;
  holdingsBefore: Holdings;
  focusCollateralId?: string | null;
}) {
  const { before, after, request } = preview;
  const asset = market.assets.get(request.tokenId);
  const focusId = focusCollateralId ?? (request.kind === "deposit_collateral" || request.kind === "withdraw_collateral" ? request.tokenId : null);
  const focusAsset = focusId ? market.assets.get(focusId) : undefined;
  const liqBefore = focusId ? liquidationPriceWad(market.assets, holdingsBefore, focusId, market.nowMs) : null;
  const liqAfter = focusId ? liquidationPriceWad(market.assets, preview.holdingsAfter, focusId, market.nowMs) : null;
  const usedBefore = limitUsedBps(before);
  const usedAfter = limitUsedBps(after);

  const priceRows = [asset, focusAsset && focusAsset !== asset ? focusAsset : undefined].filter(
    (item): item is NonNullable<typeof item> => !!item,
  );

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-foreground/10 bg-background/60 p-3">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Review</span>
      <dl className="divide-y divide-foreground/6">
        <Row
          label="Health factor"
          before={<HealthValue value={before.healthFactorWad} />}
          after={<HealthValue value={after.healthFactorWad} />}
          changed={before.healthFactorWad !== after.healthFactorWad}
        />
        <Row
          label="Borrow capacity left"
          before={formatUsdWad(before.availableToBorrowWad)}
          after={formatUsdWad(after.availableToBorrowWad)}
          changed={before.availableToBorrowWad !== after.availableToBorrowWad}
        />
        <Row
          label="Borrow limit"
          before={formatUsdWad(before.borrowLimitWad)}
          after={formatUsdWad(after.borrowLimitWad)}
          changed={before.borrowLimitWad !== after.borrowLimitWad}
        />
        <Row
          label="Debt"
          before={formatUsdWad(before.debtValueWad)}
          after={formatUsdWad(after.debtValueWad)}
          changed={before.debtValueWad !== after.debtValueWad}
        />
        <Row
          label="Loan to value"
          before={formatBpsPercent(before.ltvBps)}
          after={formatBpsPercent(after.ltvBps)}
          changed={before.ltvBps !== after.ltvBps}
        />
        {focusAsset ? (
          <Row
            label={`${focusAsset.config.symbol} liquidation price`}
            before={liqBefore === null ? "none" : formatPriceWad(liqBefore)}
            after={liqAfter === null ? "none" : formatPriceWad(liqAfter)}
            changed={liqBefore !== liqAfter}
          />
        ) : null}
        {asset && (request.kind === "borrow" || request.kind === "repay") ? (
          <Row label={`${asset.config.symbol} borrow APR`} before="" after={formatBpsPercent(asset.borrow_apr_bps)} changed={false} />
        ) : null}
        {asset && (request.kind === "supply" || request.kind === "withdraw_supply") ? (
          <Row label={`${asset.config.symbol} supply APR`} before="" after={formatBpsPercent(asset.supply_apr_bps)} changed={false} />
        ) : null}
        {preview.refund > ZERO && asset ? (
          <Row
            label="Refunded excess"
            before=""
            after={`${formatTokenAmount(preview.refund, asset.config.decimals)} ${asset.config.symbol}`}
            changed={false}
          />
        ) : null}
      </dl>
      <LimitMeter usedBps={usedAfter ?? usedBefore} label="Borrow limit used after" />
      <div className="flex flex-col gap-1 pt-1">
        <span className="text-[11px] text-muted-foreground">Oracle prices (USD per whole token, age, freshness)</span>
        {priceRows.map((item) => (
          <div key={item.config.token_id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium">{item.config.symbol}</span>
            <PriceTag asset={item} check={pricedAsset(market.assets, item.config.token_id, market.nowMs).price} />
          </div>
        ))}
      </div>
    </div>
  );
}
