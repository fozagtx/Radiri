"use client";

import { Alert, Badge, Box, Card, Flex, Heading, HStack, Link, Progress, Skeleton, Stack, Stat, Text } from "@chakra-ui/react";
import { CircleSlash, ExternalLink } from "lucide-react";
import { TokenAvatar } from "@/components/app/token-avatar";
import { EXPLORER_URL } from "@/lib/config";
import { type BlockReason, formatAge, formatHealthFactor, formatPriceWad, HEALTH_BAND_LABEL, healthBand, type PriceCheck } from "@/lib/risk";
import type { AssetView } from "@/types/protocol";
import { bandTone, CATEGORY_LABEL, referenceOf, type Tone } from "./format";

/** Chakra colour palette for each tone. */
export const TONE_PALETTE: Record<Tone, string> = { neutral: "gray", good: "green", warn: "orange", bad: "red" };
const TONE_FG: Record<Tone, string> = { neutral: "fg", good: "green.700", warn: "orange.700", bad: "red.600" };

export function PageHeader({ title, description, action }: { title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Flex mb="6" wrap="wrap" align="flex-end" justify="space-between" gap="4">
      <Box minW="0">
        <Heading as="h1" fontFamily="display" fontWeight="normal" fontSize={{ base: "4xl", md: "5xl" }} lineHeight="1" letterSpacing="-0.03em">
          {title}
        </Heading>
        {description ? (
          <Text mt="2" maxW="68ch" color="fg.muted" textStyle="sm">
            {description}
          </Text>
        ) : null}
      </Box>
      {action ? <Box flexShrink={0}>{action}</Box> : null}
    </Flex>
  );
}

/** Standard panel: Chakra Card with a title row, optional description and action. */
export function Section({
  title,
  description,
  action,
  children,
  id,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  id?: string;
}) {
  return (
    <Card.Root id={id} variant="outline" bg="bg.panel" borderRadius="panel" boxShadow="panel" scrollMarginTop="24" overflow="hidden">
      <Card.Header pb="3">
        <Flex justify="space-between" align="flex-start" gap="3">
          <Box minW="0">
            <Card.Title textStyle="md" fontWeight="semibold" letterSpacing="-0.01em">
              {title}
            </Card.Title>
            {description ? (
              <Card.Description textStyle="sm" mt="0.5">
                {description}
              </Card.Description>
            ) : null}
          </Box>
          {action ? <Box flexShrink={0}>{action}</Box> : null}
        </Flex>
      </Card.Header>
      <Card.Body pt="0" minW="0">
        {children}
      </Card.Body>
    </Card.Root>
  );
}

export function Pill({ tone = "neutral", children, title }: { tone?: Tone; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <Badge colorPalette={TONE_PALETTE[tone]} variant="subtle" size="sm" borderRadius="full" title={title} fontFamily="mono" textTransform="uppercase" letterSpacing="0.06em" gap="1">
      {children}
    </Badge>
  );
}

/** Metric tile built on Chakra Stat. */
export function StatTile({ label, value, hint, tone = "neutral" }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: Tone; className?: string }) {
  return (
    <Stat.Root borderWidth="1px" borderColor="border" bg="bg.panel" borderRadius="xl" px="4" py="3.5" minW="0">
      <Stat.Label color="fg.muted" textStyle="xs">
        {label}
      </Stat.Label>
      <Stat.ValueText fontFamily="mono" fontWeight="medium" textStyle={{ base: "lg", md: "xl" }} color={TONE_FG[tone]} truncate>
        {value}
      </Stat.ValueText>
      {hint ? (
        <Stat.HelpText color="fg.muted" textStyle="xs" truncate>
          {hint}
        </Stat.HelpText>
      ) : null}
    </Stat.Root>
  );
}

/** Health factor with its band label: never colour alone. */
export function HealthValue({ value, size = "md" }: { value: bigint | null; size?: "md" | "lg" }) {
  const band = healthBand(value);
  const tone = bandTone(band);
  return (
    <HStack as="span" gap="2" align="baseline">
      <Text as="span" fontFamily="mono" textStyle={size === "lg" ? "2xl" : "md"} color={TONE_FG[tone]}>
        {formatHealthFactor(value)}
      </Text>
      <Badge colorPalette={TONE_PALETTE[tone]} variant="subtle" size="sm" borderRadius="full">
        {HEALTH_BAND_LABEL[band]}
      </Badge>
    </HStack>
  );
}

/** Share of the borrow limit in use, as a Chakra Progress bar. */
export function LimitMeter({ usedBps, label = "Borrow limit used" }: { usedBps: number | null; label?: string }) {
  const pct = usedBps === null ? 0 : Math.min(100, Math.max(0, usedBps / 100));
  const palette = usedBps === null ? "gray" : usedBps >= 9_000 ? "red" : usedBps >= 7_000 ? "orange" : "green";
  return (
    <Progress.Root value={pct} size="sm" colorPalette={palette} shape="full">
      <HStack justify="space-between" mb="1.5">
        <Progress.Label textStyle="xs" color="fg.muted" fontWeight="normal">
          {label}
        </Progress.Label>
        <Progress.ValueText fontFamily="mono" textStyle="xs">
          {pct.toFixed(2)}%
        </Progress.ValueText>
      </HStack>
      <Progress.Track bg="bg.muted">
        <Progress.Range />
      </Progress.Track>
    </Progress.Root>
  );
}

export function TestTokenTag() {
  return (
    <Badge colorPalette="orange" variant="outline" size="xs" borderRadius="full" title="Testnet test token: no value">
      test
    </Badge>
  );
}

export function AssetLabel({ asset, showCategory = false, compact = false }: { asset: AssetView; showCategory?: boolean; compact?: boolean }) {
  const reference = referenceOf(asset.config.token_id);
  return (
    <HStack gap="3" minW="0">
      <TokenAvatar symbol={asset.config.symbol} category={asset.config.category} size={compact ? "sm" : "md"} />
      <Stack gap="0" minW="0">
        <HStack gap="1.5">
          <Text fontWeight="semibold" textStyle="sm">
            {asset.config.symbol}
          </Text>
          {!compact ? <TestTokenTag /> : null}
        </HStack>
        {!compact ? (
          <Text textStyle="xs" color="fg.muted" truncate>
            {showCategory ? `${CATEGORY_LABEL[asset.config.category]} · ` : ""}
            {reference ? `mirrors ${reference.symbol}` : ""}
          </Text>
        ) : null}
      </Stack>
    </HStack>
  );
}

export function PriceTag({ asset, check }: { asset: AssetView; check: PriceCheck }) {
  const price = asset.price ? BigInt(asset.price.price_wad) : null;
  return (
    <HStack gap="2" wrap="wrap">
      <Text as="span" fontFamily="mono" textStyle="sm">
        {formatPriceWad(price)}
      </Text>
      <Badge colorPalette={check.fresh ? "green" : "red"} variant="subtle" size="xs" borderRadius="full">
        {check.fresh ? "fresh" : check.status === "stale" ? "stale" : "no price"} · {formatAge(check.ageMs)}
      </Badge>
    </HStack>
  );
}

export function ReasonList({ reasons }: { reasons: BlockReason[] }) {
  if (reasons.length === 0) return null;
  return (
    <Alert.Root status="error" variant="subtle" borderRadius="lg" size="sm" aria-live="polite">
      <Alert.Indicator>
        <CircleSlash size={14} />
      </Alert.Indicator>
      <Alert.Content>
        <Stack gap="1">
          {reasons.map((reason, index) => (
            <Alert.Description key={`${reason.code}-${reason.tokenId ?? ""}-${index}`} textStyle="xs">
              {reason.message}
            </Alert.Description>
          ))}
        </Stack>
      </Alert.Content>
    </Alert.Root>
  );
}

const NOTE_STATUS: Record<Tone, "info" | "warning" | "success" | "error" | "neutral"> = { neutral: "neutral", good: "success", warn: "warning", bad: "error" };

export function Note({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <Alert.Root status={NOTE_STATUS[tone]} variant="subtle" borderRadius="lg" size="sm">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description textStyle="xs" wordBreak="break-word">
          {children}
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

export function TxLinks({ hashes, urls }: { hashes: string[]; urls: string[] }) {
  if (hashes.length === 0) return null;
  return (
    <Stack gap="1">
      {hashes.map((hash, index) => (
        <Link key={hash} href={urls[index] ?? `${EXPLORER_URL}/txns/${hash}`} target="_blank" rel="noreferrer" fontFamily="mono" textStyle="xs" gap="1" colorPalette="gray">
          {hash.length > 22 ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : hash}
          <ExternalLink size={11} aria-hidden />
        </Link>
      ))}
    </Stack>
  );
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <Stack gap="2" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height="9" borderRadius="lg" />
      ))}
    </Stack>
  );
}
