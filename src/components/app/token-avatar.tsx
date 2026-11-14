import Image from "next/image";
import { siNvidia, siRobinhood, siTesla, type SimpleIcon } from "simple-icons";
import { cn } from "@/lib/utils";
import { BRAND_LOGOS } from "./brand-logos";

/**
 * Real logos only:
 *   - meme coins and chains: the projects' own logo images from the Trust Wallet assets repository,
 *     or the NEAR token's on-chain NEP-148 icon, served from /public/logos (scripts/fetch-logos.mjs);
 *   - tokenized stocks: the company's brand mark (Apple, Google, Amazon, Meta, Microsoft, Intel from
 *     scripts/gen-brand-logos.mjs; Tesla, NVIDIA, Robinhood from simple-icons) on a white app-icon tile.
 * Assets with no published logo get a plain ticker tile. Test tokens share their reference's mark:
 * tPEPE shows PEPE, tAAPL and AAPLon show Apple. Meme coins are round, stocks are rounded squares.
 */
export function baseTicker(symbol: string): string {
  let ticker = symbol.replace(/^\$/, "");
  if (/^t[A-Z]/.test(ticker)) ticker = ticker.slice(1);
  if (/[A-Z]on$/.test(ticker)) ticker = ticker.slice(0, -2);
  return ticker.toUpperCase();
}

/** Ticker -> file in /public/logos/coins (Trust Wallet assets, or the token's on-chain NEP-148 icon). */
const COIN_IMAGES: Record<string, string> = {
  PEPE: "pepe.png",
  SHIB: "shib.png",
  MOG: "mog.png",
  SPX: "spx.png",
  TURBO: "turbo.png",
  BRETT: "brett.png",
  WIF: "wif.png",
  BOME: "bome.png",
  TRUMP: "trump.png",
  PENGU: "pengu.png",
  MELANIA: "melania.png",
  BONK: "bonk.png",
  DOGE: "doge.png",
  NEAR: "near.png",
  WNEAR: "near.png",
  BLACKDRAGON: "blackdragon.jpg",
  SHITZU: "shitzu.webp",
  ABG: "abg.webp",
  GNEAR: "gnear.svg",
  JAMBO: "jambo.webp",
  NOEAR: "noear.webp",
  PURGE: "purge.webp",
};

const SIMPLE_STOCKS: Record<string, { icon: SimpleIcon; fg: string; bg: string }> = {
  TSLA: { icon: siTesla, fg: "#CC0000", bg: "#ffffff" },
  NVDA: { icon: siNvidia, fg: "#76B900", bg: "#ffffff" },
  HOOD: { icon: siRobinhood, fg: "#191919", bg: "#CCFF00" },
};

const CHAIN_IMAGES = new Set(["eth", "sol", "bsc", "near", "base", "arb", "pol", "op", "avax", "doge"]);

const SIZES = { xs: 20, sm: 28, md: 36, lg: 44, xl: 56 } as const;
export type TokenAvatarSize = keyof typeof SIZES;

function Mark({ symbol, category, size }: { symbol: string; category?: string; size: TokenAvatarSize }) {
  const ticker = baseTicker(symbol);
  const px = SIZES[size];
  const stock = category === "stock";
  const radius = stock ? Math.round(px * 0.28) : px / 2;
  const tile: React.CSSProperties = {
    width: px,
    height: px,
    borderRadius: radius,
    flexShrink: 0,
    display: "inline-grid",
    placeItems: "center",
    overflow: "hidden",
  };

  const brand = stock ? BRAND_LOGOS[ticker] : undefined;
  if (brand) {
    return (
      <span style={{ ...tile, background: "#ffffff", boxShadow: "inset 0 0 0 1px rgba(25,25,25,0.1)" }} title={brand.title}>
        <svg
          viewBox={`0 0 ${brand.width} ${brand.height}`}
          width={Math.round(px * 0.6)}
          height={Math.round(px * 0.6)}
          role="img"
          aria-label={`${brand.title} logo`}
          dangerouslySetInnerHTML={{ __html: brand.body }}
        />
      </span>
    );
  }

  const simple = stock ? SIMPLE_STOCKS[ticker] : undefined;
  if (simple) {
    return (
      <span style={{ ...tile, background: simple.bg, boxShadow: "inset 0 0 0 1px rgba(25,25,25,0.1)" }} title={simple.icon.title}>
        <svg viewBox="0 0 24 24" width={Math.round(px * 0.58)} height={Math.round(px * 0.58)} role="img" aria-label={`${simple.icon.title} logo`}>
          <path d={simple.icon.path} fill={simple.fg} />
        </svg>
      </span>
    );
  }

  const coin = !stock ? COIN_IMAGES[ticker] : undefined;
  if (coin) {
    return (
      <span style={tile}>
        <Image src={`/logos/coins/${coin}`} alt={`${ticker} logo`} width={px} height={px} unoptimized={coin.endsWith(".svg")} style={{ width: px, height: px, objectFit: "cover" }} />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      style={{
        ...tile,
        background: stock ? "#191919" : "#eeece5",
        color: stock ? "#fbfaf5" : "#191919",
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        fontWeight: 600,
        fontSize: Math.max(7, Math.round(px * (ticker.length > 3 ? 0.24 : 0.3))),
        letterSpacing: "-0.02em",
      }}
    >
      {ticker.slice(0, 4)}
    </span>
  );
}

export function ChainLogo({ chain, className, size = 20 }: { chain: string; className?: string; size?: number }) {
  const id = chain.toLowerCase();
  if (!CHAIN_IMAGES.has(id)) return null;
  return <Image src={`/logos/chains/${id}.png`} alt={`${chain} network`} width={size} height={size} className={cn("rounded-full", className)} style={{ width: size, height: size }} />;
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
  const badge = Math.max(10, Math.round(SIZES[size] * 0.42));
  const hasChain = chain ? CHAIN_IMAGES.has(chain.toLowerCase()) : false;
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <Mark symbol={symbol} category={category} size={size} />
      {hasChain && chain ? (
        <span style={{ position: "absolute", right: -3, bottom: -3, borderRadius: "50%", background: "#ffffff", padding: 1, lineHeight: 0 }}>
          <ChainLogo chain={chain} size={badge} />
        </span>
      ) : null}
    </span>
  );
}

/** Two overlapping marks: collateral and the asset borrowed against it (or a swap pair). */
export function TokenPair({ from, to, size = "md" }: { from: { symbol: string; category?: string }; to: { symbol: string; category?: string }; size?: TokenAvatarSize }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      <TokenAvatar symbol={from.symbol} category={from.category} size={size} />
      <span style={{ marginLeft: -Math.round(SIZES[size] * 0.28), filter: "drop-shadow(-2px 0 0 #ffffff)" }}>
        <TokenAvatar symbol={to.symbol} category={to.category} size={size} />
      </span>
    </span>
  );
}
