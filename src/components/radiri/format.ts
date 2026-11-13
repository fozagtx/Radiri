import type { RouteSource } from "@/lib/radiri/types";

export const SOURCE_LABEL: Record<RouteSource, string> = {
  "near-intents": "1Click",
  rhea: "Rhea",
};

export const SOURCE_KIND: Record<RouteSource, string> = {
  "near-intents": "NEAR Intents, cross-chain",
  rhea: "NEAR pools",
};

export const SOURCE_ORDER: RouteSource[] = ["near-intents", "rhea"];

export const INTENTS_URL = "https://intents.near.org";

const CHAIN_NAMES: Record<string, string> = {
  eth: "Ethereum",
  arb: "Arbitrum",
  base: "Base",
  sol: "Solana",
  near: "NEAR",
  bsc: "BNB Chain",
  pol: "Polygon",
  polygon: "Polygon",
  op: "Optimism",
  avax: "Avalanche",
  btc: "Bitcoin",
  ton: "TON",
  sui: "Sui",
  tron: "Tron",
  gnosis: "Gnosis",
  linea: "Linea",
  scroll: "Scroll",
};

export function chainLabel(chain: string): string {
  return CHAIN_NAMES[chain.toLowerCase()] ?? chain.toUpperCase();
}

const amountFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const tinyAmountFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
const usdFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const bpsFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const perTenKFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const priceFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

export function formatToken(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1) return amountFormat.format(value);
  return tinyAmountFormat.format(value);
}

export function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `$${usdFormat.format(value)}`;
}

export function formatBps(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  return `${bpsFormat.format(value)} bps`;
}

export function formatSignedBps(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  return `${value > 0 ? "+" : ""}${bpsFormat.format(value)} bps`;
}

export function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `$${priceFormat.format(value)}`;
}

export function perTenThousand(amountOut: number, amountIn: number): number | null {
  if (!Number.isFinite(amountOut) || !Number.isFinite(amountIn) || amountIn <= 0) return null;
  return (amountOut / amountIn) * 10_000;
}

export function formatPerTenThousand(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return perTenKFormat.format(value);
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "n/a";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const restSeconds = total % 60;
  if (minutes < 60) return restSeconds ? `${minutes}m ${restSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

function utcStamp(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function formatIso(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : utcStamp(date);
}

export function formatTimestampMs(ms: number): string {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? String(ms) : utcStamp(date);
}

export function formatPairId(pairId: string): string {
  return pairId.replace(":", " ").replace(">", " to ");
}

export function shortHash(value: string): string {
  return value.length > 26 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
}

export function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
