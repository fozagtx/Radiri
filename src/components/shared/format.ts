import { lendingAssetByTokenId } from "@/config/lending-assets";
import { formatTokenAmount, type HealthBand, u128OrZero } from "@/lib/risk";
import type { AssetView, LendingCategory } from "@/types/protocol";

export type Tone = "neutral" | "good" | "warn" | "bad";

export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-foreground",
  good: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  bad: "text-destructive",
};

export const TONE_FILL: Record<Tone, string> = {
  neutral: "bg-foreground/70",
  good: "bg-emerald-600 dark:bg-emerald-400",
  warn: "bg-amber-500 dark:bg-amber-400",
  bad: "bg-destructive",
};

export const TONE_PILL: Record<Tone, string> = {
  neutral: "border-foreground/15 text-foreground/70",
  good: "border-emerald-600/30 bg-emerald-600/8 text-emerald-700 dark:text-emerald-400",
  warn: "border-amber-500/40 bg-amber-500/8 text-amber-700 dark:text-amber-400",
  bad: "border-destructive/30 bg-destructive/6 text-destructive",
};

export function bandTone(band: HealthBand): Tone {
  switch (band) {
    case "safe":
      return "good";
    case "warn":
      return "warn";
    case "danger":
    case "liquidatable":
      return "bad";
    default:
      return "neutral";
  }
}

export const CATEGORY_LABEL: Record<LendingCategory, string> = {
  meme: "Meme coin",
  stock: "Tokenized stock",
  stable: "Stablecoin",
  major: "Major",
};

/** Human name of a test token from the canonical table, if it is one. */
export function assetName(tokenId: string): string | undefined {
  return lendingAssetByTokenId(tokenId)?.name;
}

export function referenceOf(tokenId: string): { symbol: string; source: string } | undefined {
  const spec = lendingAssetByTokenId(tokenId);
  return spec ? { symbol: spec.referenceSymbol, source: "1Click" } : undefined;
}

export function isTestToken(asset: AssetView): boolean {
  return /test/i.test(assetName(asset.config.token_id) ?? "") || asset.config.symbol.startsWith("t");
}

export function amountOf(asset: AssetView | undefined, value: bigint | string, digits = 6): string {
  if (!asset) return String(value);
  const big = typeof value === "string" ? u128OrZero(value) : value;
  return formatTokenAmount(big, asset.config.decimals, digits);
}

export function symbolOf(assets: Map<string, AssetView>, tokenId: string): string {
  return assets.get(tokenId)?.config.symbol ?? tokenId;
}

export function formatDateTime(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return String(ms);
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
