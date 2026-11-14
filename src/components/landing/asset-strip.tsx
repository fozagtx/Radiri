"use client";

import { ChainLogo, TokenAvatar } from "@/components/app/token-avatar";

const STOCKS = [
  { symbol: "AAPL", name: "Apple" },
  { symbol: "TSLA", name: "Tesla" },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "META", name: "Meta" },
  { symbol: "HOOD", name: "Robinhood" },
];
const MEMES = ["PEPE", "SHIB", "DOGE", "MOG", "SPX", "WIF"];
const CHAINS = [
  { id: "eth", name: "Ethereum" },
  { id: "sol", name: "Solana" },
  { id: "bsc", name: "BNB Chain" },
  { id: "near", name: "NEAR" },
  { id: "base", name: "Base" },
  { id: "arb", name: "Arbitrum" },
];

/** Landing strip: the stocks, meme coins and chains the app works with, as real logos. */
export function AssetStrip() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-4 py-10">
      <p className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">Stocks, meme coins and chains in one place</p>
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
        {STOCKS.map((stock) => (
          <span key={stock.symbol} className="flex items-center gap-2 text-[14px] font-medium text-foreground/80">
            <TokenAvatar symbol={stock.symbol} category="stock" size="md" />
            {stock.name}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
        {MEMES.map((meme) => (
          <span key={meme} className="flex items-center gap-2 text-[14px] font-medium text-foreground/80">
            <TokenAvatar symbol={meme} category="meme" size="md" />
            {meme}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3 text-[13px] text-muted-foreground">
        {CHAINS.map((chain) => (
          <span key={chain.id} className="flex items-center gap-1.5">
            <ChainLogo chain={chain.id} className="size-5" />
            {chain.name}
          </span>
        ))}
        <span className="text-foreground/70">· settled by NEAR Intents</span>
      </div>
    </div>
  );
}
