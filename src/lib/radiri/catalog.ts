import { classifyToken, isDeprecatedToken, type OneClickTokenRow } from "@/config/assets";
import { fromBaseUnits as exactFromBaseUnits, toBaseUnits as exactToBaseUnits } from "@/lib/intents/amounts";
import { getOneClickTokens } from "@/lib/intents/tokens";
import { numberToDecimalString } from "@/lib/oracle/wad";
import type { Chain, StableAsset } from "./types";

/**
 * Stablecoin view of the live 1Click catalog for the route monitor (/routes, /api/stables, MCP).
 * Rows come from the shared, cached `/v0/tokens` fetch in src/lib/intents and are filtered to the
 * "stable" category of src/config/assets. Rows are never synthesized.
 */

export interface CatalogSnapshot {
  assets: StableAsset[];
  fetchedAt: string;
}

function toStableAsset(token: OneClickTokenRow): StableAsset {
  return {
    assetId: token.assetId,
    symbol: token.symbol,
    chain: token.blockchain,
    decimals: token.decimals,
    priceUsd: typeof token.price === "number" && Number.isFinite(token.price) ? token.price : null,
    contractAddress: token.contractAddress ?? null,
  };
}

function isStable(token: OneClickTokenRow): boolean {
  return (
    typeof token.assetId === "string" &&
    typeof token.symbol === "string" &&
    Number.isInteger(token.decimals) &&
    !isDeprecatedToken(token) &&
    classifyToken(token) === "stable"
  );
}

function compareAssets(a: StableAsset, b: StableAsset): number {
  return a.symbol.localeCompare(b.symbol) || a.chain.localeCompare(b.chain) || a.assetId.localeCompare(b.assetId);
}

/** Live stablecoin catalog (the underlying token list is cached in-process for 60 s). */
export async function getCatalog(force = false): Promise<CatalogSnapshot> {
  const { tokens, fetchedAt } = await getOneClickTokens(force);
  return { assets: tokens.filter(isStable).map(toStableAsset).sort(compareAssets), fetchedAt };
}

export async function getStableAssets(): Promise<StableAsset[]> {
  const { assets } = await getCatalog();
  return assets;
}

export async function findAsset(symbol: string, chain: Chain): Promise<StableAsset | null> {
  const assets = await getStableAssets();
  const wantSymbol = symbol.trim().toUpperCase();
  const wantChain = chain.trim().toLowerCase();
  return assets.find((asset) => asset.symbol.toUpperCase() === wantSymbol && asset.chain.toLowerCase() === wantChain) ?? null;
}

/** `"USDC" + "eth"` -> `"USDC:eth"`. */
export function assetLabel(asset: Pick<StableAsset, "symbol" | "chain">): string {
  return `${asset.symbol}:${asset.chain}`;
}

/**
 * Human units (a JS number from the compare API) -> integer string in the token's smallest unit.
 * Exact: the number's shortest decimal form is converted with string math; digits beyond the
 * token's decimals are truncated.
 */
export function toBaseUnits(human: number, decimals: number): string {
  if (!Number.isFinite(human) || human <= 0) throw new Error(`Invalid amount: ${human}`);
  const decimal = numberToDecimalString(human);
  const [whole, fraction = ""] = decimal.split(".");
  const trimmed = fraction.slice(0, decimals);
  const base = exactToBaseUnits(trimmed ? `${whole}.${trimmed}` : whole, decimals);
  if (BigInt(base) <= BigInt(0)) throw new Error(`Invalid amount: ${human} is below one base unit`);
  return base;
}

/** Integer string in the token's smallest unit -> human units (display number for the route monitor). */
export function fromBaseUnits(base: string | bigint, decimals: number): number {
  return Number(exactFromBaseUnits(base, decimals));
}
