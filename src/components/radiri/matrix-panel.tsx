"use client";

import { useState } from "react";
import { Grid3x3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MatrixCell, MatrixResponse } from "@/lib/radiri/types";
import { cn } from "@/lib/utils";
import { postMatrix } from "./api";
import { EmptyNote, ErrorNote, SourceBadge } from "./bits";
import { SOURCE_LABEL, formatIso, formatPerTenThousand, formatToken, perTenThousand, toMessage } from "./format";
import { OpportunityList } from "./opportunities";

const MAX_AXIS = 6;

function axisKey(symbol: string, chain: string): string {
  return `${symbol}:${chain}`;
}

export function MatrixPanel({ amount }: { amount: number }) {
  const [data, setData] = useState<MatrixResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await postMatrix(amount));
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  const cells = data?.cells ?? [];
  const fromAxis = Array.from(new Map(cells.map((cell) => [axisKey(cell.from.symbol, cell.from.chain), cell.from])).values());
  const toAxis = Array.from(new Map(cells.map((cell) => [axisKey(cell.to.symbol, cell.to.chain), cell.to])).values());
  const rows = fromAxis.slice(0, MAX_AXIS);
  const columns = toAxis.slice(0, MAX_AXIS);
  const lookup = new Map(cells.map((cell) => [`${axisKey(cell.from.symbol, cell.from.chain)}>${axisKey(cell.to.symbol, cell.to.chain)}`, cell]));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <p className="text-[0.7rem] text-muted-foreground">
          {data
            ? `${data.cells.length} pairs quoted at ${formatToken(data.amount)}, generated ${formatIso(data.generatedAt)}`
            : "Every stablecoin pair the engine can quote at this size, one cell each."}
        </p>
        <Button size="xs" variant="outline" onClick={() => void load()} disabled={loading || !(amount > 0)}>
          <Grid3x3 aria-hidden />
          {loading ? "Quoting" : data ? "Requote matrix" : "Quote matrix"}
        </Button>
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {loading && !data ? <Skeleton className="h-40" /> : null}

      {data && rows.length > 0 && columns.length > 0 ? (
        <>
          <Table className="text-[0.65rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-7 px-1 text-[0.6rem] tracking-wide text-muted-foreground uppercase">From</TableHead>
                {columns.map((column) => (
                  <TableHead
                    key={axisKey(column.symbol, column.chain)}
                    className="h-7 px-1 text-right text-[0.6rem] tracking-wide text-muted-foreground uppercase"
                  >
                    {column.symbol}
                    <span className="ml-0.5 text-muted-foreground/70">{column.chain}</span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={axisKey(row.symbol, row.chain)}>
                  <TableCell className="px-1 py-1 font-mono">
                    {row.symbol}
                    <span className="ml-0.5 text-muted-foreground">{row.chain}</span>
                  </TableCell>
                  {columns.map((column) => {
                    const cell: MatrixCell | undefined = lookup.get(
                      `${axisKey(row.symbol, row.chain)}>${axisKey(column.symbol, column.chain)}`,
                    );
                    const best = cell?.best ?? null;
                    const failure = cell?.failures[0];
                    const normalized = best ? perTenThousand(best.amountOut, best.amountIn) : null;

                    return (
                      <TableCell
                        key={`${axisKey(row.symbol, row.chain)}>${axisKey(column.symbol, column.chain)}`}
                        className={cn(
                          "px-1 py-1 text-right font-mono tabular-nums",
                          !cell && "text-muted-foreground/40",
                          cell && !best && "text-destructive",
                        )}
                        title={failure?.reason}
                      >
                        {!cell ? (
                          "n/a"
                        ) : best ? (
                          <span className="inline-flex flex-col leading-tight">
                            <span>{formatPerTenThousand(normalized)}</span>
                            <span className="text-[0.6rem] text-muted-foreground">{SOURCE_LABEL[best.source]}</span>
                          </span>
                        ) : cell.failures.length > 0 ? (
                          <span className="inline-flex flex-col leading-tight">
                            <span>gap</span>
                            <span className="max-w-32 truncate text-[0.6rem] font-normal">{failure?.reason}</span>
                          </span>
                        ) : (
                          "n/a"
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-1.5 text-[0.65rem] text-muted-foreground">
            <span>
              Showing {rows.length} of {fromAxis.length} sources and {columns.length} of {toAxis.length} destinations.
              Cells are {formatToken(data.amount)} of the from token.
            </span>
            <span className="inline-flex items-center gap-1.5">
              <SourceBadge source="near-intents" />
              <SourceBadge source="rhea" />
              best source is named under each number
            </span>
          </div>
        </>
      ) : null}

      {data && data.opportunities.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-t pt-2">
          <p className="text-[0.7rem] font-medium">Matrix opportunities</p>
          <OpportunityList opportunities={data.opportunities} loading={false} limit={5} />
        </div>
      ) : null}

      {data && data.cells.length === 0 ? <EmptyNote>The matrix came back empty.</EmptyNote> : null}
      {data && data.opportunities.length === 0 ? (
        <EmptyNote>No opportunities were flagged across the matrix.</EmptyNote>
      ) : null}
    </div>
  );
}
