"use client";

import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="Portfolio value"
          value={totals ? formatUsdWad(totals.netWad, { compact: true }) : dash}
          hint="Collateral + supplied − debt"
          className="col-span-2 sm:col-span-1"
        />
        <StatTile label="Total collateral" value={totals ? formatUsdWad(totals.collateralWad, { compact: true }) : dash} />
        <StatTile label="Total borrowed" value={totals ? formatUsdWad(totals.debtWad, { compact: true }) : dash} hint="Incl. accrued interest" />
        <StatTile
          label="Available to borrow"
          value={totals ? formatUsdWad(totals.availableWad, { compact: true }) : dash}
          hint={totals ? `Limit ${formatUsdWad(totals.borrowLimitWad, { compact: true })}` : undefined}
        />
        <StatTile
          label="Health factor"
          value={totals ? <HealthValue value={totals.healthFactorWad} /> : dash}
          hint="Liquidation below 1.00"
          className="col-span-2 sm:col-span-1"
        />
      </dl>
      {totals ? <LimitMeter usedBps={totals.limitUsedBps} /> : null}
    </div>
  );
}

/** Market-level problems: contract unreadable, or (simulation) reference prices unavailable. */
export function MarketNotice() {
  const { marketsError, priceFeed, mode } = useLending();
  if (marketsError) {
    return <Note tone="bad">Lending markets could not be loaded: {marketsError}</Note>;
  }
  if (mode !== "simulation" || !priceFeed) return null;
  if (priceFeed.error) {
    return (
      <Note tone="bad">
        Reference prices are unavailable ({priceFeed.error}). Without a fresh price no borrow is allowed, exactly as the
        contract&apos;s oracle would behave.
      </Note>
    );
  }
  if (priceFeed.missing.length > 0) {
    return (
      <Note tone="warn">
        No reference price for {priceFeed.missing.map((item) => `${item.symbol} (${item.reason})`).join(", ")}. Those test
        tokens cannot be borrowed or used to back a borrow until a price arrives.
      </Note>
    );
  }
  return null;
}

/** Explains whose positions are shown, and asks for a wallet when the chain needs one. */
export function AccountNotice() {
  const lending = useLending();
  const wallet = useNearWallet();

  if (lending.mode === "near" && !lending.walletAccountId) {
    return (
      <Note tone="neutral">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>Connect a NEAR {wallet.network} wallet to load your lending positions from the contract.</span>
          <Button size="sm" variant="outline" onClick={() => void wallet.signIn()} disabled={!wallet.ready || wallet.connecting}>
            <Wallet aria-hidden />
            Connect NEAR wallet
          </Button>
        </div>
      </Note>
    );
  }

  if (lending.isLocalSimAccount) {
    return (
      <Note tone="neutral">
        Simulated positions for a local browser account. Connect a NEAR wallet to keep a separate simulation per account
        (still nothing is signed).
      </Note>
    );
  }

  if (lending.accountError) return <Note tone="bad">Account could not be loaded: {lending.accountError}</Note>;
  return null;
}
