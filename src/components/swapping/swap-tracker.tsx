"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Note, Pill } from "@/components/shared/bits";
import type { Tone } from "@/components/shared/format";
import { useNow } from "@/components/shared/use-now";
import { useSwapHistory } from "@/hooks/use-swap-history";
import { TERMINAL_SWAP_STATUSES, type RadiriSwapStatus } from "@/lib/intents/types";
import type { SwapRecord, SwapStatusValue } from "@/types/protocol";

const POLL_MS = 6_000;

const STATUS_COPY: Record<SwapStatusValue, { label: string; detail: string; tone: Tone }> = {
  PENDING_DEPOSIT: { label: "Waiting for deposit", detail: "1Click has not seen the deposit yet.", tone: "neutral" },
  KNOWN_DEPOSIT_TX: { label: "Deposit seen", detail: "The deposit transaction is known; waiting for confirmations.", tone: "neutral" },
  INCOMPLETE_DEPOSIT: { label: "Incomplete deposit", detail: "Less than the quoted amount arrived. 1Click will refund it.", tone: "warn" },
  PROCESSING: { label: "Processing", detail: "Solvers are executing the swap and delivering the output.", tone: "neutral" },
  SUCCESS: { label: "Delivered", detail: "1Click reports the output was delivered to the recipient.", tone: "good" },
  REFUNDED: { label: "Refunded", detail: "The deposit was returned to the refund address.", tone: "warn" },
  FAILED: { label: "Failed", detail: "1Click reports the swap failed.", tone: "bad" },
};

function TxList({ title, items }: { title: string; items: { hash: string; explorerUrl: string | null }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{title}</span>
      {items.map((item) => (
        <a
          key={item.hash}
          href={item.explorerUrl ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[11px] break-all underline underline-offset-2"
        >
          {item.hash.length > 26 ? `${item.hash.slice(0, 12)}…${item.hash.slice(-10)}` : item.hash}
          {item.explorerUrl ? <ExternalLink className="size-3 shrink-0" aria-hidden /> : null}
        </a>
      ))}
    </div>
  );
}

/** Polls GET /api/swaps/status for one deposit address and mirrors the 1Click status into the history. */
export function SwapTracker({ record }: { record: SwapRecord }) {
  const { upsert } = useSwapHistory();
  const nowMs = useNow(5_000);
  const [status, setStatus] = useState<RadiriSwapStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const terminal = TERMINAL_SWAP_STATUSES.has(status?.status ?? record.lastStatus);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const search = new URLSearchParams({ depositAddress: record.depositAddress });
        if (record.depositMemo) search.set("depositMemo", record.depositMemo);
        const res = await fetch(`/api/swaps/status?${search}`, { cache: "no-store" });
        const body = (await res.json()) as RadiriSwapStatus & { error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        if (cancelled) return;
        setStatus(body);
        setError(null);
        if (body.status !== record.lastStatus) {
          upsert({ ...record, lastStatus: body.status, updatedAt: new Date().toISOString() });
        }
        if (!TERMINAL_SWAP_STATUSES.has(body.status)) timer = setTimeout(poll, POLL_MS);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        timer = setTimeout(poll, POLL_MS * 2);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [record, upsert]);

  const value = status?.status ?? record.lastStatus;
  const copy = STATUS_COPY[value];
  const deadline = record.quote.deadline ? Date.parse(record.quote.deadline) : NaN;
  const expired = value === "PENDING_DEPOSIT" && Number.isFinite(deadline) && nowMs > 0 && nowMs > deadline;

  return (
    <div className="flex flex-col gap-2.5 rounded-xl bg-foreground/[0.03] px-3 py-3" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          {!terminal ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden /> : null}
          {copy.label}
        </span>
        <Pill tone={copy.tone}>{value}</Pill>
      </div>
      <p className="text-xs text-muted-foreground">{copy.detail}</p>
      {expired ? <Note tone="warn">The quote deadline has passed. Do not send to this deposit address; request a new quote.</Note> : null}
      {error ? <Note tone="bad">Status check failed: {error}. Retrying.</Note> : null}
      {status?.amountOut ? (
        <p className="text-xs">
          Delivered: <span className="font-mono">{status.amountOut} {record.quote.destination.symbol}</span>
        </p>
      ) : null}
      {status?.refundReason || status?.refundedAmount ? (
        <p className="text-xs">
          Refund: <span className="font-mono">{status.refundedAmount ?? "–"} {record.quote.origin.symbol}</span>
          {status.refundReason ? ` (${status.refundReason})` : ""}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <TxList title="Origin chain" items={status?.originTxHashes ?? []} />
        <TxList title="Destination chain" items={status?.destinationTxHashes ?? []} />
      </div>
      {status?.intentsExplorerUrl ? (
        <a
          href={status.intentsExplorerUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          NEAR Intents explorer
          <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}
