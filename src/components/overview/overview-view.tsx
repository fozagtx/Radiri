"use client";

import Link from "next/link";
import { ArrowLeftRight, ArrowRight, HandCoins } from "lucide-react";
import { ActivityList } from "@/components/activity/activity-list";
import { useActivityItems } from "@/components/activity/use-activity";
import { AccountNotice, MarketNotice, SummaryTiles, usePortfolioTotals } from "@/components/shared/account-summary";
import { AssetLabel, PageHeader, Section, SkeletonRows } from "@/components/shared/bits";
import { amountOf } from "@/components/shared/format";
import { useLending } from "@/components/shared/lending-provider";
import { ModeBanner } from "@/components/shared/mode-banner";
import { formatUsdWad } from "@/lib/risk";

const JOURNEYS = [
  {
    href: "/borrow#stocks",
    icon: HandCoins,
    title: "Borrow stocks with meme coins",
    body: "Lock meme coins as collateral and borrow tokenized stocks without selling them.",
  },
  {
    href: "/borrow#memes",
    icon: HandCoins,
    title: "Borrow meme coins with stocks",
    body: "Lock tokenized stocks as collateral and borrow meme coins against them.",
  },
  {
    href: "/swap",
    icon: ArrowLeftRight,
    title: "Swap meme coins for stocks",
    body: "Cross-chain through NEAR Intents, e.g. PEPE on Ethereum to tokenized Apple on BNB Chain.",
  },
];

function Positions() {
  const lending = useLending();
  const risk = lending.risk;
  if (lending.accountState === "loading" && !lending.account) return <SkeletonRows rows={3} />;
  if (!risk || (risk.collateral.length === 0 && risk.debt.length === 0)) {
    return <p className="py-2 text-xs text-muted-foreground">No open positions. Start on the Borrow page.</p>;
  }
  const rows = [
    ...risk.collateral.map((line) => ({ kind: "Collateral", ...line })),
    ...risk.debt.map((line) => ({ kind: "Borrowed", ...line })),
  ];
  return (
    <ul className="divide-y divide-foreground/6">
      {rows.map((row) => {
        const asset = lending.assetIndex.get(row.tokenId);
        return (
          <li key={`${row.kind}-${row.tokenId}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <div className="flex min-w-0 items-center gap-3">
              <span className="w-20 shrink-0 text-[11px] text-muted-foreground">{row.kind}</span>
              {asset ? <AssetLabel asset={asset} compact /> : <span className="font-mono text-xs">{row.tokenId}</span>}
            </div>
            <div className="flex flex-col items-end">
              <span className="font-mono tabular-nums">{asset ? amountOf(asset, row.amount, 4) : row.amount.toString()}</span>
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{formatUsdWad(row.valueWad)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function OverviewView() {
  const totals = usePortfolioTotals();
  const items = useActivityItems();

  return (
    <>
      <PageHeader
        title="Overview"
        description="Your collateral, debt and borrowing capacity, valued with the same oracle prices the lending contract uses."
      />
      <ModeBanner />
      <div className="mb-3 flex flex-col gap-2">
        <MarketNotice />
        <AccountNotice />
      </div>

      <div className="flex flex-col gap-3">
        <SummaryTiles totals={totals} />

        <div className="grid gap-3 md:grid-cols-3">
          {JOURNEYS.map((journey) => (
            <Link
              key={journey.href}
              href={journey.href}
              className="group flex flex-col gap-1.5 rounded-xl bg-card px-3.5 py-3 ring-1 ring-foreground/10 transition-colors hover:ring-foreground/25"
            >
              <span className="flex items-center justify-between">
                <journey.icon className="size-4 text-foreground/70" aria-hidden />
                <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
              <span className="text-[13.5px] font-semibold tracking-tight">{journey.title}</span>
              <span className="text-xs text-muted-foreground">{journey.body}</span>
            </Link>
          ))}
        </div>

        <div className="grid items-start gap-3 lg:grid-cols-2">
          <Section
            title="Active positions"
            description={totals ? `${totals.positions} open` : undefined}
            action={
              <Link href="/portfolio" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                Portfolio
              </Link>
            }
          >
            <Positions />
          </Section>

          <Section
            title="Recent activity"
            action={
              <Link href="/activity" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                All activity
              </Link>
            }
          >
            <ActivityList items={items.slice(0, 6)} empty="No activity yet." />
          </Section>
        </div>
      </div>
    </>
  );
}
