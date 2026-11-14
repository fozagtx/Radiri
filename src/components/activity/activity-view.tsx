"use client";

import { useMemo, useState } from "react";
import { AccountNotice } from "@/components/shared/account-summary";
import { PageHeader, Section, SkeletonRows } from "@/components/shared/bits";
import { useLending } from "@/components/shared/lending-provider";
import { ModeBanner } from "@/components/shared/mode-banner";
import { cn } from "@/lib/utils";
import type { ActivityItem } from "@/types/protocol";
import { ActivityList } from "./activity-list";
import { useActivityItems } from "./use-activity";

type Filter = "all" | "deposits" | "withdrawals" | "borrows" | "repayments" | "liquidations" | "swaps";

const FILTERS: { id: Filter; label: string; kinds: ActivityItem["kind"][] }[] = [
  { id: "all", label: "All", kinds: [] },
  { id: "deposits", label: "Deposits", kinds: ["deposit_collateral", "supply"] },
  { id: "withdrawals", label: "Withdrawals", kinds: ["withdraw_collateral", "withdraw_supply"] },
  { id: "borrows", label: "Borrows", kinds: ["borrow"] },
  { id: "repayments", label: "Repayments", kinds: ["repay"] },
  { id: "liquidations", label: "Liquidations", kinds: ["liquidated", "liquidate"] },
  { id: "swaps", label: "Swaps", kinds: ["swap"] },
];

export function ActivityView() {
  const lending = useLending();
  const items = useActivityItems();
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const result = new Map<Filter, number>();
    for (const entry of FILTERS) {
      result.set(entry.id, entry.id === "all" ? items.length : items.filter((item) => entry.kinds.includes(item.kind)).length);
    }
    return result;
  }, [items]);

  const active = FILTERS.find((entry) => entry.id === filter) ?? FILTERS[0];
  const visible = filter === "all" ? items : items.filter((item) => active.kinds.includes(item.kind));
  const loading = lending.accountState === "loading" && lending.activity.length === 0;

  return (
    <>
      <PageHeader
        title="Activity"
        description="Deposits, withdrawals, borrows, repayments and liquidations from the lending contract (or the simulation), plus the 1Click swaps started in this browser."
      />
      <ModeBanner />
      <div className="mb-3">
        <AccountNotice />
      </div>

      <Section
        title="Unified feed"
        description={
          lending.mode === "near"
            ? "Lending rows come from get_account_activity (last 32 per account) and link to their block. Swaps link to the NEAR Intents explorer: search the deposit address."
            : "Lending rows are simulated and have no transaction. Swaps link to the NEAR Intents explorer: search the deposit address."
        }
      >
        <div role="group" aria-label="Filter by kind" className="mb-2 flex flex-wrap gap-1.5">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={filter === entry.id}
              onClick={() => setFilter(entry.id)}
              className={cn(
                "rounded-full border px-3 py-1 text-[12px] transition-colors",
                filter === entry.id
                  ? "border-foreground bg-foreground text-background"
                  : "border-foreground/15 text-foreground/70 hover:border-foreground/35 hover:text-foreground",
              )}
            >
              {entry.label}
              <span className="ml-1.5 font-mono text-[10.5px] opacity-70">{counts.get(entry.id) ?? 0}</span>
            </button>
          ))}
        </div>
        {loading ? (
          <SkeletonRows rows={4} />
        ) : (
          <ActivityList
            items={visible}
            empty={filter === "all" ? "No activity yet. Deposit collateral on the Borrow page or start a swap." : `No ${active.label.toLowerCase()} yet.`}
          />
        )}
      </Section>
    </>
  );
}
