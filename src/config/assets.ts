import { NETWORK } from "@/lib/config";
import { TESTNET_DEPLOYMENT } from "./deployment";
import { viewCall } from "@/lib/near";
import type { AssetCategory, AssetView, CatalogAsset, LendingCategory } from "@/types/protocol";
import { LENDING_ASSETS, lendingAssetByTokenId } from "./lending-assets";

/**
 * Asset classification and eligibility.
 *
 * Category: every live 1Click token gets exactly one category from the explicit lists below
 * (symbol and CoinGecko id), checked in this order: stock, rwa, meme, stable, major, other.
 * Rows whose symbol carries "(DEPRECATED)" are dropped.
 *
 * Eligibility is explicit and independent (docs/ARCHITECTURE.md section 3):
 *   swap       = the asset is in the live 1Click catalog right now,
 *   collateral = registered on the lending contract with can_collateralize,
 *   borrow     = registered on the lending contract with can_borrow.
 * The lending registry is the on-chain `get_assets` view when NEXT_PUBLIC_LENDING_CONTRACT_ID is set,
 * otherwise the canonical LENDING_ASSETS table. Neither implies the other.
 */

/** Raw `GET /v0/tokens` row (structurally the SDK's TokenResponse). */
export interface OneClickTokenRow {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number | null;
  priceUpdatedAt?: string | null;
  contractAddress?: string | null;
  coingeckoId?: string | null;
}

/* ------------------------------------------------------------------ */
/* Category lists                                                      */
/* ------------------------------------------------------------------ */

/** Meme coins by symbol (upper case). */
export const MEME_SYMBOLS = new Set([
  "PEPE",
  "SHIB",
  "TURBO",
  "SPX",
  "MOG",
  "$WIF",
  "WIF",
  "BOME",
  "TRUMP",
  "PENGU",
  "MELANIA",
  "BRETT",
  "DOGE",
  "BLACKDRAGON",
  "SHITZU",
  "NEARKAT",
  "WNEARKAT",
  "CASHCAT",
  "PURGE",
  "JAMBO",
  "GNEAR",
  "NOEAR",
  "ABG",
]);

/** Meme coins by CoinGecko id, so a renamed symbol on a new chain is still caught. */
export const MEME_COINGECKO_IDS = new Set([
  "pepe",
  "shiba-inu",
  "turbo",
  "spx6900",
  "mog-coin",
  "dogwifcoin",
  "book-of-meme",
  "official-trump",
  "pudgy-penguins",
  "melania-meme",
  "based-brett",
  "dogecoin",
  "black-dragon",
  "shitzu",
  "nearkat",
  "nearkat-2",
  "cash-cat",
  "forgive-me-father",
  "jambo-2",
  "gnear",
  "noear",
  "abg",
]);

/** NEAR meme launchpad: every token minted by meme.cooking is a meme coin. */
const MEME_CONTRACT_SUFFIXES = [".meme-cooking.near"];

/**
 * Tokenized stocks and equity ETFs. tMU / nZHIPU are NEAR-native stock tokens 1Click lists with price 0;
 * the `…on` rows are Ondo Global Markets tokens on BNB Chain, listed by `/v0/tokens?ondoTokens=true`.
 */
export const STOCK_SYMBOLS = new Set([
  "TMU",
  "NZHIPU",
  "AAPLON",
  "AMZNON",
  "CRCLON",
  "GOOGLON",
  "HOODON",
  "INTCON",
  "METAON",
  "MRVLON",
  "MSFTON",
  "NVDAON",
  "TSLAON",
  "SPYON",
  "QQQON",
]);

/** Real-world assets that are not equities: tokenized gold, commodity and bond ETFs, managed portfolios. */
export const RWA_SYMBOLS = new Set([
  "XAUT",
  "GLDON",
  "IAUON",
  "SLVON",
  "AGGON",
  "TIPON",
  "TLTON",
  "SGOVON",
  "MAG7XON",
  "BRAINON",
  "YLD5ON",
  "YLD8ON",
  "BLKHION",
  "BLKDIGON",
  "BLKGRWON",
]);

/** Fiat-pegged stablecoins (upper case). Superset of the original route-monitor list. */
export const STABLE_SYMBOLS = new Set([
  "USDC",
  "USDT",
  "DAI",
  "USDS",
  "SUSDS",
  "USDE",
  "SUSDE",
  "USD1",
  "USDG",
  "PYUSD",
  "FRAX",
  "TUSD",
  "USDD",
  "RLUSD",
  "EURC",
  "GHO",
  "LUSD",
  "CRVUSD",
  "FDUSD",
  "USDP",
  "USDBC",
  "USDT0",
  "SDAI",
  "ALUSD",
  "MIM",
  "DOLA",
  "USDY",
  "USD0",
  "USDON",
  "USDF",
  "USAD",
  "USDCX",
  "XDAI",
  "EURE",
  "GBPE",
]);

/** Large-cap L1/L2 assets and their wrapped or liquid-staked forms. */
export const MAJOR_SYMBOLS = new Set([
  "BTC",
  "BTC(OMNI)",
  "WBTC",
  "CBBTC",
  "XBTC",
  "HEMIBTC",
  "STRKBTC",
  "ETH",
  "WETH",
  "WSTETH",
  "SOL",
  "NEAR",
  "WNEAR",
  "STNEAR",
  "BNB",
  "AVAX",
  "POL",
  "ARB",
  "OP",
  "TRX",
  "XRP",
  "ADA",
  "LTC",
  "BCH",
  "DASH",
  "ZEC",
  "SUI",
  "APT",
  "TON",
  "XLM",
  "STRK",
  "BERA",
  "MON",
  "XPL",
  "OKB",
]);

export const MAJOR_COINGECKO_IDS = new Set([
  "bitcoin",
  "wrapped-bitcoin",
  "coinbase-wrapped-btc",
  "hemi-bitcoin",
  "strkbtc",
  "ethereum",
  "wrapped-steth",
  "solana",
  "near",
  "wrapped-near",
  "staked-near",
  "binancecoin",
  "avalanche-2",
  "polygon-ecosystem-token",
  "arbitrum",
  "optimism",
  "tron",
  "ripple",
  "cardano",
  "litecoin",
  "bitcoin-cash",
  "dash",
  "zcash",
  "sui",
  "aptos",
  "the-open-network",
  "stellar",
  "starknet",
  "berachain-bera",
  "monad",
  "plasma",
  "okb",
]);

/** Display names where 1Click gives only a symbol. tMU from its on-chain ft_metadata. */
const KNOWN_NAMES: Record<string, string> = {
  TMU: "MU Test Stock",
  NZHIPU: "nZHIPU",
  XAUT: "Tether Gold",
};

export const CATEGORY_LABEL: Record<AssetCategory, string> = {
  meme: "Meme",
  stock: "Stock",
  stable: "Stable",
  major: "Major",
  rwa: "RWA",
  other: "Other",
};

export const ASSET_CATEGORIES: AssetCategory[] = ["meme", "stock", "stable", "major", "rwa", "other"];

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

export function isDeprecatedToken(token: Pick<OneClickTokenRow, "symbol">): boolean {
  return /\(deprecated\)/i.test(token.symbol);
}

export function classifyToken(
  token: Pick<OneClickTokenRow, "symbol" | "coingeckoId" | "contractAddress" | "assetId">,
): AssetCategory {
  const symbol = token.symbol.trim().toUpperCase();
  const gecko = (token.coingeckoId ?? "").trim().toLowerCase();
  const contract = (token.contractAddress ?? token.assetId ?? "").toLowerCase();

  if (STOCK_SYMBOLS.has(symbol)) return "stock";
  if (RWA_SYMBOLS.has(symbol)) return "rwa";
  // New Ondo listings not yet in the explicit lists: equities by CoinGecko id, other Ondo products as RWA.
  if (gecko.endsWith("-ondo-tokenized-stock")) return "stock";
  if (gecko.includes("ondo-tokenized")) return "rwa";
  if (MEME_SYMBOLS.has(symbol) || MEME_COINGECKO_IDS.has(gecko)) return "meme";
  if (MEME_CONTRACT_SUFFIXES.some((suffix) => contract.endsWith(suffix))) return "meme";
  if (STABLE_SYMBOLS.has(symbol)) return "stable";
  if (MAJOR_SYMBOLS.has(symbol) || MAJOR_COINGECKO_IDS.has(gecko)) return "major";
  return "other";
}

function prettyCoingeckoName(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => (part.length <= 3 && part !== "and" ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
}

function displayName(token: OneClickTokenRow): string | undefined {
  const known = KNOWN_NAMES[token.symbol.toUpperCase()];
  if (known) return known;
  if (token.coingeckoId && !token.coingeckoId.startsWith("custom:")) return prettyCoingeckoName(token.coingeckoId);
  return undefined;
}

/** 1Click reports price 0 for tokens it cannot price; that is "no price", not "worth nothing". */
function usablePrice(price: number | null | undefined): number | null {
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
}

/* ------------------------------------------------------------------ */
/* Lending registry (collateral / borrow eligibility)                  */
/* ------------------------------------------------------------------ */

export interface LendingRegistryEntry {
  tokenId: string;
  symbol: string;
  name?: string;
  decimals: number;
  category: LendingCategory;
  canCollateralize: boolean;
  canBorrow: boolean;
  paused: boolean;
  isTestToken: boolean;
  referenceSymbol?: string;
  /** On-chain oracle price (lending contract only). */
  priceUsd: number | null;
  priceUpdatedAt: string | null;
}

export interface LendingRegistry {
  source: "lending-contract" | "lending-assets-table";
  contractId: string | null;
  entries: LendingRegistryEntry[];
  /** Set when the configured contract could not be read; entries is then empty. */
  error?: string;
}

export function registryFromTable(): LendingRegistry {
  return {
    source: "lending-assets-table",
    contractId: null,
    entries: LENDING_ASSETS.map((spec) => ({
      tokenId: spec.config.token_id,
      symbol: spec.config.symbol,
      name: spec.name,
      decimals: spec.config.decimals,
      category: spec.config.category,
      canCollateralize: spec.config.can_collateralize,
      canBorrow: spec.config.can_borrow,
      paused: spec.config.paused,
      isTestToken: true,
      referenceSymbol: spec.referenceSymbol,
      priceUsd: null,
      priceUpdatedAt: null,
    })),
  };
}

const WAD_DIGITS = 18;

/** price_wad (USD per whole token x 1e18) -> number, display only. */
export function wadToNumber(wad: string): number | null {
  if (!/^\d+$/.test(wad)) return null;
  const padded = wad.padStart(WAD_DIGITS + 1, "0");
  const value = Number(`${padded.slice(0, -WAD_DIGITS)}.${padded.slice(-WAD_DIGITS)}`);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function registryFromAssetViews(views: AssetView[], contractId: string, testnet: boolean): LendingRegistry {
  return {
    source: "lending-contract",
    contractId,
    entries: views.map((view) => {
      const spec = lendingAssetByTokenId(view.config.token_id);
      return {
        tokenId: view.config.token_id,
        symbol: view.config.symbol,
        name: spec?.name,
        decimals: view.config.decimals,
        category: view.config.category,
        canCollateralize: view.config.can_collateralize,
        canBorrow: view.config.can_borrow,
        paused: view.config.paused,
        isTestToken: Boolean(spec) || testnet,
        referenceSymbol: spec?.referenceSymbol,
        priceUsd: view.price ? wadToNumber(view.price.price_wad) : null,
        priceUpdatedAt: view.price && view.price.timestamp_ms > 0 ? new Date(view.price.timestamp_ms).toISOString() : null,
      };
    }),
  };
}

/** The NEAR testnet lending contract (env override, else the committed deployment). */
export function lendingContractId(): string | null {
  return process.env.NEXT_PUBLIC_LENDING_CONTRACT_ID?.trim() || TESTNET_DEPLOYMENT.lendingContractId;
}

/**
 * The on-chain registry (`get_assets` over NEAR RPC) when a lending contract is configured, otherwise
 * the LENDING_ASSETS table. A configured but unreadable contract yields an empty registry with `error`,
 * never the table: eligibility must not claim what the chain does not confirm.
 */
export async function loadLendingRegistry(): Promise<LendingRegistry> {
  const contractId = lendingContractId();
  if (!contractId) return registryFromTable();
  try {
    const views = await viewCall<AssetView[]>(contractId, "get_assets", {});
    if (!Array.isArray(views)) throw new Error("get_assets returned a non-array payload");
    return registryFromAssetViews(views, contractId, NETWORK !== "mainnet");
  } catch (error) {
    return {
      source: "lending-contract",
      contractId,
      entries: [],
      error: `${contractId}.get_assets failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */

/**
 * Merges the live 1Click catalog with the lending registry into one classified list.
 * 1Click rows: origin "1click-live", swap = true. A 1Click NEAR token whose account id is registered on
 * the lending contract also gets that registry's collateral/borrow flags. Registry rows that are not in
 * 1Click (testnet test tokens) are appended with swap = false.
 */
export function buildCatalog(tokens: OneClickTokenRow[], registry: LendingRegistry): CatalogAsset[] {
  const registryByToken = new Map(registry.entries.map((entry) => [entry.tokenId, entry]));
  const matched = new Set<string>();
  const assets: CatalogAsset[] = [];

  for (const token of tokens) {
    if (!token || typeof token.assetId !== "string" || typeof token.symbol !== "string") continue;
    if (!Number.isInteger(token.decimals) || isDeprecatedToken(token)) continue;
    const chain = String(token.blockchain).toLowerCase();
    const contractAddress = token.contractAddress ?? null;
    const lending = chain === "near" && contractAddress ? registryByToken.get(contractAddress) : undefined;
    if (lending) matched.add(lending.tokenId);
    const priceUsd = usablePrice(token.price);
    assets.push({
      id: token.assetId,
      symbol: token.symbol,
      name: displayName(token),
      chain,
      decimals: token.decimals,
      category: classifyToken(token),
      contractAddress,
      priceUsd,
      priceUpdatedAt: priceUsd !== null ? (token.priceUpdatedAt ?? null) : null,
      eligibility: {
        swap: true,
        collateral: Boolean(lending && lending.canCollateralize && !lending.paused),
        borrow: Boolean(lending && lending.canBorrow && !lending.paused),
      },
      origin: "1click-live",
      isTestToken: false,
    });
  }

  for (const entry of registry.entries) {
    if (matched.has(entry.tokenId)) continue;
    assets.push({
      id: entry.tokenId,
      symbol: entry.symbol,
      name: entry.name,
      chain: "near",
      decimals: entry.decimals,
      category: entry.category,
      contractAddress: entry.tokenId,
      priceUsd: entry.priceUsd,
      priceUpdatedAt: entry.priceUpdatedAt,
      eligibility: {
        swap: false,
        collateral: entry.canCollateralize && !entry.paused,
        borrow: entry.canBorrow && !entry.paused,
      },
      origin: entry.isTestToken ? "testnet-test-token" : "lending-contract",
      isTestToken: entry.isTestToken,
      ...(entry.referenceSymbol ? { referenceSymbol: entry.referenceSymbol } : {}),
    });
  }

  return assets.sort(
    (a, b) =>
      ASSET_CATEGORIES.indexOf(a.category) - ASSET_CATEGORIES.indexOf(b.category) ||
      a.symbol.localeCompare(b.symbol) ||
      a.chain.localeCompare(b.chain) ||
      a.id.localeCompare(b.id),
  );
}

export type EligibilityFilter = "swap" | "collateral" | "borrow";

export function filterCatalog(
  assets: CatalogAsset[],
  filter: { category?: AssetCategory | null; eligible?: EligibilityFilter | null },
): CatalogAsset[] {
  return assets.filter(
    (asset) =>
      (!filter.category || asset.category === filter.category) &&
      (!filter.eligible || asset.eligibility[filter.eligible]),
  );
}

export function isAssetCategory(value: string | null | undefined): value is AssetCategory {
  return Boolean(value) && ASSET_CATEGORIES.includes(value as AssetCategory);
}

export function isEligibilityFilter(value: string | null | undefined): value is EligibilityFilter {
  return value === "swap" || value === "collateral" || value === "borrow";
}
