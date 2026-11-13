import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { OnchainSnapshot, Opportunity, RouteSource } from "@/lib/radiri/types";
import { cn } from "@/lib/utils";
import { SOURCE_KIND, SOURCE_LABEL } from "./format";

export type Tone = "neutral" | "good" | "warn" | "bad";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-foreground",
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-destructive",
};

const SOURCE_DOT: Record<RouteSource, string> = {
  "near-intents": "bg-sky-500",
  rhea: "bg-violet-500",
};

export function toneText(tone: Tone): string {
  return TONE_TEXT[tone];
}

export function SourceBadge({
  source,
  className,
}: {
  source: RouteSource;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-medium", className)}>
      <span className={cn("size-1.5 rounded-full", SOURCE_DOT[source])} aria-hidden />
      {SOURCE_LABEL[source]}
    </Badge>
  );
}

export function SourceCaption({ source }: { source: RouteSource }) {
  return <span className="text-xs text-muted-foreground">{SOURCE_KIND[source]}</span>;
}

export function Stat({
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
    <div className={cn("flex flex-col gap-0.5", className)}>
      <dt className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className={cn("font-mono text-sm tabular-nums", TONE_TEXT[tone])}>{value}</dd>
      {hint ? <span className="text-[0.7rem] text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

const SNAPSHOT_STATUS: Record<
  OnchainSnapshot["status"],
  { label: string; tone: Tone; icon: typeof CheckCircle2 }
> = {
  ok: { label: "ok", tone: "good", icon: CheckCircle2 },
  no_liquidity: { label: "no liquidity", tone: "warn", icon: CircleDashed },
  error: { label: "error", tone: "bad", icon: XCircle },
};

export function SnapshotStatus({ status }: { status: OnchainSnapshot["status"] }) {
  const meta = SNAPSHOT_STATUS[status] ?? { label: String(status), tone: "neutral" as Tone, icon: CircleDashed };
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", TONE_TEXT[meta.tone])}>
      <Icon className="size-3" aria-hidden />
      {meta.label}
    </span>
  );
}

const SEVERITY: Record<Opportunity["severity"], { tone: Tone; label: string }> = {
  info: { tone: "neutral", label: "info" },
  warn: { tone: "warn", label: "warn" },
  high: { tone: "bad", label: "high" },
};

export function SeverityTag({ severity }: { severity: Opportunity["severity"] }) {
  const meta = SEVERITY[severity] ?? SEVERITY.info;
  return (
    <Badge
      variant={meta.tone === "bad" ? "destructive" : "outline"}
      className={cn("uppercase", meta.tone === "warn" && "border-amber-500/40 text-amber-600 dark:text-amber-400")}
    >
      {meta.label}
    </Badge>
  );
}

export function OpportunityIcon({ severity }: { severity: Opportunity["severity"] }) {
  if (severity === "info") return <CircleDashed className="size-3.5 text-muted-foreground" aria-hidden />;
  return <AlertTriangle className={cn("size-3.5", TONE_TEXT[severity === "high" ? "bad" : "warn"])} aria-hidden />;
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs break-words text-destructive whitespace-pre-wrap">
      {children}
    </div>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}
