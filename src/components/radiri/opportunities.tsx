import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Opportunity } from "@/lib/radiri/types";
import { EmptyNote, OpportunityIcon, SeverityTag } from "./bits";
import { chainLabel, formatBps } from "./format";

export function OpportunityList({
  opportunities,
  loading,
  limit,
}: {
  opportunities: Opportunity[];
  loading: boolean;
  limit?: number;
}) {
  if (loading && opportunities.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    );
  }

  if (opportunities.length === 0) {
    return <EmptyNote>No opportunities flagged for this quote.</EmptyNote>;
  }

  const items = typeof limit === "number" ? opportunities.slice(0, limit) : opportunities;

  return (
    <ul className="flex flex-col gap-2">
      {items.map((opportunity, index) => (
        <li
          key={`${opportunity.kind}-${opportunity.from.symbol}-${opportunity.to.symbol}-${index}`}
          className="flex gap-2 rounded-lg border p-2"
        >
          <OpportunityIcon severity={opportunity.severity} />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium">{opportunity.title}</span>
              <SeverityTag severity={opportunity.severity} />
              <Badge variant="ghost" className="text-[0.65rem] text-muted-foreground">
                {opportunity.kind}
              </Badge>
            </div>
            <p className="text-[0.7rem] break-words text-muted-foreground">{opportunity.detail}</p>
            <p className="font-mono text-[0.65rem] text-muted-foreground">
              {opportunity.from.symbol} on {chainLabel(opportunity.from.chain)} to {opportunity.to.symbol} on{" "}
              {chainLabel(opportunity.to.chain)}
              {typeof opportunity.metricBps === "number" ? ` | ${formatBps(opportunity.metricBps)}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
