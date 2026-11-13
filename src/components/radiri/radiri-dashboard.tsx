"use client";

import { useEffect, useMemo, useState } from "react";
import type { CompareResponse, StableAsset } from "@/lib/radiri/types";
import { getStables, postCompare } from "./api";
import { AnalystPanel } from "./analyst-panel";
import { ComparisonTable } from "./comparison-table";
import { formatIso, toMessage } from "./format";
import { GapHero } from "./gap-hero";
import { MatrixPanel } from "./matrix-panel";
import { OpportunityList } from "./opportunities";
import { Panel } from "./panel";
import { RouteCards } from "./route-cards";
import { RouteForm, assetKey, parseAssetKey } from "./route-form";
import { SnapshotHistory } from "./snapshot-history";

const DEFAULT_FROM = "USDC:near";
const DEFAULT_TO = "USDT:near";
const DEFAULT_AMOUNT = "100000";

type Status = "idle" | "loading" | "ready";

export function RadiriDashboard() {
  const [assets, setAssets] = useState<StableAsset[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogNonce, setCatalogNonce] = useState(0);

  const [fromKey, setFromKey] = useState(DEFAULT_FROM);
  const [toKey, setToKey] = useState(DEFAULT_TO);
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);

  const [compare, setCompare] = useState<CompareResponse | null>(null);
  const [compareStatus, setCompareStatus] = useState<Status>("idle");
  const [compareError, setCompareError] = useState<string | null>(null);
  const [recheckNonce, setRecheckNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getStables(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setAssets(data);
        setCatalogError(null);
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setCatalogError(toMessage(caught));
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setCatalogLoading(false);
      });
    return () => controller.abort();
  }, [catalogNonce]);

  const catalogKeys = useMemo(() => new Set(assets.map(assetKey)), [assets]);
  const fallbackFrom = useMemo(() => assets.find((asset) => asset.chain === "near") ?? assets[0], [assets]);
  const fallbackTo = useMemo(() => {
    const near = assets.filter((asset) => asset.chain === "near");
    return near.find((asset) => asset.symbol !== fallbackFrom?.symbol) ?? assets[1] ?? fallbackFrom;
  }, [assets, fallbackFrom]);

  const fromValue = fallbackFrom && !catalogKeys.has(fromKey) ? assetKey(fallbackFrom) : fromKey;
  const toValue = fallbackTo && !catalogKeys.has(toKey) ? assetKey(fallbackTo) : toKey;

  const parsedAmount = Number(amount.replace(/,/g, "").trim());
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;

  useEffect(() => {
    if (!validAmount) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setCompareStatus("loading");
      setCompareError(null);
      postCompare({ from: parseAssetKey(fromValue), to: parseAssetKey(toValue), amount: parsedAmount }, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return;
          setCompare(data);
          setCompareStatus("ready");
        })
        .catch((caught) => {
          if (controller.signal.aborted) return;
          setCompareError(toMessage(caught));
          setCompareStatus("ready");
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fromValue, toValue, parsedAmount, validAmount, recheckNonce]);

  const loading = validAmount && compareStatus === "loading";
  const current = validAmount ? compare : null;
  const routes = current?.routes ?? [];
  const failures = current?.failures ?? [];
  const best = current?.best ?? null;

  return (
    <div className="flex flex-col gap-3">
      <RouteForm
        assets={assets}
        catalogLoading={catalogLoading}
        catalogError={catalogError}
        onRetryCatalog={() => {
          setCatalogLoading(true);
          setCatalogNonce((value) => value + 1);
        }}
        fromKey={fromValue}
        toKey={toValue}
        amount={amount}
        quoting={loading}
        onFromChange={setFromKey}
        onToChange={setToKey}
        onAmountChange={setAmount}
        onSwap={() => {
          setFromKey(toValue);
          setToKey(fromValue);
        }}
        onRecheck={() => setRecheckNonce((value) => value + 1)}
      />

      {!validAmount ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Enter an amount above zero to quote routes.
        </p>
      ) : null}

      <GapHero compare={current} loading={loading} error={validAmount ? compareError : null} />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="flex flex-col gap-3">
          <Panel
            title="Routes"
            description="One card per source, best amount first."
            action={
              current ? (
                <span className="font-mono text-[0.7rem] text-muted-foreground">
                  {routes.length} route{routes.length === 1 ? "" : "s"}, {failures.length} failure
                  {failures.length === 1 ? "" : "s"}
                </span>
              ) : null
            }
          >
            <RouteCards routes={routes} failures={failures} best={best} loading={loading} />
          </Panel>

          <Panel
            title="Source comparison"
            description="Every source on the same input, cost normalised to basis points."
          >
            <ComparisonTable routes={routes} failures={failures} best={best} loading={loading} />
          </Panel>

          <Panel
            title="Liquidity matrix"
            description="Quote every stablecoin pair at this size and look for gaps."
          >
            <MatrixPanel amount={validAmount ? parsedAmount : 0} />
          </Panel>
        </div>

        <div className="flex flex-col gap-3">
          <Panel
            title="Opportunities"
            description={
              current ? `Flagged for this quote, generated ${formatIso(current.generatedAt)}` : "Flagged for this quote."
            }
          >
            <OpportunityList opportunities={current?.opportunities ?? []} loading={loading && !current} />
          </Panel>

          <Panel title="AI analyst" description="NEAR AI Cloud reads this quote and explains it.">
            <AnalystPanel compare={current} loading={loading} />
          </Panel>
        </div>
      </div>

      <Panel
        title="On chain snapshots"
        description="Rows the monitor wrote to the Radiri registry contract, newest first."
      >
        <SnapshotHistory />
      </Panel>
    </div>
  );
}
