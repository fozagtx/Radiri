"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { RadiriSwapQuote, SwapQuoteResult } from "@/lib/intents/types";

/** Two live dry-run 1Click quotes from a meme coin on one chain to a tokenized stock on another. */
const PAIRS = [
  {
    key: "pepe-aapl",
    from: { label: "PEPE · Ethereum", id: "nep141:eth-0x6982508145454ce325ddbe47a25d4ec3d2311933.omft.near" },
    to: { label: "AAPLon · BNB Chain", id: "nep141:bnb-0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4.omdep.near" },
    amount: "1000000000",
    amountLabel: "1B PEPE",
    dot: "lp-dot--intents",
  },
  {
    key: "wif-tsla",
    from: { label: "$WIF · Solana", id: "nep141:sol-b9c68f94ec8fd160137af8cdfe5e61cd68e2afba.omft.near" },
    to: { label: "TSLAon · BNB Chain", id: "nep141:bnb-0x2494b603319d4d9f9715c9f4496d9e0364b59d93.omdep.near" },
    amount: "500",
    amountLabel: "500 $WIF",
    dot: "lp-dot--rhea",
  },
];

type Result = { quote: RadiriSwapQuote } | { reason: string };

function trim(value: string, digits: number): string {
  const [whole, fraction = ""] = value.split(".");
  const cut = fraction.slice(0, digits).replace(/0+$/, "");
  return cut ? `${whole}.${cut}` : whole;
}

export function LiveQuote() {
  const [results, setResults] = useState<Record<string, Result>>({});

  useEffect(() => {
    const controller = new AbortController();
    for (const pair of PAIRS) {
      fetch("/api/swaps/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ originAssetId: pair.from.id, destinationAssetId: pair.to.id, amount: pair.amount, slippageBps: 100, dry: true }),
      })
        .then(async (res) => (await res.json()) as SwapQuoteResult)
        .then((body) => {
          if (controller.signal.aborted) return;
          setResults((current) => ({ ...current, [pair.key]: "quote" in body ? { quote: body.quote } : { reason: body.failure.reason } }));
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setResults((current) => ({ ...current, [pair.key]: { reason: error instanceof Error ? error.message : String(error) } }));
        });
    }
    return () => controller.abort();
  }, []);

  const done = Object.keys(results).length === PAIRS.length;

  return (
    <div className="lp-sheet">
      <div className="lp-sheet-head">
        <span className="lp-sheet-pair">Meme coins → tokenized stocks</span>
        <span className="lp-sheet-amount">NEAR Intents</span>
      </div>

      {PAIRS.map((pair) => {
        const result = results[pair.key];
        return (
          <div className="lp-source" key={pair.key}>
            <div>
              <div className="lp-source-name">
                <span className={`lp-dot ${pair.dot}`} aria-hidden />
                {pair.from.label}
              </div>
              <div className="lp-source-meta">
                {pair.amountLabel} → {pair.to.label}
                {result && "quote" in result && result.quote.etaSeconds !== null ? ` · ~${result.quote.etaSeconds}s` : ""}
              </div>
            </div>

            {result && "quote" in result ? (
              <div className="lp-source-figure lp-good">
                {trim(result.quote.amountOut, 4)}
                <small>{result.quote.destination.symbol} out</small>
              </div>
            ) : result ? (
              <div className="lp-gap">
                {result.reason}
                <div style={{ marginTop: 6 }}>
                  <span className="lp-pill lp-pill--bad">no route</span>
                </div>
              </div>
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
        <span>{done ? "live dry-run quotes" : "asking 1Click"}</span>
        <Link href="/swap" style={{ color: "var(--ink-2)", textDecoration: "underline" }}>
          swap
        </Link>
      </div>
    </div>
  );
}
