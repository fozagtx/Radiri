"use client";

import { useEffect, useState } from "react";
import { TokenPair } from "@/components/app/token-avatar";
import { ActionForm } from "@/components/shared/action-form";
import { AccountNotice, MarketNotice, usePortfolioTotals } from "@/components/shared/account-summary";
import { HealthValue, LimitMeter, PageHeader, PriceTag, Section, SkeletonRows, StatTile } from "@/components/shared/bits";
import { FaucetButton } from "@/components/shared/faucet-button";
import { amountOf, referenceOf } from "@/components/shared/format";
import { useLending } from "@/components/shared/lending-provider";
import { ModeBanner } from "@/components/shared/mode-banner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBpsPercent, formatUsdWad, pricedAsset, u128OrZero, ZERO } from "@/lib/risk";
import { cn } from "@/lib/utils";
import type { AssetView, LendingCategory } from "@/types/protocol";
import { AssetPicker, type PickerOption } from "./asset-picker";

type Direction = "stocks" | "memes";

const DIRECTIONS: Record<Direction, { label: string; collateral: LendingCategory; borrow: LendingCategory; blurb: string }> = {
  stocks: {
    label: "Borrow stocks with meme coins",
    collateral: "meme",
    borrow: "stock",
    blurb: "Lock meme coins as collateral and borrow tokenized stocks against them.",
  },
  memes: {
    label: "Borrow meme coins with stocks",
    collateral: "stock",
    borrow: "meme",
    blurb: "Lock tokenized stocks as collateral and borrow meme coins against them.",
  },
};

function firstEnabled(options: PickerOption[]): string | null {
  return options.find((option) => !option.disabledReason)?.asset.config.token_id ?? null;
}

function useChoice(options: PickerOption[]): [string | null, (id: string) => void] {
  const [choice, setChoice] = useState<string | null>(null);
  const valid = options.some((option) => option.asset.config.token_id === choice && !option.disabledReason);
  return [valid ? choice : firstEnabled(options), setChoice];
}

function ParamsLine({ asset }: { asset: AssetView }) {
  const lending = useLending();
  const check = lending.market ? pricedAsset(lending.market.assets, asset.config.token_id, lending.market.nowMs).price : null;
  const reference = referenceOf(asset.config.token_id);
  const cap = u128OrZero(asset.config.collateral_cap);
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl bg-foreground/[0.03] px-3 py-2.5 text-xs sm:grid-cols-3">
      <div>
        <dt className="text-muted-foreground">Max LTV</dt>
        <dd className="font-mono">{formatBpsPercent(asset.config.ltv_bps, 0)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Liquidation at</dt>
        <dd className="font-mono">{formatBpsPercent(asset.config.liquidation_threshold_bps, 0)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Liquidation bonus</dt>
        <dd className="font-mono">{formatBpsPercent(asset.config.liquidation_bonus_bps, 0)}</dd>
      </div>
      <div className="col-span-2 sm:col-span-2">
        <dt className="text-muted-foreground">
          Oracle price{reference ? ` (mirrors ${reference.symbol} · ${reference.source})` : ""}
        </dt>
        <dd>{check ? <PriceTag asset={asset} check={check} /> : "…"}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Collateral cap room</dt>
        <dd className="font-mono">
          {cap === ZERO ? "no cap" : amountOf(asset, cap > u128OrZero(asset.total_collateral) ? cap - u128OrZero(asset.total_collateral) : ZERO, 2)}
        </dd>
      </div>
    </dl>
  );
}

function BorrowParams({ asset }: { asset: AssetView }) {
  const lending = useLending();
  const check = lending.market ? pricedAsset(lending.market.assets, asset.config.token_id, lending.market.nowMs).price : null;
  const cap = u128OrZero(asset.config.borrow_cap);
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl bg-foreground/[0.03] px-3 py-2.5 text-xs sm:grid-cols-3">
      <div>
        <dt className="text-muted-foreground">Borrow APR</dt>
        <dd className="font-mono">{formatBpsPercent(asset.borrow_apr_bps)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Utilization</dt>
        <dd className="font-mono">{formatBpsPercent(asset.utilization_bps)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Pool cash</dt>
        <dd className="font-mono">{amountOf(asset, asset.cash, 4)}</dd>
      </div>
      <div className="col-span-2">
        <dt className="text-muted-foreground">Oracle price</dt>
        <dd>{check ? <PriceTag asset={asset} check={check} /> : "…"}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Borrow cap</dt>
        <dd className="font-mono">{cap === ZERO ? "no cap" : amountOf(asset, cap, 2)}</dd>
      </div>
    </dl>
  );
}

function Journey({ direction }: { direction: Direction }) {
  const lending = useLending();
  const totals = usePortfolioTotals();
  const spec = DIRECTIONS[direction];
  const [manage, setManage] = useState<"repay" | "withdraw">("repay");

  const collateralAssets = lending.assets.filter((asset) => asset.config.category === spec.collateral);
  const borrowAssets = lending.assets.filter((asset) => asset.config.category === spec.borrow);

  const collateralOptions: PickerOption[] = collateralAssets.map((asset) => {
    const id = asset.config.token_id;
    const balance = lending.balances[id]?.amount ?? null;
    const deposited = lending.holdings.collateral[id] ?? ZERO;
    return {
      asset,
      detail: deposited > ZERO ? `in: ${amountOf(asset, deposited, 2)}` : `wallet: ${balance === null ? "–" : amountOf(asset, balance, 2)}`,
      disabledReason: !asset.config.can_collateralize ? "not collateral" : asset.config.paused ? "paused" : null,
    };
  });
  const borrowOptions: PickerOption[] = borrowAssets.map((asset) => ({
    asset,
    detail: `APR ${formatBpsPercent(asset.borrow_apr_bps)}`,
    disabledReason: !asset.config.can_borrow
      ? "not borrowable"
      : asset.config.paused
        ? "paused"
        : u128OrZero(asset.cash) === ZERO
          ? "no liquidity"
          : null,
  }));
  const debtOptions: PickerOption[] = borrowAssets
    .filter((asset) => (lending.holdings.debt[asset.config.token_id] ?? ZERO) > ZERO)
    .map((asset) => ({ asset, detail: `owe ${amountOf(asset, lending.holdings.debt[asset.config.token_id] ?? ZERO, 4)}` }));
  const withdrawOptions: PickerOption[] = collateralAssets
    .filter((asset) => (lending.holdings.collateral[asset.config.token_id] ?? ZERO) > ZERO)
    .map((asset) => ({ asset, detail: `in ${amountOf(asset, lending.holdings.collateral[asset.config.token_id] ?? ZERO, 2)}` }));

  const [collateralId, setCollateralId] = useChoice(collateralOptions);
  const [borrowId, setBorrowId] = useChoice(borrowOptions);
  const [repayId, setRepayId] = useChoice(debtOptions);
  const [withdrawId, setWithdrawId] = useChoice(withdrawOptions);

  const collateral = collateralId ? lending.assetIndex.get(collateralId) : undefined;
  const borrow = borrowId ? lending.assetIndex.get(borrowId) : undefined;
  const ready = lending.marketsState === "ready" && !!lending.market;

  if (!ready) {
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="1 · Deposit collateral">
          <SkeletonRows rows={4} />
        </Section>
        <Section title="2 · Borrow">
          <SkeletonRows rows={4} />
        </Section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{spec.blurb}</p>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <Section
          title="1 · Deposit collateral"
          description={`${spec.collateral === "meme" ? "Meme coins" : "Tokenized stocks"} accepted as collateral on the lending contract.`}
        >
          <div className="flex flex-col gap-3">
            <AssetPicker label="Collateral asset" options={collateralOptions} value={collateralId} onChange={setCollateralId} />
            {collateral ? (
              <>
                <ParamsLine asset={collateral} />
                <FaucetButton asset={collateral} />
                <ActionForm key={`deposit-${collateral.config.token_id}`} kind="deposit_collateral" tokenId={collateral.config.token_id} />
              </>
            ) : null}
          </div>
        </Section>

        <div className="flex flex-col gap-3">
          <Section title="Borrowing capacity" description="Live from your collateral and oracle prices.">
            <div className="flex flex-col gap-3">
              <dl className="grid grid-cols-2 gap-2">
                <StatTile label="Available to borrow" value={totals ? formatUsdWad(totals.availableWad) : "–"} />
                <StatTile label="Health factor" value={totals ? <HealthValue value={totals.healthFactorWad} /> : "–"} />
                <StatTile label="Borrow limit" value={totals ? formatUsdWad(totals.borrowLimitWad) : "–"} />
                <StatTile label="Debt" value={totals ? formatUsdWad(totals.debtWad) : "–"} />
              </dl>
              <LimitMeter usedBps={totals?.limitUsedBps ?? null} />
            </div>
          </Section>

          <Section
            title="2 · Borrow"
            description={`${spec.borrow === "stock" ? "Tokenized stocks" : "Meme coins"} with borrowing enabled and pool liquidity.`}
          >
            <div className="flex flex-col gap-3">
              <AssetPicker label="Borrow asset" options={borrowOptions} value={borrowId} onChange={setBorrowId} />
              {borrow ? (
                <>
                  <BorrowParams asset={borrow} />
                  <ActionForm
                    key={`borrow-${borrow.config.token_id}-${collateralId ?? ""}`}
                    kind="borrow"
                    tokenId={borrow.config.token_id}
                    focusCollateralId={collateralId}
                  />
                </>
              ) : (
                <p className="text-xs text-muted-foreground">No borrowable asset with liquidity in this category right now.</p>
              )}
            </div>
          </Section>
        </div>
      </div>

      <Section
        title="3 · Manage this position"
        description="Repay what you borrowed, or take collateral back once the debt allows it."
        action={
          <div role="tablist" aria-label="Manage action" className="flex gap-1 rounded-full bg-foreground/5 p-0.5">
            {(["repay", "withdraw"] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                type="button"
                aria-selected={manage === tab}
                onClick={() => setManage(tab)}
                className={cn(
                  "rounded-full px-3 py-1 text-[12px] transition-colors",
                  manage === tab ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab === "repay" ? "Repay" : "Withdraw collateral"}
              </button>
            ))}
          </div>
        }
      >
        {manage === "repay" ? (
          debtOptions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No {spec.borrow === "stock" ? "stock" : "meme coin"} debt to repay.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              <AssetPicker label="Debt to repay" options={debtOptions} value={repayId} onChange={setRepayId} />
              {repayId ? (
                <ActionForm key={`repay-${repayId}`} kind="repay" tokenId={repayId} focusCollateralId={collateralId} />
              ) : null}
            </div>
          )
        ) : withdrawOptions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No {spec.collateral === "meme" ? "meme coin" : "stock"} collateral deposited.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <AssetPicker label="Collateral to withdraw" options={withdrawOptions} value={withdrawId} onChange={setWithdrawId} />
            {withdrawId ? <ActionForm key={`withdraw-${withdrawId}`} kind="withdraw_collateral" tokenId={withdrawId} /> : null}
          </div>
        )}
      </Section>
    </div>
  );
}

export function BorrowWorkspace() {
  const [direction, setDirection] = useState<Direction>("stocks");

  useEffect(() => {
    const fromHash = () => {
      if (window.location.hash === "#memes") setDirection("memes");
      else if (window.location.hash === "#stocks") setDirection("stocks");
    };
    const timer = setTimeout(fromHash, 0);
    window.addEventListener("hashchange", fromHash);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("hashchange", fromHash);
    };
  }, []);

  return (
    <>
      <PageHeader
        title="Borrow"
        description="Two separate markets on one lending contract: borrow tokenized stocks against meme coins, or meme coins against tokenized stocks. Every number below is checked by the same rules the contract enforces."
      />
      <ModeBanner />
      <div className="mb-3 flex flex-col gap-2">
        <MarketNotice />
        <AccountNotice />
      </div>

      <Tabs
        value={direction}
        onValueChange={(value) => {
          const next = value === "memes" ? "memes" : "stocks";
          setDirection(next);
          try {
            window.history.replaceState(null, "", `#${next}`);
          } catch {
            // ignore
          }
        }}
        className="gap-3"
      >
        <TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-[22px] bg-foreground/[0.04] p-1.5 group-data-horizontal/tabs:h-auto sm:grid-cols-2">
          <TabsTrigger value="stocks" className="h-auto justify-start gap-3 rounded-[18px] px-3 py-2.5 text-left text-[14px] data-active:shadow-md">
            <TokenPair from={{ symbol: "PEPE" }} to={{ symbol: "AAPL", category: "stock" }} size="md" />
            {DIRECTIONS.stocks.label}
          </TabsTrigger>
          <TabsTrigger value="memes" className="h-auto justify-start gap-3 rounded-[18px] px-3 py-2.5 text-left text-[14px] data-active:shadow-md">
            <TokenPair from={{ symbol: "NVDA", category: "stock" }} to={{ symbol: "PEPE" }} size="md" />
            {DIRECTIONS.memes.label}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="stocks">
          <Journey direction="stocks" />
        </TabsContent>
        <TabsContent value="memes">
          <Journey direction="memes" />
        </TabsContent>
      </Tabs>
    </>
  );
}
