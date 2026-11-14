"use client";

import { useEffect, useState } from "react";
import { Box, HStack, Link, SimpleGrid, Spinner, Stack, Steps, Text } from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";
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
    <Stack gap="0.5">
      <Text textStyle="xs" color="fg.muted">
        {title}
      </Text>
      {items.map((item) => (
        <Link key={item.hash} href={item.explorerUrl ?? undefined} target="_blank" rel="noreferrer" fontFamily="mono" textStyle="xs" wordBreak="break-all" gap="1">
          {item.hash.length > 26 ? `${item.hash.slice(0, 12)}…${item.hash.slice(-10)}` : item.hash}
          {item.explorerUrl ? <ExternalLink size={11} aria-hidden /> : null}
        </Link>
      ))}
    </Stack>
  );
}

const STEP_OF: Record<SwapStatusValue, number> = {
  PENDING_DEPOSIT: 0,
  KNOWN_DEPOSIT_TX: 1,
  INCOMPLETE_DEPOSIT: 1,
  PROCESSING: 1,
  SUCCESS: 3,
  REFUNDED: 3,
  FAILED: 2,
};

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
    <Stack gap="4" aria-live="polite">
      <Steps.Root step={STEP_OF[value]} count={3} size="sm" colorPalette={copy.tone === "bad" ? "red" : copy.tone === "warn" ? "orange" : "green"}>
        <Steps.List>
          {["Deposit", "Solvers execute", value === "REFUNDED" ? "Refunded" : "Delivered"].map((title, index) => (
            <Steps.Item key={title} index={index}>
              <Steps.Indicator />
              <Steps.Title textStyle="xs">{title}</Steps.Title>
              <Steps.Separator />
            </Steps.Item>
          ))}
        </Steps.List>
      </Steps.Root>
      <HStack justify="space-between" wrap="wrap" gap="2">
        <HStack gap="2">
          {!terminal ? <Spinner size="xs" color="fg.muted" /> : null}
          <Text fontWeight="semibold" textStyle="sm">
            {copy.label}
          </Text>
        </HStack>
        <Pill tone={copy.tone}>{value}</Pill>
      </HStack>
      <Text textStyle="xs" color="fg.muted">
        {copy.detail}
      </Text>
      {expired ? <Note tone="warn">The quote deadline has passed. Do not send to this deposit address; request a new quote.</Note> : null}
      {error ? <Note tone="bad">Status check failed: {error}. Retrying.</Note> : null}
      {status?.amountOut ? (
        <Text textStyle="sm">
          Delivered:{" "}
          <Text as="span" fontFamily="mono">
            {status.amountOut} {record.quote.destination.symbol}
          </Text>
        </Text>
      ) : null}
      {status?.refundReason || status?.refundedAmount ? (
        <Text textStyle="sm">
          Refund:{" "}
          <Text as="span" fontFamily="mono">
            {status.refundedAmount ?? "–"} {record.quote.origin.symbol}
          </Text>
          {status.refundReason ? ` (${status.refundReason})` : ""}
        </Text>
      ) : null}
      <SimpleGrid columns={{ base: 1, sm: 2 }} gap="3">
        <TxList title="Origin chain" items={status?.originTxHashes ?? []} />
        <TxList title="Destination chain" items={status?.destinationTxHashes ?? []} />
      </SimpleGrid>
      {status?.intentsExplorerUrl ? (
        <Box>
          <Link href={status.intentsExplorerUrl} target="_blank" rel="noreferrer" textStyle="xs" color="fg.muted" gap="1">
            NEAR Intents explorer
            <ExternalLink size={11} aria-hidden />
          </Link>
        </Box>
      ) : null}
    </Stack>
  );
}
