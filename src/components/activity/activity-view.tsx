"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Container, HStack, Stack } from "@chakra-ui/react";
import { AccountNotice } from "@/components/shared/account-summary";
import { PageHeader, Section, SkeletonRows } from "@/components/shared/bits";
import { useLending } from "@/components/shared/lending-provider";
import { ModeBanner } from "@/components/shared/mode-banner";
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
    <Container maxW="6xl" px="4" py={{ base: "6", md: "10" }}>
      <PageHeader
        title="Activity"
        description="Deposits, withdrawals, borrows, repayments and liquidations from the NEAR testnet lending contract, plus the NEAR Intents swaps started in this browser."
      />
      <ModeBanner />
      <Stack gap="4">
        <AccountNotice />
        <Section title="History">
          <HStack gap="1.5" wrap="wrap" mb="3" role="group" aria-label="Filter by kind">
            {FILTERS.map((entry) => (
              <Button
                key={entry.id}
                size="xs"
                borderRadius="full"
                variant={filter === entry.id ? "solid" : "outline"}
                bg={filter === entry.id ? "ink" : undefined}
                color={filter === entry.id ? "white" : undefined}
                aria-pressed={filter === entry.id}
                onClick={() => setFilter(entry.id)}
              >
                {entry.label}
                <Badge size="xs" variant="subtle" borderRadius="full" colorPalette="gray">
                  {counts.get(entry.id) ?? 0}
                </Badge>
              </Button>
            ))}
          </HStack>
          {loading ? (
            <SkeletonRows rows={4} />
          ) : (
            <ActivityList
              items={visible}
              empty={filter === "all" ? "No activity yet. Deposit collateral on the Borrow page or start a swap." : `No ${active.label.toLowerCase()} yet.`}
            />
          )}
        </Section>
      </Stack>
    </Container>
  );
}
