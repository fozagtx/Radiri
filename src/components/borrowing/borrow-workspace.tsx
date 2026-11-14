"use client";

import { useEffect, useState } from "react";
import { Box, Container, DataList, Grid, SegmentGroup, SimpleGrid, Stack, Tabs, Text } from "@chakra-ui/react";
import { TokenPair } from "@/components/app/token-avatar";
import { ActionForm } from "@/components/shared/action-form";
import { AccountNotice, MarketNotice, usePortfolioTotals } from "@/components/shared/account-summary";
import { HealthValue, LimitMeter, PageHeader, PriceTag, Section, SkeletonRows, StatTile } from "@/components/shared/bits";
import { FaucetButton } from "@/components/shared/faucet-button";
import { amountOf, referenceOf } from "@/components/shared/format";
import { useLending } from "@/components/shared/lending-provider";
import { ModeBanner } from "@/components/shared/mode-banner";
import { formatBpsPercent, formatUsdWad, pricedAsset, u128OrZero, ZERO } from "@/lib/risk";
import type { AssetView, LendingCategory } from "@/types/protocol";
import { AssetPicker, type PickerOption } from "./asset-picker";

type Direction = "stocks" | "memes";

const DIRECTIONS: Record<Direction, { label: string; collateral: LendingCategory; borrow: LendingCategory; blurb: string }> = {
  stocks: { label: "Borrow stocks with meme coins", collateral: "meme", borrow: "stock", blurb: "Lock meme coins as collateral and borrow tokenized stocks against them." },
  memes: { label: "Borrow meme coins with stocks", collateral: "stock", borrow: "meme", blurb: "Lock tokenized stocks as collateral and borrow meme coins against them." },
};

function firstEnabled(options: PickerOption[]): string | null {
  return options.find((option) => !option.disabledReason)?.asset.config.token_id ?? null;
}

function useChoice(options: PickerOption[]): [string | null, (id: string) => void] {
  const [choice, setChoice] = useState<string | null>(null);
  const valid = options.some((option) => option.asset.config.token_id === choice && !option.disabledReason);
  return [valid ? choice : firstEnabled(options), setChoice];
}

function Params({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <DataList.Root orientation="horizontal" size="sm" gap="2" bg="bg.subtle" borderRadius="xl" px="4" py="3">
      {rows.map(([label, value]) => (
        <DataList.Item key={label}>
          <DataList.ItemLabel color="fg.muted" minW="40">
            {label}
          </DataList.ItemLabel>
          <DataList.ItemValue fontFamily="mono" justifyContent="flex-end">
            {value}
          </DataList.ItemValue>
        </DataList.Item>
      ))}
    </DataList.Root>
  );
}

function CollateralParams({ asset }: { asset: AssetView }) {
  const lending = useLending();
  const check = lending.market ? pricedAsset(lending.market.assets, asset.config.token_id, lending.market.nowMs).price : null;
  const reference = referenceOf(asset.config.token_id);
  const cap = u128OrZero(asset.config.collateral_cap);
  const room = cap === ZERO ? "no cap" : amountOf(asset, cap > u128OrZero(asset.total_collateral) ? cap - u128OrZero(asset.total_collateral) : ZERO, 0);
  return (
    <Params
      rows={[
        ["Max LTV", formatBpsPercent(asset.config.ltv_bps, 0)],
        ["Liquidation at", formatBpsPercent(asset.config.liquidation_threshold_bps, 0)],
        ["Liquidation bonus", formatBpsPercent(asset.config.liquidation_bonus_bps, 0)],
        [`Oracle price${reference ? ` (${reference.symbol})` : ""}`, check ? <PriceTag asset={asset} check={check} /> : "…"],
        ["Collateral cap room", room],
      ]}
    />
  );
}

function BorrowParams({ asset }: { asset: AssetView }) {
  const lending = useLending();
  const check = lending.market ? pricedAsset(lending.market.assets, asset.config.token_id, lending.market.nowMs).price : null;
  const cap = u128OrZero(asset.config.borrow_cap);
  return (
    <Params
      rows={[
        ["Borrow APR", formatBpsPercent(asset.borrow_apr_bps)],
        ["Utilization", formatBpsPercent(asset.utilization_bps)],
        ["Available in pool", amountOf(asset, asset.cash, 4)],
        ["Oracle price", check ? <PriceTag asset={asset} check={check} /> : "…"],
        ["Borrow cap", cap === ZERO ? "no cap" : amountOf(asset, cap, 2)],
      ]}
    />
  );
}

function Journey({ direction }: { direction: Direction }) {
  const lending = useLending();
  const totals = usePortfolioTotals();
  const spec = DIRECTIONS[direction];
  const [manage, setManage] = useState<"repay" | "withdraw">("repay");

  const collateralAssets = lending.assets.filter((asset) => asset.config.category === spec.collateral);
  const borrowAssets = lending.assets.filter((asset) => asset.config.category === spec.borrow);

  const collateralOptions: PickerOption[] = collateralAssets.map((asset) => {
    const id = asset.config.token_id;
    const balance = lending.balances[id]?.amount ?? null;
    const deposited = lending.holdings.collateral[id] ?? ZERO;
    return {
      asset,
      detail: deposited > ZERO ? `deposited ${amountOf(asset, deposited, 2)}` : `wallet ${balance === null ? "–" : amountOf(asset, balance, 2)}`,
      disabledReason: !asset.config.can_collateralize ? "not collateral" : asset.config.paused ? "paused" : null,
    };
  });
  const borrowOptions: PickerOption[] = borrowAssets.map((asset) => ({
    asset,
    detail: `APR ${formatBpsPercent(asset.borrow_apr_bps)}`,
    disabledReason: !asset.config.can_borrow ? "not borrowable" : asset.config.paused ? "paused" : u128OrZero(asset.cash) === ZERO ? "no liquidity" : null,
  }));
  const debtOptions: PickerOption[] = borrowAssets
    .filter((asset) => (lending.holdings.debt[asset.config.token_id] ?? ZERO) > ZERO)
    .map((asset) => ({ asset, detail: `owe ${amountOf(asset, lending.holdings.debt[asset.config.token_id] ?? ZERO, 4)}` }));
  const withdrawOptions: PickerOption[] = collateralAssets
    .filter((asset) => (lending.holdings.collateral[asset.config.token_id] ?? ZERO) > ZERO)
    .map((asset) => ({ asset, detail: `deposited ${amountOf(asset, lending.holdings.collateral[asset.config.token_id] ?? ZERO, 2)}` }));

  const [collateralId, setCollateralId] = useChoice(collateralOptions);
  const [borrowId, setBorrowId] = useChoice(borrowOptions);
  const [repayId, setRepayId] = useChoice(debtOptions);
  const [withdrawId, setWithdrawId] = useChoice(withdrawOptions);

  const collateral = collateralId ? lending.assetIndex.get(collateralId) : undefined;
  const borrow = borrowId ? lending.assetIndex.get(borrowId) : undefined;

  if (lending.marketsState !== "ready" || !lending.market) {
    return (
      <Grid templateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap="4">
        <Section title="1 · Deposit collateral">
          <SkeletonRows rows={4} />
        </Section>
        <Section title="2 · Borrow">
          <SkeletonRows rows={4} />
        </Section>
      </Grid>
    );
  }

  return (
    <Stack gap="4">
      <Text textStyle="sm" color="fg.muted">
        {spec.blurb}
      </Text>
      <Grid templateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap="4" alignItems="start">
        <Section title="1 · Deposit collateral" description={`${spec.collateral === "meme" ? "Meme coins" : "Tokenized stocks"} accepted as collateral.`}>
          <Stack gap="4">
            <AssetPicker label="Collateral asset" options={collateralOptions} value={collateralId} onChange={setCollateralId} />
            {collateral ? (
              <>
                <CollateralParams asset={collateral} />
                <FaucetButton asset={collateral} />
                <ActionForm key={`deposit-${collateral.config.token_id}`} kind="deposit_collateral" tokenId={collateral.config.token_id} />
              </>
            ) : null}
          </Stack>
        </Section>

        <Stack gap="4">
          <Section title="Borrowing capacity" description="Live from your collateral and the contract's oracle prices.">
            <Stack gap="4">
              <SimpleGrid columns={2} gap="3">
                <StatTile label="Available to borrow" value={totals ? formatUsdWad(totals.availableWad) : "–"} />
                <StatTile label="Health factor" value={totals ? <HealthValue value={totals.healthFactorWad} /> : "–"} />
                <StatTile label="Borrow limit" value={totals ? formatUsdWad(totals.borrowLimitWad) : "–"} />
                <StatTile label="Debt" value={totals ? formatUsdWad(totals.debtWad) : "–"} />
              </SimpleGrid>
              <LimitMeter usedBps={totals?.limitUsedBps ?? null} />
            </Stack>
          </Section>

          <Section title="2 · Borrow" description={`${spec.borrow === "stock" ? "Tokenized stocks" : "Meme coins"} with pool liquidity.`}>
            <Stack gap="4">
              <AssetPicker label="Borrow asset" options={borrowOptions} value={borrowId} onChange={setBorrowId} />
              {borrow ? (
                <>
                  <BorrowParams asset={borrow} />
                  <ActionForm key={`borrow-${borrow.config.token_id}-${collateralId ?? ""}`} kind="borrow" tokenId={borrow.config.token_id} focusCollateralId={collateralId} />
                </>
              ) : (
                <Text textStyle="sm" color="fg.muted">
                  No borrowable asset with liquidity in this category right now.
                </Text>
              )}
            </Stack>
          </Section>
        </Stack>
      </Grid>

      <Section
        title="3 · Manage this position"
        description="Repay what you borrowed, or take collateral back once the debt allows it."
        action={
          <SegmentGroup.Root size="sm" value={manage} onValueChange={(details) => setManage(details.value === "withdraw" ? "withdraw" : "repay")}>
            <SegmentGroup.Indicator />
            <SegmentGroup.Items items={[{ value: "repay", label: "Repay" }, { value: "withdraw", label: "Withdraw collateral" }]} />
          </SegmentGroup.Root>
        }
      >
        {manage === "repay" ? (
          debtOptions.length === 0 ? (
            <Text textStyle="sm" color="fg.muted">
              No {spec.borrow === "stock" ? "stock" : "meme coin"} debt to repay.
            </Text>
          ) : (
            <Grid templateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap="4">
              <AssetPicker label="Debt to repay" options={debtOptions} value={repayId} onChange={setRepayId} />
              {repayId ? <ActionForm key={`repay-${repayId}`} kind="repay" tokenId={repayId} focusCollateralId={collateralId} /> : null}
            </Grid>
          )
        ) : withdrawOptions.length === 0 ? (
          <Text textStyle="sm" color="fg.muted">
            No {spec.collateral === "meme" ? "meme coin" : "stock"} collateral deposited.
          </Text>
        ) : (
          <Grid templateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap="4">
            <AssetPicker label="Collateral to withdraw" options={withdrawOptions} value={withdrawId} onChange={setWithdrawId} />
            {withdrawId ? <ActionForm key={`withdraw-${withdrawId}`} kind="withdraw_collateral" tokenId={withdrawId} /> : null}
          </Grid>
        )}
      </Section>
    </Stack>
  );
}

export function BorrowWorkspace() {
  const [direction, setDirection] = useState<Direction>("stocks");

  useEffect(() => {
    const fromHash = () => {
      if (window.location.hash === "#memes") setDirection("memes");
      else if (window.location.hash === "#stocks") setDirection("stocks");
    };
    const timer = setTimeout(fromHash, 0);
    window.addEventListener("hashchange", fromHash);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("hashchange", fromHash);
    };
  }, []);

  return (
    <Container maxW="6xl" px="4" py={{ base: "6", md: "10" }}>
      <PageHeader title="Borrow" description="Two markets on one lending contract: borrow tokenized stocks against meme coins, or meme coins against tokenized stocks." />
      <ModeBanner />
      <Stack gap="5">
        <MarketNotice />
        <AccountNotice />
        <Tabs.Root
          value={direction}
          onValueChange={(details) => {
            const next = details.value === "memes" ? "memes" : "stocks";
            setDirection(next);
            try {
              window.history.replaceState(null, "", `#${next}`);
            } catch {
              // ignore
            }
          }}
          variant="plain"
          lazyMount
        >
          <Tabs.List bg="bg.muted" borderRadius="2xl" p="1.5" gap="1.5" w="full" display="grid" gridTemplateColumns={{ base: "1fr", sm: "1fr 1fr" }}>
            {(Object.keys(DIRECTIONS) as Direction[]).map((key) => (
              <Tabs.Trigger key={key} value={key} h="auto" py="3" px="4" borderRadius="xl" justifyContent="flex-start" gap="3" textStyle="sm" fontWeight="semibold" color="fg.muted" _selected={{ color: "fg" }}>
                {key === "stocks" ? (
                  <TokenPair from={{ symbol: "PEPE" }} to={{ symbol: "AAPL", category: "stock" }} size="md" />
                ) : (
                  <TokenPair from={{ symbol: "NVDA", category: "stock" }} to={{ symbol: "PEPE" }} size="md" />
                )}
                {DIRECTIONS[key].label}
              </Tabs.Trigger>
            ))}
            <Tabs.Indicator bg="bg.panel" borderRadius="xl" boxShadow="panel" />
          </Tabs.List>
          <Box pt="5">
            <Tabs.Content value="stocks" p="0">
              <Journey direction="stocks" />
            </Tabs.Content>
            <Tabs.Content value="memes" p="0">
              <Journey direction="memes" />
            </Tabs.Content>
          </Box>
        </Tabs.Root>
      </Stack>
    </Container>
  );
}
