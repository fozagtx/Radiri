"use client";

import { useState } from "react";
import { Box, Button, CloseButton, Container, Flex, HStack, SimpleGrid, Stack, Table, Text } from "@chakra-ui/react";
import { ActionForm } from "@/components/shared/action-form";
import { AccountNotice, MarketNotice, SummaryTiles, usePortfolioTotals } from "@/components/shared/account-summary";
import { AssetLabel, PageHeader, PriceTag, Section, SkeletonRows } from "@/components/shared/bits";
import { amountOf, CATEGORY_LABEL } from "@/components/shared/format";
import { useLending } from "@/components/shared/lending-provider";
import { ModeBanner } from "@/components/shared/mode-banner";
import { TokenAvatar } from "@/components/app/token-avatar";
import { formatBpsPercent, formatPriceWad, formatUsdWad, liquidationPriceWad, type LendingActionKind, ZERO } from "@/lib/risk";

type Selection = { kind: LendingActionKind; tokenId: string } | null;

const BAR_COLORS = ["#191919", "#4f4f4f", "#7d7d7a", "#a6a49f", "#c9c6bf", "#e2dfd8"];
const ACTION_TITLE: Partial<Record<LendingActionKind, string>> = {
  repay: "Repay",
  deposit_collateral: "Add collateral",
  withdraw_collateral: "Withdraw collateral",
  withdraw_supply: "Withdraw supply",
};

function RowAction({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Button size="xs" borderRadius="full" variant={active ? "solid" : "outline"} bg={active ? "ink" : undefined} color={active ? "white" : undefined} onClick={onClick} aria-pressed={active}>
      {label}
    </Button>
  );
}

function Allocation() {
  const { risk, assetIndex } = useLending();
  const lines = (risk?.collateral ?? []).filter((line) => line.valueWad > ZERO).sort((a, b) => (b.valueWad > a.valueWad ? 1 : -1));
  const total = lines.reduce((sum, line) => sum + line.valueWad, ZERO);
  if (total === ZERO) {
    return (
      <Text textStyle="sm" color="fg.muted">
        No priced collateral yet.
      </Text>
    );
  }
  const share = (value: bigint) => Number((value * BigInt(10_000)) / total) / 100;
  return (
    <Stack gap="4">
      <Flex h="3" borderRadius="full" overflow="hidden" bg="bg.muted" role="img" aria-label="Collateral allocation by asset">
        {lines.map((line, index) => (
          <Box key={line.tokenId} h="full" w={`${share(line.valueWad)}%`} bg={BAR_COLORS[index % BAR_COLORS.length]} borderLeftWidth={index ? "2px" : 0} borderColor="bg.panel" />
        ))}
      </Flex>
      <SimpleGrid columns={{ base: 1, sm: 2 }} gap="2">
        {lines.map((line, index) => {
          const asset = assetIndex.get(line.tokenId);
          return (
            <HStack key={line.tokenId} justify="space-between" textStyle="sm">
              <HStack gap="2">
                <Box w="2.5" h="2.5" borderRadius="sm" bg={BAR_COLORS[index % BAR_COLORS.length]} />
                <TokenAvatar symbol={asset?.config.symbol ?? "?"} category={asset?.config.category} size="xs" />
                <Text>{asset?.config.symbol ?? line.tokenId}</Text>
                {asset ? (
                  <Text color="fg.muted" textStyle="xs">
                    {CATEGORY_LABEL[asset.config.category]}
                  </Text>
                ) : null}
              </HStack>
              <Text fontFamily="mono" textStyle="xs">
                {share(line.valueWad).toFixed(2)}% · {formatUsdWad(line.valueWad, { compact: true })}
              </Text>
            </HStack>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <Text py="3" textStyle="sm" color="fg.muted">
      {text}
    </Text>
  );
}

export function PortfolioView() {
  const lending = useLending();
  const totals = usePortfolioTotals();
  const [selection, setSelection] = useState<Selection>(null);
  const risk = lending.risk;
  const market = lending.market;
  const loading = lending.accountState === "loading" && !lending.account;
  const select = (kind: LendingActionKind, tokenId: string) => setSelection((current) => (current?.kind === kind && current.tokenId === tokenId ? null : { kind, tokenId }));
  const isSelected = (kind: LendingActionKind, tokenId: string) => selection?.kind === kind && selection.tokenId === tokenId;
  const supplied = Object.entries(lending.holdings.supplied).filter(([, amount]) => amount > ZERO);

  return (
    <Container maxW="6xl" px="4" py={{ base: "6", md: "10" }}>
      <PageHeader title="Portfolio" description="Collateral, borrowed assets and outstanding debt including accrued interest, read live from the lending contract." />
      <ModeBanner />
      <Stack gap="5">
        <MarketNotice />
        <AccountNotice />
        <SummaryTiles totals={totals} />

        {selection ? (
          <Section
            title={`${ACTION_TITLE[selection.kind] ?? selection.kind} · ${lending.assetIndex.get(selection.tokenId)?.config.symbol ?? ""}`}
            action={<CloseButton size="sm" onClick={() => setSelection(null)} />}
          >
            <ActionForm key={`${selection.kind}-${selection.tokenId}`} kind={selection.kind} tokenId={selection.tokenId} onDone={() => setSelection(null)} />
          </Section>
        ) : null}

        <Section title="Collateral" description="Locked on the lending contract until the debt it backs allows a withdrawal.">
          {loading ? (
            <SkeletonRows rows={2} />
          ) : !risk || risk.collateral.length === 0 ? (
            <EmptyRow text="No collateral deposited." />
          ) : (
            <Table.ScrollArea>
              <Table.Root size="sm" interactive>
                <Table.Header>
                  <Table.Row bg="transparent">
                    <Table.ColumnHeader>Asset</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">Amount</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">Value</Table.ColumnHeader>
                    <Table.ColumnHeader>Oracle price</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">LTV / liquidation</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">Liquidation price</Table.ColumnHeader>
                    <Table.ColumnHeader />
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {risk.collateral.map((line) => {
                    const asset = lending.assetIndex.get(line.tokenId);
                    const liqPrice = market ? liquidationPriceWad(market.assets, lending.holdings, line.tokenId, market.nowMs) : null;
                    return (
                      <Table.Row key={line.tokenId} bg="transparent">
                        <Table.Cell>{asset ? <AssetLabel asset={asset} showCategory /> : line.tokenId}</Table.Cell>
                        <Table.Cell textAlign="end" fontFamily="mono">
                          {asset ? amountOf(asset, line.amount, 4) : "–"}
                        </Table.Cell>
                        <Table.Cell textAlign="end" fontFamily="mono">
                          {formatUsdWad(line.valueWad)}
                        </Table.Cell>
                        <Table.Cell>{asset ? <PriceTag asset={asset} check={line.price} /> : "–"}</Table.Cell>
                        <Table.Cell textAlign="end" fontFamily="mono">
                          {asset ? `${formatBpsPercent(asset.config.ltv_bps, 0)} / ${formatBpsPercent(asset.config.liquidation_threshold_bps, 0)}` : "–"}
                        </Table.Cell>
                        <Table.Cell textAlign="end" fontFamily="mono">
                          {liqPrice === null ? "–" : formatPriceWad(liqPrice)}
                        </Table.Cell>
                        <Table.Cell>
                          <HStack justify="flex-end" gap="1.5">
                            <RowAction label="Add" active={isSelected("deposit_collateral", line.tokenId)} onClick={() => select("deposit_collateral", line.tokenId)} />
                            <RowAction label="Withdraw" active={isSelected("withdraw_collateral", line.tokenId)} onClick={() => select("withdraw_collateral", line.tokenId)} />
                          </HStack>
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>
            </Table.ScrollArea>
          )}
        </Section>

        <Section title="Borrowed" description="Outstanding debt grows with the borrow index; amounts include interest accrued so far.">
          {loading ? (
            <SkeletonRows rows={2} />
          ) : !risk || risk.debt.length === 0 ? (
            <EmptyRow text="No outstanding debt." />
          ) : (
            <Table.ScrollArea>
              <Table.Root size="sm" interactive>
                <Table.Header>
                  <Table.Row bg="transparent">
                    <Table.ColumnHeader>Asset</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">Owed</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">Value</Table.ColumnHeader>
                    <Table.ColumnHeader>Oracle price</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">Borrow APR</Table.ColumnHeader>
                    <Table.ColumnHeader />
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {risk.debt.map((line) => {
                    const asset = lending.assetIndex.get(line.tokenId);
                    return (
                      <Table.Row key={line.tokenId} bg="transparent">
                        <Table.Cell>{asset ? <AssetLabel asset={asset} showCategory /> : line.tokenId}</Table.Cell>
                        <Table.Cell textAlign="end" fontFamily="mono">
                          {asset ? amountOf(asset, line.amount, 6) : "–"}
                        </Table.Cell>
                        <Table.Cell textAlign="end" fontFamily="mono">
                          {formatUsdWad(line.valueWad)}
                        </Table.Cell>
                        <Table.Cell>{asset ? <PriceTag asset={asset} check={line.price} /> : "–"}</Table.Cell>
                        <Table.Cell textAlign="end" fontFamily="mono">
                          {asset ? formatBpsPercent(asset.borrow_apr_bps) : "–"}
                        </Table.Cell>
                        <Table.Cell>
                          <HStack justify="flex-end">
                            <RowAction label="Repay" active={isSelected("repay", line.tokenId)} onClick={() => select("repay", line.tokenId)} />
                          </HStack>
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>
            </Table.ScrollArea>
          )}
        </Section>

        {supplied.length > 0 ? (
          <Section title="Supplied liquidity" description="Assets lent to the pool; they earn the supply APR.">
            <Table.ScrollArea>
              <Table.Root size="sm" interactive>
                <Table.Header>
                  <Table.Row bg="transparent">
                    <Table.ColumnHeader>Asset</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">Amount</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">Supply APR</Table.ColumnHeader>
                    <Table.ColumnHeader />
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {supplied.map(([tokenId, amount]) => {
                    const asset = lending.assetIndex.get(tokenId);
                    return (
                      <Table.Row key={tokenId} bg="transparent">
                        <Table.Cell>{asset ? <AssetLabel asset={asset} showCategory /> : tokenId}</Table.Cell>
                        <Table.Cell textAlign="end" fontFamily="mono">
                          {asset ? amountOf(asset, amount, 4) : amount.toString()}
                        </Table.Cell>
                        <Table.Cell textAlign="end" fontFamily="mono">
                          {asset ? formatBpsPercent(asset.supply_apr_bps) : "–"}
                        </Table.Cell>
                        <Table.Cell>
                          <HStack justify="flex-end">
                            <RowAction label="Withdraw" active={isSelected("withdraw_supply", tokenId)} onClick={() => select("withdraw_supply", tokenId)} />
                          </HStack>
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>
            </Table.ScrollArea>
          </Section>
        ) : null}

        <Section title="Asset allocation" description="Share of collateral value by asset at current oracle prices.">
          <Allocation />
        </Section>
      </Stack>
    </Container>
  );
}
