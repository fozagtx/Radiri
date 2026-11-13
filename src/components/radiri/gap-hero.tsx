import { ArrowRight, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { CompareResponse, RouteFailure, RouteQuote } from "@/lib/radiri/types";
import { cn } from "@/lib/utils";
import { ErrorNote, SourceBadge } from "./bits";
import {
  INTENTS_URL,
  SOURCE_LABEL,
  formatBps,
  formatEta,
  formatPerTenThousand,
  formatToken,
  perTenThousand,
} from "./format";

const FAILURE_RANK: Record<RouteFailure["kind"], number> = {
  "no-liquidity": 0,
  error: 1,
  unsupported: 2,
};

function pickGap(compare: CompareResponse): RouteFailure | null {
  const { routes, failures } = compare;
  const uncovered = failures.filter((failure) => !routes.some((route) => route.source === failure.source));
  const pool = uncovered.length > 0 ? uncovered : failures;
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => FAILURE_RANK[a.kind] - FAILURE_RANK[b.kind])[0];
}

function pairText(compare: CompareResponse): string {
  const { from, to } = compare.request;
  return `${formatToken(compare.request.amount)} ${from.symbol} on ${from.chain} to ${to.symbol} on ${to.chain}`;
}

function headline(compare: CompareResponse | null, gap: RouteFailure | null, best: RouteQuote | null): string {
  if (!compare) return "Quoting every route for this pair.";
  if (gap && best) {
    const normalized = formatPerTenThousand(perTenThousand(best.amountOut, best.amountIn));
    return `${SOURCE_LABEL[gap.source]} returns "${gap.reason}". ${SOURCE_LABEL[best.source]} fills the same ${pairText(compare)} at ${normalized} ${best.to.symbol} per 10,000.`;
  }
  if (best) {
    const normalized = formatPerTenThousand(perTenThousand(best.amountOut, best.amountIn));
    return `${SOURCE_LABEL[best.source]} is the only source quoting ${pairText(compare)}, at ${normalized} ${best.to.symbol} per 10,000.`;
  }
  if (gap) {
    return `No source can fill ${pairText(compare)}. ${SOURCE_LABEL[gap.source]} says "${gap.reason}".`;
  }
  return `No route or failure was returned for ${pairText(compare)}.`;
}

export function GapHero({
  compare,
  loading,
  error,
}: {
  compare: CompareResponse | null;
  loading: boolean;
  error: string | null;
}) {
  const gap = compare ? pickGap(compare) : null;
  const best = compare?.best ?? null;
  const routes = compare?.routes ?? [];
  const failures = compare?.failures ?? [];
  const pair = compare ? pairText(compare) : "";

  return (
    <section className="flex flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
            Same pair, two sources
          </span>
          <h2 className="text-base leading-snug font-semibold text-balance">
            {loading && !compare ? <Skeleton className="h-5 w-96 max-w-full" /> : headline(compare, gap, best)}
          </h2>
        </div>
        <a
          href={INTENTS_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline underline-offset-3 hover:text-foreground"
        >
          Execute on intents.near.org
          <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {loading && !compare ? (
        <div className="grid gap-2 md:grid-cols-2">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          <div
            className={cn(
              "flex flex-col gap-2 rounded-lg border p-3",
              gap
                ? "border-destructive/30 bg-destructive/5"
                : "border-border bg-muted/40",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {gap ? <SourceBadge source={gap.source} /> : null}
                <span className="text-xs text-muted-foreground">{gap ? "no route" : "liquidity gap"}</span>
              </div>
              {gap ? <span className="font-mono text-[0.7rem] text-muted-foreground">{gap.kind}</span> : null}
            </div>
            {gap ? (
              <>
                <p className="font-mono text-xl leading-tight font-semibold break-words text-destructive">
                  {gap.reason}
                </p>
                <p className="text-xs text-muted-foreground">
                  Verbatim from {SOURCE_LABEL[gap.source]} for {pair}.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">
                  {failures.length === 0 ? "No gaps for this pair" : "No full gap for this pair"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {failures.length === 0
                    ? "Every source returned a route at this size."
                    : "Every source that failed still returned another route."}
                </p>
              </>
            )}
          </div>

          <div
            className={cn(
              "flex flex-col gap-2 rounded-lg border p-3",
              best
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-destructive/30 bg-destructive/5",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              {best ? (
                <SourceBadge source={best.source} />
              ) : (
                <span className="text-xs text-muted-foreground">Fill</span>
              )}
              <span className="text-xs text-muted-foreground">{best ? "fills this" : "nothing fills this"}</span>
            </div>
            {best ? (
              <>
                <p className="font-mono text-xl leading-tight font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                  {formatToken(best.amountOut)} {best.to.symbol}
                </p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted-foreground">
                  <span>
                    {formatPerTenThousand(perTenThousand(best.amountOut, best.amountIn))} per 10,000
                  </span>
                  <span aria-hidden>|</span>
                  <span>{formatBps(best.costBps)}</span>
                  <span aria-hidden>|</span>
                  <span>{formatEta(best.etaSeconds)}</span>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-destructive">
                  No source returned a usable quote
                </p>
                <p className="text-xs text-muted-foreground">
                  {failures.length === 0
                    ? "The engine returned an empty result."
                    : `${failures.length} failure${failures.length === 1 ? "" : "s"} returned, ${routes.length} route${routes.length === 1 ? "" : "s"} quoted.`}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {loading && compare ? (
        <p className="flex items-center gap-1 text-[0.7rem] text-muted-foreground">
          Requoting
          <ArrowRight className="size-3" aria-hidden />
          showing the previous result
        </p>
      ) : null}
    </section>
  );
}
