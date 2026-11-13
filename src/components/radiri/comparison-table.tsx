import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RouteFailure, RouteQuote } from "@/lib/radiri/types";
import { cn } from "@/lib/utils";
import { EmptyNote, SourceBadge } from "./bits";
import { SOURCE_ORDER, formatBps, formatEta, formatPerTenThousand, formatToken, perTenThousand } from "./format";

const FAILURE_LABEL: Record<RouteFailure["kind"], string> = {
  "no-liquidity": "no liquidity",
  unsupported: "unsupported",
  error: "error",
};

export function ComparisonTable({
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
    return <Skeleton className="h-24" />;
  }

  const sources = SOURCE_ORDER.filter(
    (source) => routes.some((route) => route.source === source) || failures.some((failure) => failure.source === source),
  );

  if (sources.length === 0) {
    return <EmptyNote>Nothing to compare yet.</EmptyNote>;
  }

  return (
    <Table className="text-xs">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-8 text-[0.65rem] tracking-wide text-muted-foreground uppercase">Source</TableHead>
          <TableHead className="h-8 text-right text-[0.65rem] tracking-wide text-muted-foreground uppercase">
            Amount out
          </TableHead>
          <TableHead className="h-8 text-right text-[0.65rem] tracking-wide text-muted-foreground uppercase">
            Per 10,000
          </TableHead>
          <TableHead className="h-8 text-right text-[0.65rem] tracking-wide text-muted-foreground uppercase">
            Cost
          </TableHead>
          <TableHead className="h-8 text-right text-[0.65rem] tracking-wide text-muted-foreground uppercase">
            Worst case
          </TableHead>
          <TableHead className="h-8 text-right text-[0.65rem] tracking-wide text-muted-foreground uppercase">
            ETA
          </TableHead>
          <TableHead className="h-8 text-[0.65rem] tracking-wide text-muted-foreground uppercase">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sources.map((source) => {
          const route = routes.find((item) => item.source === source);
          const failure = failures.find((item) => item.source === source);
          const failureLabel = FAILURE_LABEL[failure?.kind ?? "error"];
          const failureReason = failure?.reason ?? "";
          const labelRepeats = failureReason.toLowerCase().includes(failureLabel);

          return (
            <TableRow key={source} className={cn(best?.source === source && "bg-emerald-500/5 hover:bg-emerald-500/10")}>
              <TableCell className="py-1.5">
                <SourceBadge source={source} />
              </TableCell>
              {route ? (
                <>
                  <TableCell className="py-1.5 text-right font-mono tabular-nums">
                    {formatToken(route.amountOut)} {route.to.symbol}
                  </TableCell>
                  <TableCell className="py-1.5 text-right font-mono tabular-nums">
                    {formatPerTenThousand(perTenThousand(route.amountOut, route.amountIn))}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "py-1.5 text-right font-mono tabular-nums",
                      route.costBps <= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : route.costBps >= 75
                          ? "text-destructive"
                          : null,
                    )}
                  >
                    {formatBps(route.costBps)}
                  </TableCell>
                  <TableCell className="py-1.5 text-right font-mono tabular-nums">
                    {formatToken(route.minAmountOut)}
                    <span className="text-muted-foreground"> / {formatBps(route.worstCaseCostBps)}</span>
                  </TableCell>
                  <TableCell className="py-1.5 text-right font-mono tabular-nums">
                    {formatEta(route.etaSeconds)}
                  </TableCell>
                  <TableCell className="py-1.5 text-muted-foreground">quoted</TableCell>
                </>
              ) : (
                <>
                  <TableCell className="py-1.5 text-right text-muted-foreground">n/a</TableCell>
                  <TableCell className="py-1.5 text-right text-muted-foreground">n/a</TableCell>
                  <TableCell className="py-1.5 text-right text-muted-foreground">n/a</TableCell>
                  <TableCell className="py-1.5 text-right text-muted-foreground">n/a</TableCell>
                  <TableCell className="py-1.5 text-right text-muted-foreground">n/a</TableCell>
                  <TableCell className="max-w-64 py-1.5 text-destructive">
                    {labelRepeats ? null : (
                      <span className="font-mono text-[0.7rem]">{failureLabel}</span>
                    )}
                    <span className={cn("break-words whitespace-pre-wrap", !labelRepeats && "ml-1")}>
                      {failureReason}
                    </span>
                  </TableCell>
                </>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
