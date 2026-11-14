"use client";

import NextLink from "next/link";
import { AbsoluteCenter, Badge, Box, Button, Card, Container, Flex, Grid, Heading, HStack, LinkBox, LinkOverlay, Progress, ProgressCircle, SimpleGrid, Stack, Stat, Text } from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";
import { ActivityList } from "@/components/activity/activity-list";
import { useActivityItems } from "@/components/activity/use-activity";
import { TokenAvatar, TokenPair } from "@/components/app/token-avatar";
import { MarketNotice, usePortfolioTotals } from "@/components/shared/account-summary";
import { Section, SkeletonRows, TONE_PALETTE } from "@/components/shared/bits";
import { amountOf, bandTone } from "@/components/shared/format";
import { useLending } from "@/components/shared/lending-provider";
import { ModeBanner } from "@/components/shared/mode-banner";
import { formatHealthFactor, formatUsdWad, HEALTH_BAND_LABEL, healthBand, WAD } from "@/lib/risk";
import { useNearWallet } from "@/lib/wallets/near";

const JOURNEYS = [
  { href: "/borrow#stocks", from: { symbol: "PEPE" }, to: { symbol: "AAPL", category: "stock" }, title: "Borrow stocks with meme coins", body: "Lock PEPE, borrow tokenized Apple." },
  { href: "/borrow#memes", from: { symbol: "NVDA", category: "stock" }, to: { symbol: "PEPE" }, title: "Borrow meme coins with stocks", body: "Lock tokenized NVIDIA, borrow PEPE." },
  { href: "/swap", from: { symbol: "PEPE" }, to: { symbol: "TSLA", category: "stock" }, title: "Swap across chains", body: "PEPE on Ethereum to Tesla on BNB Chain." },
];

function HealthGauge({ value }: { value: bigint | null }) {
  const band = healthBand(value);
  const palette = TONE_PALETTE[bandTone(band)];
  const hf = value === null ? 3 : Math.min(3, Number((value * BigInt(100)) / WAD) / 100);
  const pct = value === null ? 100 : Math.max(0, Math.min(100, ((hf - 1) / 2) * 100));
  return (
    <Stack align="center" gap="2">
      <ProgressCircle.Root value={pct} size="xl" colorPalette={palette}>
        <ProgressCircle.Circle css={{ "--size": "136px", "--thickness": "10px" }}>
          <ProgressCircle.Track stroke="bg.muted" />
          <ProgressCircle.Range strokeLinecap="round" />
        </ProgressCircle.Circle>
        <AbsoluteCenter>
          <Text fontFamily="mono" textStyle="2xl">
            {formatHealthFactor(value)}
          </Text>
        </AbsoluteCenter>
      </ProgressCircle.Root>
      <Badge colorPalette={palette} variant="subtle" borderRadius="full">
        Health factor · {HEALTH_BAND_LABEL[band]}
      </Badge>
    </Stack>
  );
}

function ConnectHero() {
  const wallet = useNearWallet();
  return (
    <Card.Root variant="outline" bg="bg.panel" borderRadius="panel" boxShadow="panel" overflow="hidden" className="radiri-rise">
      <Card.Body p={{ base: "6", md: "10" }}>
        <Flex direction={{ base: "column", md: "row" }} align={{ md: "center" }} justify="space-between" gap="8">
          <Box maxW="lg">
            <Heading as="h1" fontFamily="display" fontWeight="normal" fontSize={{ base: "4xl", md: "6xl" }} lineHeight="1" letterSpacing="-0.03em">
              Your meme coins, working as collateral.
            </Heading>
            <Text mt="3" color="fg.muted">
              Connect a NEAR testnet wallet to see your positions, mint test tokens and borrow.
            </Text>
            <Button mt="6" size="md" borderRadius="full" bg="ink" color="white" _hover={{ bg: "#2a2a2a" }} onClick={() => void wallet.signIn()} disabled={!wallet.ready || wallet.connecting}>
              Connect NEAR wallet
            </Button>
          </Box>
          <Stack gap="4" align="center">
            <TokenPair from={{ symbol: "PEPE" }} to={{ symbol: "AAPL", category: "stock" }} size="xl" />
            <TokenPair from={{ symbol: "SHIB" }} to={{ symbol: "NVDA", category: "stock" }} size="xl" />
          </Stack>
        </Flex>
      </Card.Body>
    </Card.Root>
  );
}

function PositionHero() {
  const lending = useLending();
  const totals = usePortfolioTotals();
  const used = totals?.limitUsedBps ?? 0;
  const metrics: [string, string][] = [
    ["Collateral", totals ? formatUsdWad(totals.collateralWad, { compact: true }) : "–"],
    ["Borrowed", totals ? formatUsdWad(totals.debtWad, { compact: true }) : "–"],
    ["Can still borrow", totals ? formatUsdWad(totals.availableWad, { compact: true }) : "–"],
    ["Open positions", totals ? String(totals.positions) : "–"],
  ];
  return (
    <Card.Root variant="outline" bg="bg.panel" borderRadius="panel" boxShadow="panel" className="radiri-rise">
      <Card.Body p={{ base: "6", md: "8" }}>
        <Grid templateColumns={{ base: "1fr", md: "1fr auto" }} gap="8" alignItems="center">
          <Stack gap="6">
            <Stat.Root>
              <Stat.Label color="fg.muted">Net position</Stat.Label>
              <Stat.ValueText fontFamily="display" fontWeight="normal" fontSize={{ base: "5xl", md: "6xl" }} lineHeight="1">
                {totals ? formatUsdWad(totals.netWad) : "–"}
              </Stat.ValueText>
              <Stat.HelpText fontFamily="mono" color="fg.muted">
                {lending.walletAccountId}
              </Stat.HelpText>
            </Stat.Root>
            <SimpleGrid columns={{ base: 2, sm: 4 }} gap="4">
              {metrics.map(([label, value]) => (
                <Stat.Root key={label}>
                  <Stat.Label color="fg.muted" textStyle="xs">
                    {label}
                  </Stat.Label>
                  <Stat.ValueText fontFamily="mono" textStyle="xl" fontWeight="medium">
                    {value}
                  </Stat.ValueText>
                </Stat.Root>
              ))}
            </SimpleGrid>
            <Progress.Root value={Math.min(100, used / 100)} size="sm" shape="full" colorPalette={used >= 9000 ? "red" : used >= 7000 ? "orange" : "green"}>
              <HStack justify="space-between" mb="1.5">
                <Progress.Label textStyle="xs" color="fg.muted" fontWeight="normal">
                  Borrow limit used
                </Progress.Label>
                <Progress.ValueText fontFamily="mono" textStyle="xs" />
              </HStack>
              <Progress.Track bg="bg.muted">
                <Progress.Range />
              </Progress.Track>
            </Progress.Root>
          </Stack>
          <Box borderLeftWidth={{ md: "1px" }} borderColor="border.muted" pl={{ md: "8" }}>
            <HealthGauge value={totals?.healthFactorWad ?? null} />
          </Box>
        </Grid>
      </Card.Body>
    </Card.Root>
  );
}

function Positions() {
  const lending = useLending();
  const risk = lending.risk;
  if (lending.accountState === "loading" && !lending.account) return <SkeletonRows rows={3} />;
  if (!risk || (risk.collateral.length === 0 && risk.debt.length === 0)) {
    return (
      <Text py="4" textStyle="sm" color="fg.muted">
        No open positions yet. Start on the Borrow page.
      </Text>
    );
  }
  const rows = [...risk.collateral.map((line) => ({ kind: "Collateral", ...line })), ...risk.debt.map((line) => ({ kind: "Borrowed", ...line }))];
  return (
    <Stack gap="1">
      {rows.map((row) => {
        const asset = lending.assetIndex.get(row.tokenId);
        return (
          <HStack key={`${row.kind}-${row.tokenId}`} gap="3" px="2" py="2.5" borderRadius="lg" _hover={{ bg: "bg.subtle" }}>
            <TokenAvatar symbol={asset?.config.symbol ?? "?"} category={asset?.config.category} size="md" />
            <Stack gap="0" flex="1" minW="0">
              <Text fontWeight="semibold" textStyle="sm">
                {asset?.config.symbol ?? row.tokenId}
              </Text>
              <Badge alignSelf="flex-start" size="xs" variant="subtle" colorPalette={row.kind === "Borrowed" ? "orange" : "gray"} borderRadius="full">
                {row.kind}
              </Badge>
            </Stack>
            <Stack gap="0" align="flex-end">
              <Text fontFamily="mono" textStyle="sm">
                {asset ? amountOf(asset, row.amount, 4) : row.amount.toString()}
              </Text>
              <Text fontFamily="mono" textStyle="xs" color="fg.muted">
                {formatUsdWad(row.valueWad)}
              </Text>
            </Stack>
          </HStack>
        );
      })}
    </Stack>
  );
}

export function OverviewView() {
  const lending = useLending();
  const items = useActivityItems();
  return (
    <Container maxW="6xl" px="4" py={{ base: "6", md: "10" }}>
      <ModeBanner />
      <Stack gap="5">
        <MarketNotice />
        {lending.walletAccountId ? <PositionHero /> : <ConnectHero />}

        <SimpleGrid columns={{ base: 1, md: 3 }} gap="4">
          {JOURNEYS.map((journey, index) => (
            <LinkBox
              key={journey.href}
              as="article"
              className="radiri-rise"
              style={{ animationDelay: `${80 + index * 60}ms` }}
              bg="bg.panel"
              borderWidth="1px"
              borderColor="border"
              borderRadius="panel"
              p="5"
              transition="all 0.2s"
              _hover={{ transform: "translateY(-2px)", boxShadow: "lift", borderColor: "border.emphasized" }}
            >
              <Flex justify="space-between" align="center" mb="4">
                <TokenPair from={journey.from} to={journey.to} size="lg" />
                <ArrowRight size={16} color="#8a8a86" aria-hidden />
              </Flex>
              <LinkOverlay asChild>
                <NextLink href={journey.href}>
                  <Text fontWeight="semibold" textStyle="md" letterSpacing="-0.01em">
                    {journey.title}
                  </Text>
                </NextLink>
              </LinkOverlay>
              <Text textStyle="sm" color="fg.muted">
                {journey.body}
              </Text>
            </LinkBox>
          ))}
        </SimpleGrid>

        <Grid templateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap="4" alignItems="start">
          <Section title="Active positions" action={<NextLink href="/portfolio" style={{ fontSize: 12, color: "#5b5b5b" }}>Portfolio →</NextLink>}>
            <Positions />
          </Section>
          <Section title="Recent activity" action={<NextLink href="/activity" style={{ fontSize: 12, color: "#5b5b5b" }}>All activity →</NextLink>}>
            <ActivityList items={items.slice(0, 6)} empty="No activity yet." />
          </Section>
        </Grid>
      </Stack>
    </Container>
  );
}
