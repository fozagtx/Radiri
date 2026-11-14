"use client";

import { Box, DataList, HStack, Stack, Text } from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";
import {
  type ActionPreview,
  BPS,
  formatBpsPercent,
  formatPriceWad,
  formatTokenAmount,
  formatUsdWad,
  type Holdings,
  liquidationPriceWad,
  type MarketContext,
  mulDivUp,
  pricedAsset,
  ZERO,
} from "@/lib/risk";
import type { AccountRisk } from "@/lib/risk";
import { HealthValue, LimitMeter, PriceTag } from "./bits";

function limitUsedBps(risk: AccountRisk): number | null {
  if (risk.borrowLimitWad === ZERO) return risk.debtValueWad > ZERO ? 10_000 : null;
  return Number(mulDivUp(risk.debtValueWad, BPS, risk.borrowLimitWad));
}

function Row({ label, before, after, changed }: { label: string; before: React.ReactNode; after: React.ReactNode; changed: boolean }) {
  return (
    <DataList.Item py="1.5">
      <DataList.ItemLabel color="fg.muted" minW="40">
        {label}
      </DataList.ItemLabel>
      <DataList.ItemValue fontFamily="mono" justifyContent="flex-end">
        {changed ? (
          <HStack gap="1.5" wrap="wrap" justify="flex-end">
            <Text as="span" color="fg.muted">
              {before}
            </Text>
            <ArrowRight size={12} aria-label="becomes" />
            <Text as="span">{after}</Text>
          </HStack>
        ) : (
          after
        )}
      </DataList.ItemValue>
    </DataList.Item>
  );
}

/**
 * Before / after review of an action: health factor, borrow capacity, debt, LTV, the liquidation
 * price of the collateral in focus, APR, and the oracle prices the action depends on.
 */
export function ReviewPanel({
  preview,
  market,
  holdingsBefore,
  focusCollateralId,
}: {
  preview: ActionPreview;
  market: MarketContext;
  holdingsBefore: Holdings;
  focusCollateralId?: string | null;
}) {
  const { before, after, request } = preview;
  const asset = market.assets.get(request.tokenId);
  const focusId = focusCollateralId ?? (request.kind === "deposit_collateral" || request.kind === "withdraw_collateral" ? request.tokenId : null);
  const focusAsset = focusId ? market.assets.get(focusId) : undefined;
  const liqBefore = focusId ? liquidationPriceWad(market.assets, holdingsBefore, focusId, market.nowMs) : null;
  const liqAfter = focusId ? liquidationPriceWad(market.assets, preview.holdingsAfter, focusId, market.nowMs) : null;
  const usedBefore = limitUsedBps(before);
  const usedAfter = limitUsedBps(after);

  const priceRows = [asset, focusAsset && focusAsset !== asset ? focusAsset : undefined].filter(
    (item): item is NonNullable<typeof item> => !!item,
  );

  return (
    <Stack gap="3" borderWidth="1px" borderColor="border" bg="bg.subtle" borderRadius="xl" p="4">
      <Text textStyle="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase" letterSpacing="0.06em">
        Review
      </Text>
      <DataList.Root orientation="horizontal" size="sm" gap="0" divideY="1px" divideColor="border.muted">
        <Row
          label="Health factor"
          before={<HealthValue value={before.healthFactorWad} />}
          after={<HealthValue value={after.healthFactorWad} />}
          changed={before.healthFactorWad !== after.healthFactorWad}
        />
        <Row
          label="Borrow capacity left"
          before={formatUsdWad(before.availableToBorrowWad)}
          after={formatUsdWad(after.availableToBorrowWad)}
          changed={before.availableToBorrowWad !== after.availableToBorrowWad}
        />
        <Row
          label="Borrow limit"
          before={formatUsdWad(before.borrowLimitWad)}
          after={formatUsdWad(after.borrowLimitWad)}
          changed={before.borrowLimitWad !== after.borrowLimitWad}
        />
        <Row
          label="Debt"
          before={formatUsdWad(before.debtValueWad)}
          after={formatUsdWad(after.debtValueWad)}
          changed={before.debtValueWad !== after.debtValueWad}
        />
        <Row
          label="Loan to value"
          before={formatBpsPercent(before.ltvBps)}
          after={formatBpsPercent(after.ltvBps)}
          changed={before.ltvBps !== after.ltvBps}
        />
        {focusAsset ? (
          <Row
            label={`${focusAsset.config.symbol} liquidation price`}
            before={liqBefore === null ? "none" : formatPriceWad(liqBefore)}
            after={liqAfter === null ? "none" : formatPriceWad(liqAfter)}
            changed={liqBefore !== liqAfter}
          />
        ) : null}
        {asset && (request.kind === "borrow" || request.kind === "repay") ? (
          <Row label={`${asset.config.symbol} borrow APR`} before="" after={formatBpsPercent(asset.borrow_apr_bps)} changed={false} />
        ) : null}
        {asset && (request.kind === "supply" || request.kind === "withdraw_supply") ? (
          <Row label={`${asset.config.symbol} supply APR`} before="" after={formatBpsPercent(asset.supply_apr_bps)} changed={false} />
        ) : null}
        {preview.refund > ZERO && asset ? (
          <Row
            label="Refunded excess"
            before=""
            after={`${formatTokenAmount(preview.refund, asset.config.decimals)} ${asset.config.symbol}`}
            changed={false}
          />
        ) : null}
      </DataList.Root>
      <LimitMeter usedBps={usedAfter ?? usedBefore} label="Borrow limit used after" />
      <Box>
        <Text textStyle="xs" color="fg.muted" mb="1.5">
          Oracle prices (USD per whole token)
        </Text>
        <Stack gap="1.5">
          {priceRows.map((item) => (
            <HStack key={item.config.token_id} justify="space-between" wrap="wrap" textStyle="sm">
              <Text fontWeight="medium">{item.config.symbol}</Text>
              <PriceTag asset={item} check={pricedAsset(market.assets, item.config.token_id, market.nowMs).price} />
            </HStack>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
}
