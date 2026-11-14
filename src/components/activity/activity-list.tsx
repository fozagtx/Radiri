"use client";

import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  ExternalLink,
  Gavel,
  HandCoins,
  PiggyBank,
  Undo2,
} from "lucide-react";
import { Pill } from "@/components/shared/bits";
import { formatDateTime, type Tone } from "@/components/shared/format";
import type { ActivityItem } from "@/types/protocol";

const KIND_ICON: Record<ActivityItem["kind"], typeof HandCoins> = {
  deposit_collateral: ArrowDownToLine,
  withdraw_collateral: ArrowUpFromLine,
  supply: PiggyBank,
  withdraw_supply: ArrowUpFromLine,
  borrow: HandCoins,
  repay: Undo2,
  liquidated: Gavel,
  liquidate: Gavel,
  swap: ArrowLeftRight,
};

const SOURCE_LABEL: Record<ActivityItem["source"], string> = {
  "lending-contract": "testnet",
  "1click": "1Click",
};

const SOURCE_TONE: Record<ActivityItem["source"], Tone> = {
  "lending-contract": "good",
  "1click": "neutral",
};

const STATUS_TONE: Record<ActivityItem["status"], Tone> = {
  success: "good",
  pending: "neutral",
  failed: "bad",
  refunded: "warn",
};

export function ActivityList({ items, empty }: { items: ActivityItem[]; empty: React.ReactNode }) {
  if (items.length === 0) return <p className="py-2 text-xs text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-foreground/6">
      {items.map((item) => {
        const Icon = KIND_ICON[item.kind] ?? HandCoins;
        const ms = Date.parse(item.timestamp);
        return (
          <li key={item.id} className="flex items-start gap-3 py-2.5">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-foreground/5">
              <Icon className="size-3.5 text-foreground/70" aria-hidden />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-medium">{item.title}</span>
                <Pill tone={SOURCE_TONE[item.source]}>{SOURCE_LABEL[item.source]}</Pill>
                {item.status !== "success" ? <Pill tone={STATUS_TONE[item.status]}>{item.status}</Pill> : null}
              </div>
              <span className="font-mono text-[11.5px] break-all text-foreground/75">{item.detail}</span>
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {Number.isFinite(ms) ? formatDateTime(ms) : item.timestamp}
              </span>
            </div>
            {item.explorerUrl ? (
              <a
                href={item.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-foreground/12 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                aria-label={`Open ${item.title} in explorer`}
              >
                {item.source === "1click" ? "Explorer" : "Block"}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
