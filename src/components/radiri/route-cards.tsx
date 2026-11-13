import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { RouteFailure, RouteQuote } from "@/lib/radiri/types";
import { cn } from "@/lib/utils";
import { EmptyNote, SourceBadge, SourceCaption, Stat } from "./bits";
import {
  INTENTS_URL,
  SOURCE_LABEL,
  formatBps,
  formatEta,
  formatIso,
  formatPerTenThousand,
  formatToken,
  perTenThousand,
} from "./format";

const FAILURE_LABEL: Record<RouteFailure["kind"], string> = {
  "no-liquidity": "no liquidity",
  unsupported: "unsupported",
  error: "error",
};

function costTone(costBps: number): "good" | "neutral" | "warn" | "bad" {
  if (costBps <= 0) return "good";
  if (costBps >= 75) return "bad";
  if (costBps >= 25) return "warn";
  return "neutral";
}

function RouteCard({ route, isBest }: { route: RouteQuote; isBest: boolean }) {
  return (
    <Card size="sm" className={cn("gap-2", isBest && "ring-2 ring-emerald-500/40")}>
      <CardHeader className="grid-cols-[1fr_auto] items-center gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <SourceBadge source={route.source} />
          <SourceCaption source={route.source} />
        </div>
        {isBest ? (
          <Badge className="bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950">best</Badge>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-2xl leading-none font-semibold tabular-nums">
            {formatToken(route.amountOut)}
          </span>
          <span className="text-xs text-muted-foreground">{route.to.symbol}</span>
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          <Stat
            label="Per 10,000"
            value={formatPerTenThousand(perTenThousand(route.amountOut, route.amountIn))}
          />
          <Stat label="Cost" value={formatBps(route.costBps)} tone={costTone(route.costBps)} />
          <Stat
            label="Worst case"
            value={`${formatToken(route.minAmountOut)} ${route.to.symbol}`}
            hint={formatBps(route.worstCaseCostBps)}
          />
          <Stat label="ETA" value={formatEta(route.etaSeconds)} />
        </dl>

        {route.fees.length > 0 ? (
          <ul className="flex flex-wrap gap-x-2 gap-y-0.5 text-[0.7rem] text-muted-foreground">
            {route.fees.map((fee, index) => (
              <li key={`${fee.label}-${index}`} className="font-mono">
                {fee.label} {formatToken(fee.amount)} {fee.unit}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.7rem] text-muted-foreground">No itemised fees reported.</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-1 border-t pt-1.5 text-[0.7rem] text-muted-foreground">
          <span>
            slippage {(route.slippageBps / 100).toFixed(2)}%, quoted {formatIso(route.quotedAt)}
          </span>
          <a
            href={INTENTS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
          >
            Execute
            <ExternalLink className="size-2.5" aria-hidden />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function FailureCard({ failure }: { failure: RouteFailure }) {
  return (
    <Card size="sm" className="gap-2 border-destructive/30 bg-destructive/5 ring-destructive/20">
      <CardHeader className="grid-cols-[1fr_auto] items-center gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <SourceBadge source={failure.source} />
          <SourceCaption source={failure.source} />
        </div>
        <Badge variant="outline" className="text-destructive">
          {FAILURE_LABEL[failure.kind]}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <p className="font-mono text-sm break-words whitespace-pre-wrap text-destructive">{failure.reason}</p>
        <p className="text-[0.7rem] text-muted-foreground">
          {SOURCE_LABEL[failure.source]} could not quote {failure.from.symbol} on {failure.from.chain} to{" "}
          {failure.to.symbol} on {failure.to.chain}.
        </p>
      </CardContent>
    </Card>
  );
}

export function RouteCards({
  routes,
  failures,
  best,
  loading,
}: {
  routes: RouteQuote[];
  failures: RouteFailure[];
  best: RouteQuote | null;
  loading: boolean;
}) {
  if (loading && routes.length === 0 && failures.length === 0) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <Skeleton className="h-52" />
        <Skeleton className="h-52" />
      </div>
    );
  }

  if (routes.length === 0 && failures.length === 0) {
    return <EmptyNote>No route has been quoted yet.</EmptyNote>;
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {routes.map((route) => (
        <RouteCard key={`route-${route.source}`} route={route} isBest={best?.source === route.source} />
      ))}
      {failures.map((failure) => (
        <FailureCard key={`failure-${failure.source}`} failure={failure} />
      ))}
    </div>
  );
}
