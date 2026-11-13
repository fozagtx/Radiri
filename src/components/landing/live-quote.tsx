"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CompareResponse, RouteSource } from "@/lib/radiri/types";
import { postCompare } from "@/components/radiri/api";
import { formatBps, formatEta, formatToken } from "@/components/radiri/format";

const FROM = { symbol: "USDC", chain: "near" };
const TO = { symbol: "USDT", chain: "near" };
const AMOUNT = 10_000;
const ORDER: RouteSource[] = ["near-intents", "rhea"];

const META: Record<RouteSource, { label: string; kind: string; dot: string }> = {
  "near-intents": { label: "NEAR Intents", kind: "1Click, cross-chain", dot: "lp-dot--intents" },
  rhea: { label: "Rhea", kind: "NEAR pools", dot: "lp-dot--rhea" },
};

const amountFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function LiveQuote() {
  const [data, setData] = useState<CompareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    postCompare({ from: FROM, to: TO, amount: AMOUNT }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="lp-sheet">
      <div className="lp-sheet-head">
        <span className="lp-sheet-pair">
          USDC on NEAR <span aria-hidden>→</span> USDT on NEAR
        </span>
        <span className="lp-sheet-amount">{formatToken(AMOUNT)} in</span>
      </div>

      {ORDER.map((source) => {
        const route = data?.routes.find((item) => item.source === source);
        const failure = data?.failures.find((item) => item.source === source);

        return (
          <div className="lp-source" key={source}>
            <div>
              <div className="lp-source-name">
                <span className={`lp-dot ${META[source].dot}`} aria-hidden />
                {META[source].label}
              </div>
              <div className="lp-source-meta">
                {route
                  ? `${formatBps(route.costBps)} · ${formatEta(route.etaSeconds)}`
                  : failure
                    ? META[source].kind
                    : META[source].kind}
              </div>
            </div>

            {route ? (
              <div className="lp-source-figure lp-good">
                {amountFormat.format(route.amountOut)}
                <small>{route.to.symbol} out</small>
              </div>
            ) : failure ? (
              <div className="lp-gap">
                {failure.reason}
                <div style={{ marginTop: 6 }}>
                  <span className="lp-pill lp-pill--bad">no route</span>
                </div>
              </div>
            ) : error ? (
              <div className="lp-gap">{error}</div>
            ) : (
              <div className="lp-source-figure" style={{ color: "var(--ink-3)", fontSize: 14 }}>
                quoting
                <small>dry run</small>
              </div>
            )}
          </div>
        );
      })}

      <div className="lp-sheet-foot">
        <span>{error ? "quote failed" : data ? "live dry-run quote" : "reading both sources"}</span>
        <Link href="/dashboard" style={{ color: "var(--ink-2)", textDecoration: "underline" }}>
          full comparison
        </Link>
      </div>
    </div>
  );
}
