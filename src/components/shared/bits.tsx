import { AlertTriangle, CheckCircle2, CircleSlash, FlaskConical, Info, Link2, ShieldAlert, XCircle } from "lucide-react";
import { TokenAvatar } from "@/components/app/token-avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EXPLORER_URL } from "@/lib/config";
import {
  type BlockReason,
  formatAge,
  formatHealthFactor,
  formatPriceWad,
  HEALTH_BAND_LABEL,
  healthBand,
  type PriceCheck,
} from "@/lib/risk";
import { cn } from "@/lib/utils";
import type { AssetView } from "@/types/protocol";
import { bandTone, CATEGORY_LABEL, referenceOf, TONE_FILL, TONE_PILL, TONE_TEXT, type Tone } from "./format";

export function PageHeader({ title, description, action }: { title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-[28px] leading-tight sm:text-[32px]">{title}</h1>
        {description ? <p className="mt-0.5 max-w-[68ch] text-xs text-muted-foreground sm:text-[13px]">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Section({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
  id,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  id?: string;
}) {
  return (
    <Card size="sm" id={id} className={cn("scroll-mt-20 gap-3", className)}>
      <CardHeader className="grid-cols-[1fr_auto] items-start gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <CardTitle className="text-[13.5px] font-semibold tracking-tight">{title}</CardTitle>
          {description ? <CardDescription className="text-xs">{description}</CardDescription> : null}
        </div>
        {action ? <div className="justify-self-end">{action}</div> : null}
      </CardHeader>
      <CardContent className={cn("min-w-0", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

export function Pill({ tone = "neutral", children, className, title }: { tone?: Tone; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9.5px] tracking-[0.08em] whitespace-nowrap uppercase",
        TONE_PILL[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Stat tile: sentence-case label, mono value, optional hint. */
export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-xl bg-card px-3 py-2.5 ring-1 ring-foreground/10", className)}>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("truncate font-mono text-lg tabular-nums sm:text-xl", TONE_TEXT[tone])}>{value}</dd>
      {hint ? <span className="truncate text-[11px] text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

const BAND_ICON = {
  none: CheckCircle2,
  safe: CheckCircle2,
  warn: AlertTriangle,
  danger: ShieldAlert,
  liquidatable: XCircle,
} as const;

/** Health factor value with its band: icon + label, never color alone. */
export function HealthValue({ value, size = "md" }: { value: bigint | null; size?: "md" | "lg" }) {
  const band = healthBand(value);
  const tone = bandTone(band);
  const Icon = BAND_ICON[band];
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className={cn("font-mono tabular-nums", size === "lg" ? "text-2xl" : "text-sm", TONE_TEXT[tone])}>
        {formatHealthFactor(value)}
      </span>
      <span className={cn("inline-flex items-center gap-1 text-[11px]", TONE_TEXT[tone])}>
        <Icon className="size-3 translate-y-px" aria-hidden />
        {HEALTH_BAND_LABEL[band]}
      </span>
    </span>
  );
}

/**
 * Meter: share of the borrow limit in use. Fill carries severity (status color, with the
 * percentage printed beside it); the track is a light step of the ink.
 */
export function LimitMeter({ usedBps, label = "Borrow limit used" }: { usedBps: number | null; label?: string }) {
  const pct = usedBps === null ? 0 : Math.min(100, Math.max(0, usedBps / 100));
  const tone: Tone = usedBps === null ? "neutral" : usedBps >= 9_000 ? "bad" : usedBps >= 7_000 ? "warn" : "good";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-foreground">{usedBps === null ? "0.00%" : `${(usedBps / 100).toFixed(2)}%`}</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-foreground/8"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Number(pct.toFixed(2))}
      >
        <div className={cn("h-full rounded-full transition-[width]", TONE_FILL[tone])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function TestTokenTag() {
  return (
    <Pill tone="warn" title="Testnet test token: no value">
      <FlaskConical className="size-2.5" aria-hidden />
      test token
    </Pill>
  );
}

export function AssetLabel({ asset, showCategory = false, compact = false }: { asset: AssetView; showCategory?: boolean; compact?: boolean }) {
  const reference = referenceOf(asset.config.token_id);
  return (
    <span className="inline-flex min-w-0 items-center gap-2.5">
      <TokenAvatar symbol={asset.config.symbol} category={asset.config.category} size={compact ? "sm" : "md"} />
      <span className="inline-flex min-w-0 flex-col">
        <span className="inline-flex items-center gap-1.5">
          <span className="font-medium">{asset.config.symbol}</span>
          {!compact ? <TestTokenTag /> : null}
        </span>
        {!compact ? (
          <span className="text-[11px] text-muted-foreground">
            {showCategory ? `${CATEGORY_LABEL[asset.config.category]} · ` : ""}
            {reference ? `mirrors ${reference.symbol}` : ""}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export function PriceTag({ asset, check }: { asset: AssetView; check: PriceCheck }) {
  const price = asset.price ? BigInt(asset.price.price_wad) : null;
  const tone: Tone = check.fresh ? "good" : "bad";
  const label = check.fresh ? "fresh" : check.status === "stale" ? "stale" : "no price";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="font-mono tabular-nums">{formatPriceWad(price)}</span>
      <span className="font-mono text-[11px] text-muted-foreground">{formatAge(check.ageMs)}</span>
      <Pill tone={tone}>{label}</Pill>
    </span>
  );
}

export function ReasonList({ reasons }: { reasons: BlockReason[] }) {
  if (reasons.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 rounded-lg border border-destructive/25 bg-destructive/5 px-2.5 py-2 text-xs text-destructive" aria-live="polite">
      {reasons.map((reason, index) => (
        <li key={`${reason.code}-${reason.tokenId ?? ""}-${index}`} className="flex items-start gap-1.5">
          <CircleSlash className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>{reason.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function Note({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  const Icon = tone === "bad" ? XCircle : tone === "warn" ? AlertTriangle : tone === "good" ? CheckCircle2 : Info;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs break-words",
        tone === "bad" && "border-destructive/30 bg-destructive/5 text-destructive",
        tone === "warn" && "border-amber-500/35 bg-amber-500/6 text-amber-800 dark:text-amber-300",
        tone === "good" && "border-emerald-600/30 bg-emerald-600/6 text-emerald-800 dark:text-emerald-300",
        tone === "neutral" && "border-foreground/10 bg-foreground/[0.03] text-muted-foreground",
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function TxLinks({ hashes, urls }: { hashes: string[]; urls: string[] }) {
  if (hashes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {hashes.map((hash, index) => (
        <li key={hash}>
          <a
            href={urls[index] ?? `${EXPLORER_URL}/txns/${hash}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[11px] underline underline-offset-2"
          >
            <Link2 className="size-3" aria-hidden />
            {hash.length > 22 ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : hash}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-8 animate-pulse rounded-lg bg-foreground/5" />
      ))}
    </div>
  );
}
