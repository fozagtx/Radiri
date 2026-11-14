"use client";

import Link from "next/link";
import { ArrowRight, Wallet } from "lucide-react";
import { ActivityList } from "@/components/activity/activity-list";
import { useActivityItems } from "@/components/activity/use-activity";
import { TokenAvatar, TokenPair } from "@/components/app/token-avatar";
import { MarketNotice, usePortfolioTotals } from "@/components/shared/account-summary";
import { Section, SkeletonRows } from "@/components/shared/bits";
import { amountOf, bandTone, TONE_TEXT } from "@/components/shared/format";
import { useLending } from "@/components/shared/lending-provider";
import { ModeBanner } from "@/components/shared/mode-banner";
import { formatHealthFactor, formatUsdWad, HEALTH_BAND_LABEL, healthBand, WAD } from "@/lib/risk";
import { cn } from "@/lib/utils";
import { useNearWallet } from "@/lib/wallets/near";

const JOURNEYS = [
  { href: "/borrow#stocks", from: { symbol: "PEPE" }, to: { symbol: "AAPL", category: "stock" }, title: "Borrow stocks with meme coins", body: "Lock PEPE, borrow tokenized Apple." },
  { href: "/borrow#memes", from: { symbol: "NVDA", category: "stock" }, to: { symbol: "PEPE" }, title: "Borrow meme coins with stocks", body: "Lock tokenized NVIDIA, borrow PEPE." },
  { href: "/swap", from: { symbol: "PEPE" }, to: { symbol: "TSLA", category: "stock" }, title: "Swap across chains", body: "PEPE on Ethereum to Tesla on BNB Chain." },
];

/** Semicircle gauge: health factor 1.0 (left, liquidation) to 3.0+ (right). */
function HealthGauge({ value }: { value: bigint | null }) {
  const band = healthBand(value);
  const hf = value === null ? 3 : Math.min(3, Number(value * BigInt(100) / WAD) / 100);
  const share = value === null ? 1 : Math.max(0, Math.min(1, (hf - 1) / 2));
  const arc = 125.66; // half circumference for r = 40
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 100 56" className="w-40" role="img" aria-label={`Health factor ${formatHealthFactor(value)}`}>
        <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="8" strokeLinecap="round" />
        <path
          d="M10 50 A40 40 0 0 1 90 50"
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={arc}
          strokeDashoffset={arc * (1 - share)}
          className={cn("transition-[stroke-dashoffset] duration-700", TONE_TEXT[bandTone(band)])}
        />
      </svg>
      <span className={cn("-mt-7 font-mono text-[26px] tabular-nums", TONE_TEXT[bandTone(band)])}>{formatHealthFactor(value)}</span>
      <span className="mt-1 text-[11.5px] text-muted-foreground">Health factor · {HEALTH_BAND_LABEL[band]}</span>
    </div>
  );
}

function Hero() {
  const lending = useLending();
  const wallet = useNearWallet();
  const totals = usePortfolioTotals();

  if (!lending.walletAccountId) {
    return (
      <div className="radiri-rise relative overflow-hidden rounded-[28px] border border-foreground/10 bg-card px-6 py-8 sm:px-10">
        <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-[radial-gradient(circle,rgba(79,152,67,0.18),transparent_65%)]" aria-hidden />
        <div className="pointer-events-none absolute -bottom-28 left-10 size-72 rounded-full bg-[radial-gradient(circle,rgba(204,0,0,0.12),transparent_65%)]" aria-hidden />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-md">
            <h1 className="font-display text-[34px] leading-[1.05] sm:text-[44px]">Your meme coins, working as collateral.</h1>
            <p className="mt-2 text-[14px] text-muted-foreground">Connect a NEAR testnet wallet to see your positions, mint test tokens and borrow.</p>
            <button
              type="button"
              onClick={() => void wallet.signIn()}
              disabled={!wallet.ready || wallet.connecting}
              className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background transition-colors hover:bg-foreground/85 disabled:opacity-50"
            >
              <Wallet className="size-4" aria-hidden />
              Connect NEAR wallet
            </button>
          </div>
          <div className="flex items-center gap-3 sm:flex-col">
            <TokenPair from={{ symbol: "PEPE" }} to={{ symbol: "AAPL", category: "stock" }} size="xl" />
            <TokenPair from={{ symbol: "SHIB" }} to={{ symbol: "NVDA", category: "stock" }} size="xl" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="radiri-rise grid gap-3 rounded-[28px] border border-foreground/10 bg-card p-6 sm:grid-cols-[1fr_auto] sm:p-8">
      <div className="flex flex-col gap-5">
        <div>
          <span className="text-[12.5px] text-muted-foreground">Net position</span>
          <div className="font-display text-[44px] leading-none tabular-nums sm:text-[56px]">{totals ? formatUsdWad(totals.netWad) : "–"}</div>
          <span className="mt-1 block font-mono text-[11.5px] text-muted-foreground">{lending.walletAccountId}</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {[
            ["Collateral", totals ? formatUsdWad(totals.collateralWad, { compact: true }) : "–"],
            ["Borrowed", totals ? formatUsdWad(totals.debtWad, { compact: true }) : "–"],
            ["Can still borrow", totals ? formatUsdWad(totals.availableWad, { compact: true }) : "–"],
            ["Positions", totals ? String(totals.positions) : "–"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11.5px] text-muted-foreground">{label}</dt>
              <dd className="font-mono text-[18px] tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <div>
          <div className="mb-1 flex justify-between text-[11.5px] text-muted-foreground">
            <span>Borrow limit used</span>
            <span className="font-mono">{totals?.limitUsedBps === null || !totals ? "0%" : `${(totals.limitUsedBps / 100).toFixed(1)}%`}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-foreground/8">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-700",
                (totals?.limitUsedBps ?? 0) >= 9000 ? "bg-destructive" : (totals?.limitUsedBps ?? 0) >= 7000 ? "bg-amber-500" : "bg-emerald-600",
              )}
              style={{ width: `${Math.min(100, (totals?.limitUsedBps ?? 0) / 100)}%` }}
            />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center sm:border-l sm:border-foreground/8 sm:pl-8">
        <HealthGauge value={totals?.healthFactorWad ?? null} />
      </div>
    </div>
  );
}

function Positions() {
  const lending = useLending();
  const risk = lending.risk;
  if (lending.accountState === "loading" && !lending.account) return <SkeletonRows rows={3} />;
  if (!risk || (risk.collateral.length === 0 && risk.debt.length === 0)) {
    return <p className="py-3 text-[13px] text-muted-foreground">No open positions yet. Start on the Borrow page.</p>;
  }
  const rows = [...risk.collateral.map((line) => ({ kind: "Collateral", ...line })), ...risk.debt.map((line) => ({ kind: "Borrowed", ...line }))];
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((row) => {
        const asset = lending.assetIndex.get(row.tokenId);
        return (
          <li key={`${row.kind}-${row.tokenId}`} className="flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-foreground/4">
            <TokenAvatar symbol={asset?.config.symbol ?? "?"} category={asset?.config.category} size="md" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[14px] font-semibold">{asset?.config.symbol ?? row.tokenId}</span>
              <span className={cn("text-[11.5px]", row.kind === "Borrowed" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{row.kind}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="font-mono text-[13.5px] tabular-nums">{asset ? amountOf(asset, row.amount, 4) : row.amount.toString()}</span>
              <span className="font-mono text-[11.5px] text-muted-foreground tabular-nums">{formatUsdWad(row.valueWad)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function OverviewView() {
  const items = useActivityItems();
  return (
    <div className="flex flex-col gap-4">
      <ModeBanner />
      <MarketNotice />
      <Hero />

      <div className="grid gap-3 md:grid-cols-3">
        {JOURNEYS.map((journey, index) => (
          <Link
            key={journey.href}
            href={journey.href}
            className="radiri-rise group flex flex-col gap-3 rounded-[24px] border border-foreground/10 bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-[0_20px_50px_-30px_rgba(25,25,25,0.5)]"
            style={{ animationDelay: `${80 + index * 60}ms` }}
          >
            <span className="flex items-center justify-between">
              <TokenPair from={journey.from} to={journey.to} size="lg" />
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" aria-hidden />
            </span>
            <span>
              <span className="block text-[15px] font-semibold tracking-tight">{journey.title}</span>
              <span className="block text-[12.5px] text-muted-foreground">{journey.body}</span>
            </span>
          </Link>
        ))}
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <Section title="Active positions" action={<Link href="/portfolio" className="text-xs text-muted-foreground hover:text-foreground">Portfolio →</Link>}>
          <Positions />
        </Section>
        <Section title="Recent activity" action={<Link href="/activity" className="text-xs text-muted-foreground hover:text-foreground">All activity →</Link>}>
          <ActivityList items={items.slice(0, 6)} empty="No activity yet." />
        </Section>
      </div>
    </div>
  );
}
