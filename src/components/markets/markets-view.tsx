"use client";

import { useEffect, useState } from "react";
import { Badge, Box, Card, Container, DataList, Heading, HStack, Progress, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { TokenAvatar } from "@/components/app/token-avatar";
import { MarketNotice } from "@/components/shared/account-summary";
import { Note, PageHeader, SkeletonRows, TestTokenTag } from "@/components/shared/bits";
import { referenceOf } from "@/components/shared/format";
import { useLending } from "@/components/shared/lending-provider";
import { ModeBanner } from "@/components/shared/mode-banner";
import { chainName } from "@/lib/intents/chains";
import { formatAge, formatBpsPercent, formatPriceWad, pricedAsset, unitsToNumber } from "@/lib/risk";
import type { RheaLendingSnapshot } from "@/lib/rhea/lending";
import type { AssetView, CatalogAsset, LendingCategory } from "@/types/protocol";

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error"; error: string };

function useJson<T>(url: string): Load<T> {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json()) as T & { error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        if (!cancelled) setLoad({ state: "ready", data: body });
      })
      .catch((error: unknown) => !cancelled && setLoad({ state: "error", error: error instanceof Error ? error.message : String(error) }));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return load;
}

function usd(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "–";
  if (value >= 1) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${value.toPrecision(3)}`;
}

/** Large token amounts read better compact: 4,989,999,999 -> 4.99B. */
function compactAmount(value: string, decimals: number): string {
  const amount = unitsToNumber(BigInt(value), decimals);
  return new Intl.NumberFormat("en-US", { notation: amount >= 100_000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(amount);
}

function MarketCard({ asset, index }: { asset: AssetView; index: number }) {
  const { market } = useLending();
  const check = market ? pricedAsset(market.assets, asset.config.token_id, market.nowMs).price : null;
  const reference = referenceOf(asset.config.token_id);
  const price = asset.price ? BigInt(asset.price.price_wad) : null;
  return (
    <Card.Root
      variant="outline"
      bg="bg.panel"
      borderRadius="panel"
      boxShadow="panel"
      className="radiri-rise"
      style={{ animationDelay: `${index * 50}ms` }}
      transition="all 0.2s"
      _hover={{ transform: "translateY(-2px)", boxShadow: "lift" }}
    >
      <Card.Body gap="5">
        <Stack gap="4">
          <HStack gap="3">
            <TokenAvatar symbol={asset.config.symbol} category={asset.config.category} size="lg" />
            <Box flex="1" minW="0">
              <HStack gap="1.5">
                <Text fontWeight="semibold" textStyle="md">
                  {asset.config.symbol}
                </Text>
                <TestTokenTag />
              </HStack>
              <Text textStyle="xs" color="fg.muted">
                mirrors {reference?.symbol ?? "–"}
              </Text>
            </Box>
          </HStack>
          <HStack justify="space-between" align="baseline" gap="2">
            <Text fontFamily="mono" textStyle="xl" letterSpacing="-0.02em">
              {formatPriceWad(price)}
            </Text>
            <Badge size="xs" variant="subtle" borderRadius="full" colorPalette={check?.fresh ? "green" : "red"}>
              {check?.fresh ? "fresh" : "stale"} · {formatAge(check?.ageMs ?? null)}
            </Badge>
          </HStack>
        </Stack>

        <Progress.Root value={Math.min(100, asset.utilization_bps / 100)} size="xs" shape="full" colorPalette="gray">
          <HStack justify="space-between" mb="1.5">
            <Progress.Label textStyle="xs" color="fg.muted" fontWeight="normal">
              Utilization
            </Progress.Label>
            <Progress.ValueText fontFamily="mono" textStyle="xs" />
          </HStack>
          <Progress.Track bg="bg.muted">
            <Progress.Range bg="ink" />
          </Progress.Track>
        </Progress.Root>

        <DataList.Root orientation="horizontal" size="sm" gap="2">
          {[
            ["Borrow APR", formatBpsPercent(asset.borrow_apr_bps)],
            ["Supply APR", formatBpsPercent(asset.supply_apr_bps)],
            ["Max LTV / liquidation", `${formatBpsPercent(asset.config.ltv_bps, 0)} / ${formatBpsPercent(asset.config.liquidation_threshold_bps, 0)}`],
            ["Available to borrow", compactAmount(asset.cash, asset.config.decimals)],
          ].map(([label, value]) => (
            <DataList.Item key={label}>
              <DataList.ItemLabel color="fg.muted" flex="1">
                {label}
              </DataList.ItemLabel>
              <DataList.ItemValue fontFamily="mono" justifyContent="flex-end" flex="none" whiteSpace="nowrap">
                {value}
              </DataList.ItemValue>
            </DataList.Item>
          ))}
        </DataList.Root>
      </Card.Body>
      <Card.Footer pt="0" gap="1.5">
        {asset.config.can_collateralize ? (
          <Badge variant="outline" colorPalette="green" borderRadius="full" size="sm">
            collateral
          </Badge>
        ) : null}
        {asset.config.can_borrow ? (
          <Badge variant="outline" colorPalette="green" borderRadius="full" size="sm">
            borrowable
          </Badge>
        ) : null}
        {asset.config.paused ? (
          <Badge variant="solid" colorPalette="red" borderRadius="full" size="sm">
            paused
          </Badge>
        ) : null}
      </Card.Footer>
    </Card.Root>
  );
}

function LendingMarkets({ category }: { category: LendingCategory }) {
  const lending = useLending();
  if (lending.marketsState !== "ready") return <SkeletonRows rows={3} />;
  const assets = lending.assets.filter((asset) => asset.config.category === category);
  return (
    <SimpleGrid columns={{ base: 1, sm: 2, lg: category === "meme" ? 4 : 3 }} gap="4" alignItems="stretch">
      {assets.map((asset, index) => (
        <MarketCard key={asset.config.token_id} asset={asset} index={index} />
      ))}
    </SimpleGrid>
  );
}

function SwapAssets() {
  const catalog = useJson<{ assets: CatalogAsset[] }>("/api/assets?eligible=swap");
  if (catalog.state === "loading") return <SkeletonRows rows={4} />;
  if (catalog.state === "error") return <Note tone="bad">NEAR Intents catalog unavailable: {catalog.error}</Note>;
  const groups: { title: string; rows: CatalogAsset[] }[] = [
    { title: "Tokenized stocks", rows: catalog.data.assets.filter((asset) => asset.category === "stock" && asset.priceUsd) },
    { title: "Meme coins", rows: catalog.data.assets.filter((asset) => asset.category === "meme" && asset.priceUsd) },
  ];
  return (
    <Stack gap="6">
      {groups.map((group) => (
        <Box key={group.title}>
          <Text mb="3" textStyle="sm" fontWeight="semibold" color="fg.muted">
            {group.title}
          </Text>
          <SimpleGrid columns={{ base: 1, sm: 2, lg: 4 }} gap="3">
            {group.rows.map((asset) => (
              <HStack key={asset.id} gap="3" px="4" py="3" bg="bg.panel" borderWidth="1px" borderColor="border" borderRadius="xl" transition="all 0.15s" _hover={{ borderColor: "border.emphasized", boxShadow: "panel" }}>
                <TokenAvatar symbol={asset.symbol} category={asset.category} chain={asset.chain} size="md" />
                <Box flex="1" minW="0">
                  <Text fontWeight="semibold" textStyle="sm" truncate>
                    {asset.symbol}
                  </Text>
                  <Text textStyle="xs" color="fg.muted" truncate>
                    {chainName(asset.chain)}
                  </Text>
                </Box>
                <Text fontFamily="mono" textStyle="sm">
                  {usd(asset.priceUsd)}
                </Text>
              </HStack>
            ))}
          </SimpleGrid>
        </Box>
      ))}
    </Stack>
  );
}

function RheaReference() {
  const rhea = useJson<RheaLendingSnapshot>("/api/rhea/lending");
  if (rhea.state !== "ready") return null;
  const lendable = rhea.data.reserves.filter((reserve) => reserve.canUseAsCollateral || reserve.canBorrow).length;
  return (
    <Text textStyle="xs" color="fg.muted">
      For reference, RHEA Lending on NEAR mainnet ({rhea.data.contractId}) has {rhea.data.reserves.length} reserves, {lendable} of them usable as collateral or
      borrowable, and none is a meme coin or a tokenized stock. That gap is what Radiri&apos;s markets fill.
    </Text>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Heading as="h2" textStyle="xl" fontWeight="semibold" letterSpacing="-0.02em" mb="4">
      {children}
    </Heading>
  );
}

export function MarketsView() {
  return (
    <Container maxW="6xl" px="4" py={{ base: "6", md: "10" }}>
      <PageHeader title="Markets" description="Live lending markets on NEAR testnet, and every meme coin and tokenized stock you can swap through NEAR Intents." />
      <ModeBanner />
      <Stack gap="10">
        <MarketNotice />
        <Box>
          <SectionHeading>Meme coin markets</SectionHeading>
          <LendingMarkets category="meme" />
        </Box>
        <Box>
          <SectionHeading>Tokenized stock markets</SectionHeading>
          <LendingMarkets category="stock" />
        </Box>
        <Box>
          <SectionHeading>Swap catalog · NEAR Intents</SectionHeading>
          <SwapAssets />
        </Box>
        <RheaReference />
      </Stack>
    </Container>
  );
}
