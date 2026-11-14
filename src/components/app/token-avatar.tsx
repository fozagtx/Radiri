import NetworkArbitrumOne from "@web3icons/react/icons/networks/NetworkArbitrumOne";
import NetworkAvalanche from "@web3icons/react/icons/networks/NetworkAvalanche";
import NetworkBase from "@web3icons/react/icons/networks/NetworkBase";
import NetworkBinanceSmartChain from "@web3icons/react/icons/networks/NetworkBinanceSmartChain";
import NetworkEthereum from "@web3icons/react/icons/networks/NetworkEthereum";
import NetworkNearProtocol from "@web3icons/react/icons/networks/NetworkNearProtocol";
import NetworkOptimism from "@web3icons/react/icons/networks/NetworkOptimism";
import NetworkPolygon from "@web3icons/react/icons/networks/NetworkPolygon";
import NetworkSolana from "@web3icons/react/icons/networks/NetworkSolana";
import TokenDOGE from "@web3icons/react/icons/tokens/TokenDOGE";
import TokenMOG from "@web3icons/react/icons/tokens/TokenMOG";
import TokenNEAR from "@web3icons/react/icons/tokens/TokenNEAR";
import TokenPEPE from "@web3icons/react/icons/tokens/TokenPEPE";
import TokenSHIB from "@web3icons/react/icons/tokens/TokenSHIB";
import TokenSPX from "@web3icons/react/icons/tokens/TokenSPX";
import TokenXAUT from "@web3icons/react/icons/tokens/TokenXAUT";
import { siApple, siCircle, siGoogle, siIntel, siMeta, siNvidia, siRobinhood, siTesla, type SimpleIcon } from "simple-icons";
import { cn } from "@/lib/utils";

/**
 * Token marks. Real logos where an open icon set has them (web3icons for coins and chains, MIT;
 * simple-icons for company brands, CC0), otherwise a pastel tile with the ticker's initials.
 * Meme coins are round, tokenized stocks are rounded squares, so the two classes read apart.
 * Test tokens share their reference's mark: tPEPE shows PEPE, tAAPL and AAPLon show Apple.
 */
export function baseTicker(symbol: string): string {
  let ticker = symbol.replace(/^\$/, "");
  if (/^t[A-Z]/.test(ticker)) ticker = ticker.slice(1);
  if (/[A-Z]on$/.test(ticker)) ticker = ticker.slice(0, -2);
  return ticker.toUpperCase();
}

type IconComponent = typeof TokenPEPE;

const COIN_LOGOS: Record<string, IconComponent> = {
  PEPE: TokenPEPE,
  SHIB: TokenSHIB,
  MOG: TokenMOG,
  SPX: TokenSPX,
  DOGE: TokenDOGE,
  NEAR: TokenNEAR,
  WNEAR: TokenNEAR,
  XAUT: TokenXAUT,
};

const STOCK_LOGOS: Record<string, SimpleIcon> = {
  AAPL: siApple,
  TSLA: siTesla,
  NVDA: siNvidia,
  GOOGL: siGoogle,
  META: siMeta,
  INTC: siIntel,
  HOOD: siRobinhood,
  CRCL: siCircle,
};

const CHAIN_LOGOS: Record<string, IconComponent> = {
  eth: NetworkEthereum,
  sol: NetworkSolana,
  bsc: NetworkBinanceSmartChain,
  near: NetworkNearProtocol,
  base: NetworkBase,
  arb: NetworkArbitrumOne,
  pol: NetworkPolygon,
  op: NetworkOptimism,
  avax: NetworkAvalanche,
};

function hueOf(ticker: string): number {
  let hash = 0;
  for (const char of ticker) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

/** Relative luminance of a #rrggbb colour, 0..1. */
function luminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const SIZES = {
  xs: { box: "size-5", text: "text-[7.5px]", px: 20, badge: "size-2.5" },
  sm: { box: "size-7", text: "text-[9px]", px: 28, badge: "size-3" },
  md: { box: "size-9", text: "text-[11px]", px: 36, badge: "size-3.5" },
  lg: { box: "size-11", text: "text-[13px]", px: 44, badge: "size-4" },
  xl: { box: "size-14", text: "text-[16px]", px: 56, badge: "size-5" },
} as const;

export type TokenAvatarSize = keyof typeof SIZES;

function Mark({ symbol, category, size }: { symbol: string; category?: string; size: TokenAvatarSize }) {
  const ticker = baseTicker(symbol);
  const stock = category === "stock";
  const dims = SIZES[size];
  const shape = stock ? "rounded-[30%]" : "rounded-full";

  const brand = stock ? STOCK_LOGOS[ticker] : undefined;
  if (brand) {
    const dark = luminance(brand.hex) < 0.55;
    return (
      <span
        className={cn("inline-grid shrink-0 place-items-center overflow-hidden", shape, dims.box)}
        style={{ background: `#${brand.hex}` }}
      >
        <svg viewBox="0 0 24 24" className="size-[58%]" role="img" aria-label={`${brand.title} logo`}>
          <path d={brand.path} fill={dark ? "#ffffff" : "#191919"} />
        </svg>
      </span>
    );
  }

  const Coin = !stock ? COIN_LOGOS[ticker] : undefined;
  if (Coin) {
    return (
      <span className={cn("inline-grid shrink-0 place-items-center overflow-hidden", shape, dims.box)}>
        <Coin variant="branded" size={dims.px} className="size-full" aria-label={`${ticker} logo`} />
      </span>
    );
  }

  const hue = hueOf(ticker);
  return (
    <span
      aria-hidden
      className={cn("inline-grid shrink-0 place-items-center border font-mono font-semibold tracking-tight select-none", shape, dims.box, dims.text)}
      style={{ background: `oklch(0.93 0.05 ${hue})`, borderColor: `oklch(0.8 0.08 ${hue})`, color: `oklch(0.35 0.09 ${hue})` }}
    >
      {ticker.slice(0, ticker.length > 4 ? 3 : 4)}
    </span>
  );
}

export function ChainLogo({ chain, className }: { chain: string; className?: string }) {
  const Logo = CHAIN_LOGOS[chain.toLowerCase()];
  if (!Logo) return null;
  return <Logo variant="branded" className={cn("rounded-full", className)} aria-label={`${chain} network`} />;
}

export function TokenAvatar({
  symbol,
  category,
  chain,
  size = "md",
  className,
}: {
  symbol: string;
  category?: string;
  /** 1Click chain id; adds a small network badge when known. */
  chain?: string;
  size?: TokenAvatarSize;
  className?: string;
}) {
  const hasChain = chain ? Boolean(CHAIN_LOGOS[chain.toLowerCase()]) : false;
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <Mark symbol={symbol} category={category} size={size} />
      {hasChain && chain ? (
        <span className="absolute -right-0.5 -bottom-0.5 rounded-full bg-card p-px ring-1 ring-card">
          <ChainLogo chain={chain} className={SIZES[size].badge} />
        </span>
      ) : null}
    </span>
  );
}

/** Two overlapping marks: collateral and the asset borrowed against it (or a swap pair). */
export function TokenPair({
  from,
  to,
  size = "md",
}: {
  from: { symbol: string; category?: string };
  to: { symbol: string; category?: string };
  size?: TokenAvatarSize;
}) {
  return (
    <span className="inline-flex items-center">
      <TokenAvatar symbol={from.symbol} category={from.category} size={size} className="rounded-full ring-2 ring-card" />
      <TokenAvatar symbol={to.symbol} category={to.category} size={size} className="-ml-3 ring-2 ring-card" />
    </span>
  );
}
