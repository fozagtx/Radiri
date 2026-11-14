"use client";

import { Box, Button, Flex, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { Wallet } from "lucide-react";
import { BPS, formatUsdWad, mulDivUp, pricedAsset, valueWad, ZERO } from "@/lib/risk";
import { useNearWallet } from "@/lib/wallets/near";
import { HealthValue, LimitMeter, Note, StatTile } from "./bits";
import { useLending } from "./lending-provider";

export interface PortfolioTotals {
  collateralWad: bigint;
  suppliedWad: bigint;
  debtWad: bigint;
  /** collateral + supplied - debt (can be negative). */
  netWad: bigint;
  availableWad: bigint;
  borrowLimitWad: bigint;
  healthFactorWad: bigint | null;
  limitUsedBps: number | null;
  positions: number;
}

/** Totals from the account's positions, valued with the current oracle prices. */
export function usePortfolioTotals(): PortfolioTotals | null {
  const { risk, market, holdings } = useLending();
  if (!risk || !market) return null;
  let supplied = ZERO;
  for (const [tokenId, amount] of Object.entries(holdings.supplied)) {
    const priced = pricedAsset(market.assets, tokenId, market.nowMs);
    if (priced.asset && priced.priceWad) supplied += valueWad(amount, priced.priceWad, priced.asset.config.decimals);
  }
  const positions =
    risk.collateral.length + risk.debt.length + Object.values(holdings.supplied).filter((amount) => amount > ZERO).length;
  return {
    collateralWad: risk.collateralValueWad,
    suppliedWad: supplied,
    debtWad: risk.debtValueWad,
    netWad: risk.collateralValueWad + supplied - risk.debtValueWad,
    availableWad: risk.availableToBorrowWad,
    borrowLimitWad: risk.borrowLimitWad,
    healthFactorWad: risk.healthFactorWad,
    limitUsedBps:
      risk.borrowLimitWad === ZERO ? (risk.debtValueWad > ZERO ? 10_000 : null) : Number(mulDivUp(risk.debtValueWad, BPS, risk.borrowLimitWad)),
    positions,
  };
}

export function SummaryTiles({ totals }: { totals: PortfolioTotals | null }) {
  const dash = "–";
  return (
    <Stack gap="4">
      <SimpleGrid columns={{ base: 2, md: 3, xl: 5 }} gap="3">
        <StatTile label="Portfolio value" value={totals ? formatUsdWad(totals.netWad, { compact: true }) : dash} hint="Collateral + supplied − debt" />
        <StatTile label="Total collateral" value={totals ? formatUsdWad(totals.collateralWad, { compact: true }) : dash} />
        <StatTile label="Total borrowed" value={totals ? formatUsdWad(totals.debtWad, { compact: true }) : dash} hint="Incl. accrued interest" />
        <StatTile
          label="Available to borrow"
          value={totals ? formatUsdWad(totals.availableWad, { compact: true }) : dash}
          hint={totals ? `Limit ${formatUsdWad(totals.borrowLimitWad, { compact: true })}` : undefined}
        />
        <StatTile label="Health factor" value={totals ? <HealthValue value={totals.healthFactorWad} /> : dash} hint="Liquidation below 1.00" />
      </SimpleGrid>
      {totals ? <LimitMeter usedBps={totals.limitUsedBps} /> : null}
    </Stack>
  );
}

/** Market-level problems: contract unreadable, or on-chain oracle prices stale. */
export function MarketNotice() {
  const { marketsError, assets, oracle } = useLending();
  if (marketsError) {
    return <Note tone="bad">The lending contract could not be read: {marketsError}</Note>;
  }
  const stale = assets.filter((asset) => !asset.price_fresh).map((asset) => asset.config.symbol);
  if (stale.length === 0) return null;
  if (oracle.refreshing) {
    return <Note tone="neutral">Pushing fresh 1Click prices to the contract oracle for {stale.join(", ")}…</Note>;
  }
  return (
    <Note tone="warn">
      On-chain price for {stale.join(", ")} is stale, so the contract blocks borrowing and liquidation against it until a
      fresh price is reported{oracle.error ? ` (automatic refresh failed: ${oracle.error})` : ""}.
    </Note>
  );
}

/** Explains whose positions are shown, and asks for a wallet when the chain needs one. */
export function AccountNotice() {
  const lending = useLending();
  const wallet = useNearWallet();

  if (!lending.walletAccountId) {
    return (
      <Flex
        align="center"
        justify="space-between"
        wrap="wrap"
        gap="3"
        px="4"
        py="3"
        borderRadius="xl"
        borderWidth="1px"
        borderColor="border"
        bg="bg.panel"
      >
        <Box>
          <Text textStyle="sm" fontWeight="semibold">
            Connect your NEAR {wallet.network} wallet
          </Text>
          <Text textStyle="xs" color="fg.muted">
            Your positions are read from the lending contract, and every action is signed by you.
          </Text>
        </Box>
        <Button size="sm" borderRadius="full" bg="ink" color="white" _hover={{ bg: "#2a2a2a" }} onClick={() => void wallet.signIn()} disabled={!wallet.ready || wallet.connecting}>
          <Wallet size={15} aria-hidden />
          Connect NEAR wallet
        </Button>
      </Flex>
    );
  }

  if (lending.accountError) return <Note tone="bad">Account could not be loaded: {lending.accountError}</Note>;
  return null;
}
