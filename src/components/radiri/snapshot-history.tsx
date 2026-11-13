"use client";

import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
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
import { CONTRACT_ID, EXPLORER_URL, NETWORK } from "@/lib/config";
import type { OnchainSnapshot } from "@/lib/radiri/types";
import { getSnapshots } from "./api";
import { EmptyNote, ErrorNote, SnapshotStatus, SourceBadge } from "./bits";
import { formatBps, formatEta, formatPairId, formatTimestampMs, formatUsd, toMessage } from "./format";

export function SnapshotHistory() {
  const [snapshots, setSnapshots] = useState<OnchainSnapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getSnapshots(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setSnapshots(data);
        setError(null);
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoading(false);
      });
    return () => controller.abort();
  }, [nonce]);

  const rows = [...(snapshots ?? [])].sort((a, b) => b.timestamp_ms - a.timestamp_ms);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-[0.7rem] text-muted-foreground">
        <span>
          {loading && !snapshots
            ? "Reading the registry contract."
            : error
              ? "The registry contract could not be read."
              : `${rows.length} snapshot${rows.length === 1 ? "" : "s"} returned on ${NETWORK}`}
          {!error && CONTRACT_ID ? (
            <>
              {" "}
              from{" "}
              <a
                className="font-mono underline underline-offset-2 hover:text-foreground"
                href={`${EXPLORER_URL}/address/${CONTRACT_ID}`}
                target="_blank"
                rel="noreferrer"
              >
                {CONTRACT_ID}
              </a>
            </>
          ) : (
            " (NEXT_PUBLIC_CONTRACT_ID is not set)"
          )}
        </span>
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            setLoading(true);
            setNonce((value) => value + 1);
          }}
          disabled={loading}
        >
          <RefreshCw className={loading ? "animate-spin" : undefined} aria-hidden />
          Refresh
        </Button>
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {loading && !snapshots ? (
        <Skeleton className="h-24" />
      ) : error ? null : rows.length === 0 ? (
        <EmptyNote>
          No snapshots on chain yet. Run <span className="font-mono">pnpm monitor</span> with the reporter key to write
          the first one.
        </EmptyNote>
      ) : (
        <Table className="text-xs">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 text-[0.65rem] tracking-wide text-muted-foreground uppercase">Pair</TableHead>
              <TableHead className="h-8 text-[0.65rem] tracking-wide text-muted-foreground uppercase">Source</TableHead>
              <TableHead className="h-8 text-right text-[0.65rem] tracking-wide text-muted-foreground uppercase">
                Size
              </TableHead>
              <TableHead className="h-8 text-right text-[0.65rem] tracking-wide text-muted-foreground uppercase">
                Cost
              </TableHead>
              <TableHead className="h-8 text-right text-[0.65rem] tracking-wide text-muted-foreground uppercase">
                ETA
              </TableHead>
              <TableHead className="h-8 text-[0.65rem] tracking-wide text-muted-foreground uppercase">Status</TableHead>
              <TableHead className="h-8 text-[0.65rem] tracking-wide text-muted-foreground uppercase">Recorded</TableHead>
              <TableHead className="h-8 text-right text-[0.65rem] tracking-wide text-muted-foreground uppercase">
                Block
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((snapshot, index) => (
              <TableRow key={`${snapshot.pair_id}-${snapshot.source}-${snapshot.timestamp_ms}-${index}`}>
                <TableCell className="py-1.5 font-mono">{formatPairId(snapshot.pair_id)}</TableCell>
                <TableCell className="py-1.5">
                  <SourceBadge source={snapshot.source} />
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono tabular-nums">
                  {formatUsd(snapshot.amount_in_usd)}
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono tabular-nums">{formatBps(snapshot.cost_bps)}</TableCell>
                <TableCell className="py-1.5 text-right font-mono tabular-nums">{formatEta(snapshot.eta_s)}</TableCell>
                <TableCell className="py-1.5">
                  <SnapshotStatus status={snapshot.status} />
                </TableCell>
                <TableCell className="py-1.5 font-mono text-muted-foreground">
                  {formatTimestampMs(snapshot.timestamp_ms)}
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                  {snapshot.block_height}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <p className="flex items-center gap-1 text-[0.7rem] text-muted-foreground">
        Read only view calls, no wallet needed.
        <a
          href={CONTRACT_ID ? `${EXPLORER_URL}/address/${CONTRACT_ID}` : `${EXPLORER_URL}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground"
        >
          Explorer
          <ExternalLink className="size-2.5" aria-hidden />
        </a>
      </p>
    </div>
  );
}
