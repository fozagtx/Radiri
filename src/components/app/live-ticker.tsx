"use client";

import { useEffect, useRef, useState } from "react";
import { TokenAvatar } from "@/components/app/token-avatar";
import { cn } from "@/lib/utils";
import type { CatalogAsset } from "@/types/protocol";

/** Live 1Click prices for the headline tokenized stocks and meme coins, refreshed every 30 s. */
const STOCKS = ["AAPLon", "TSLAon", "NVDAon", "MSFTon", "AMZNon", "GOOGLon", "METAon", "SPYon", "QQQon"];
const MEMES = ["PEPE", "$WIF", "SHIB", "DOGE", "TRUMP", "BRETT", "MOG", "SPX", "PENGU", "BOME"];
const WANTED = [...STOCKS, ...MEMES];
const REFRESH_MS = 30_000;

interface Tick {
  symbol: string;
  category: string;
  chain: string;
  price: number;
  move: "up" | "down" | null;
}

function formatPrice(value: number): string {
  if (value >= 1) return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const digits = Math.max(2, -Math.floor(Math.log10(value)) + 2);
  return `$${value.toFixed(Math.min(digits, 10))}`;
}

export function LiveTicker({ className }: { className?: string }) {
  const [ticks, setTicks] = useState<Tick[]>([]);
  const previous = useRef(new Map<string, number>());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/assets?eligible=swap", { cache: "no-store" });
        if (!res.ok) return;
        const { assets } = (await res.json()) as { assets: CatalogAsset[] };
        const bySymbol = new Map<string, CatalogAsset>();
        for (const asset of assets) {
          if (!WANTED.includes(asset.symbol) || !asset.priceUsd || asset.priceUsd <= 0) continue;
          if (!bySymbol.has(asset.symbol)) bySymbol.set(asset.symbol, asset);
        }
        const next = WANTED.flatMap((symbol) => {
          const asset = bySymbol.get(symbol);
          if (!asset || !asset.priceUsd) return [];
          const before = previous.current.get(symbol);
          const move: Tick["move"] = before === undefined || before === asset.priceUsd ? null : asset.priceUsd > before ? "up" : "down";
          previous.current.set(symbol, asset.priceUsd);
          return [{ symbol, category: asset.category, chain: asset.chain, price: asset.priceUsd, move }];
        });
        if (!cancelled) setTicks(next);
      } catch {
        // The ticker is decoration; a failed refresh keeps the last prices.
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (ticks.length === 0) return <div className={cn("h-10 border-b border-foreground/8", className)} aria-hidden />;

  const row = (copy: number) =>
    ticks.map((tick) => (
      <span
        key={`${copy}-${tick.symbol}-${tick.price}`}
        className={cn(
          "inline-flex shrink-0 items-center gap-2 rounded-full px-2.5 py-1",
          tick.move === "up" && "radiri-flash-up",
          tick.move === "down" && "radiri-flash-down",
        )}
      >
        <TokenAvatar symbol={tick.symbol} category={tick.category} size="xs" />
        <span className="text-[12px] font-medium">{tick.symbol}</span>
        <span
          className={cn(
            "font-mono text-[12px] tabular-nums",
            tick.move === "up" ? "text-emerald-700 dark:text-emerald-400" : tick.move === "down" ? "text-destructive" : "text-foreground/70",
          )}
        >
          {formatPrice(tick.price)}
        </span>
      </span>
    ));

  return (
    <div
      className={cn("relative flex h-10 items-center overflow-hidden border-b border-foreground/8 bg-card/40", className)}
      aria-label="Live prices from NEAR Intents"
      role="region"
    >
      <span className="z-10 flex h-full shrink-0 items-center gap-1.5 border-r border-foreground/8 bg-background px-3 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
        <span className="radiri-live-dot size-1.5 rounded-full bg-emerald-600" aria-hidden />
        Live
      </span>
      <div className="relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_4%,black_96%,transparent)]">
        <div className="radiri-marquee flex w-max gap-2 pl-2">
          {row(0)}
          {row(1)}
        </div>
      </div>
    </div>
  );
}
