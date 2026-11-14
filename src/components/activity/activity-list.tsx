"use client";

import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Gavel,
  HandCoins,
  PiggyBank,
  Undo2,
} from "lucide-react";
import { Button, Circle, HStack, Stack, StackSeparator, Text } from "@chakra-ui/react";
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
  if (items.length === 0)
    return (
      <Text py="4" textStyle="sm" color="fg.muted">
        {empty}
      </Text>
    );
  return (
    <Stack gap="0" separator={<StackSeparator borderColor="border.muted" />}>
      {items.map((item) => {
        const Icon = KIND_ICON[item.kind] ?? HandCoins;
        const ms = Date.parse(item.timestamp);
        return (
          <HStack key={item.id} align="flex-start" gap="3" py="3">
            <Circle size="9" bg="bg.muted" flexShrink={0}>
              <Icon size={15} aria-hidden />
            </Circle>
            <Stack gap="0.5" flex="1" minW="0">
              <HStack gap="1.5" wrap="wrap">
                <Text textStyle="sm" fontWeight="semibold">
                  {item.title}
                </Text>
                <Pill tone={SOURCE_TONE[item.source]}>{SOURCE_LABEL[item.source]}</Pill>
                {item.status !== "success" ? <Pill tone={STATUS_TONE[item.status]}>{item.status}</Pill> : null}
              </HStack>
              <Text fontFamily="mono" textStyle="xs" color="fg" wordBreak="break-all">
                {item.detail}
              </Text>
              <Text fontFamily="mono" textStyle="2xs" color="fg.muted">
                {Number.isFinite(ms) ? formatDateTime(ms) : item.timestamp}
              </Text>
            </Stack>
            {item.explorerUrl ? (
              <Button asChild size="2xs" variant="outline" borderRadius="full" flexShrink={0}>
                <a href={item.explorerUrl} target="_blank" rel="noreferrer" aria-label={`Open ${item.title} in explorer`}>
                  {item.source === "1click" ? "Explorer" : "Block"}
                </a>
              </Button>
            ) : null}
          </HStack>
        );
      })}
    </Stack>
  );
}
