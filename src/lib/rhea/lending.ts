import "server-only";

import { fromBaseUnits } from "@/lib/intents/amounts";
import { getOneClickTokens } from "@/lib/intents/tokens";

/**
 * Read-only reader for RHEA Lending (formerly Burrow) on NEAR mainnet, `contract.main.burrow.near`.
 * Views used (shapes verified live 2026-11-13): `get_assets_paged({ from_index, limit })` -> [token_id, AssetDetailed][],
 * `get_config({})`, and NEP-148 `ft_metadata({})` on each token for symbol/decimals.
 * Balances are in "inner" units: token decimals + config.extra_decimals.
 */

export const RHEA_LENDING_CONTRACT = "contract.main.burrow.near";
const MAINNET_RPC = "https://rpc.mainnet.fastnear.com";
const TIMEOUT_MS = 15_000;
const PAGE = 100;
const METADATA_TTL_MS = 6 * 60 * 60_000;
const SNAPSHOT_TTL_MS = 30_000;
const MS_PER_YEAR = 31_536_000_000;
const RATE_ONE = BigInt(10) ** BigInt(27);

interface Pool {
  shares: string;
  balance: string;
}

interface BurrowAssetConfig {
  reserve_ratio: number;
  target_utilization: number;
  target_utilization_rate: string;
  max_utilization_rate: string;
  volatility_ratio: number;
  extra_decimals: number;
  can_deposit: boolean;
  can_withdraw: boolean;
  can_use_as_collateral: boolean;
  can_borrow: boolean;
  supplied_limit?: string | null;
  borrowed_limit?: string | null;
}

interface BurrowAsset {
  supplied: Pool;
  borrowed: Pool;
  reserved: string;
  prot_fee?: string;
  last_update_timestamp: string;
  config: BurrowAssetConfig;
}

export interface BurrowConfig {
  oracle_account_id: string;
  pyth_oracle_account_id?: string;
  owner_id: string;
  max_num_assets: number;
  maximum_recency_duration_sec: number;
  maximum_staleness_duration_sec: number;
  pyth_price_valid_duration_sec?: number;
  enable_price_oracle?: boolean;
  enable_pyth_oracle?: boolean;
  contract_mode?: string;
  [key: string]: unknown;
}

export interface RheaReserve {
  tokenId: string;
  symbol: string;
  name: string | null;
  /** Token decimals from ft_metadata; null when the token exposes none (e.g. LP shadow tokens). */
  decimals: number | null;
  extraDecimals: number;
  /** Exact human amounts (null when decimals are unknown); raw inner-unit strings alongside. */
  supplied: string | null;
  borrowed: string | null;
  reserved: string | null;
  suppliedRaw: string;
  borrowedRaw: string;
  reservedRaw: string;
  /** borrowed / (supplied + reserved + protocol fee), 0..1. */
  utilization: number;
  /**
   * Annualised rates DERIVED from the contract's piecewise rate model at the current utilization
   * (per-ms rate compounded over a year). Reference only; the contract is authoritative.
   */
  borrowApyDerived: number;
  supplyApyDerived: number;
  canDeposit: boolean;
  canWithdraw: boolean;
  canUseAsCollateral: boolean;
  canBorrow: boolean;
  /** Collateral factor, basis points of 10_000. */
  volatilityRatioBps: number;
  reserveRatioBps: number;
  targetUtilizationBps: number;
  suppliedLimitRaw: string | null;
  borrowedLimitRaw: string | null;
  lastUpdate: string;
  /** USD price from the live 1Click catalog when 1Click lists this NEAR token; null otherwise. */
  priceUsd: number | null;
  priceSource: "1click" | null;
  suppliedUsd: number | null;
  borrowedUsd: number | null;
}

export interface RheaLendingSnapshot {
  contractId: string;
  rpcUrl: string;
  config: BurrowConfig;
  reserves: RheaReserve[];
  fetchedAt: string;
}

async function mainnetView<T>(contractId: string, method: string, args: object): Promise<T> {
  const res = await fetch(MAINNET_RPC, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "radiri",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contractId,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`NEAR RPC HTTP ${res.status} for ${contractId}.${method}`);
  const json = (await res.json()) as {
    error?: { data?: unknown; message?: string; cause?: { name?: string } };
    result?: { result?: number[]; error?: string };
  };
  if (json.error) {
    const detail = typeof json.error.data === "string" ? json.error.data : (json.error.cause?.name ?? json.error.message);
    throw new Error(`${contractId}.${method}: ${detail ?? "RPC error"}`);
  }
  if (json.result?.error) throw new Error(`${contractId}.${method}: ${json.result.error}`);
  if (!Array.isArray(json.result?.result)) throw new Error(`${contractId}.${method}: empty RPC result`);
  return JSON.parse(Buffer.from(json.result.result).toString("utf8")) as T;
}

const metadataCache = new Map<string, { at: number; meta: { symbol: string; name: string | null; decimals: number | null } }>();

async function tokenMetadata(tokenId: string) {
  const cached = metadataCache.get(tokenId);
  if (cached && Date.now() - cached.at < METADATA_TTL_MS) return cached.meta;
  let meta: { symbol: string; name: string | null; decimals: number | null };
  try {
    const raw = await mainnetView<{ symbol?: string; name?: string; decimals?: number }>(tokenId, "ft_metadata", {});
    meta = {
      symbol: raw.symbol || tokenId,
      name: raw.name ?? null,
      decimals: Number.isInteger(raw.decimals) ? (raw.decimals as number) : null,
    };
  } catch {
    meta = { symbol: tokenId, name: null, decimals: null };
  }
  metadataCache.set(tokenId, { at: Date.now(), meta });
  return meta;
}

/** Rate above 1.0 (scaled 1e27) as a float; the per-ms excess is ~1e-12, well inside double precision. */
function excess(rate: string): number {
  return Number(BigInt(rate) - RATE_ONE) / 1e27;
}

/** Piecewise-linear per-ms rate excess at `utilization` (Burrow AssetConfig::get_rate). */
export function burrowRateExcess(config: Pick<BurrowAssetConfig, "target_utilization" | "target_utilization_rate" | "max_utilization_rate">, utilization: number): number {
  const target = config.target_utilization / 10_000;
  const atTarget = excess(config.target_utilization_rate);
  const atMax = excess(config.max_utilization_rate);
  if (utilization <= 0) return 0;
  if (utilization < target) return (utilization * atTarget) / target;
  return atTarget + ((utilization - target) * (atMax - atTarget)) / (1 - target);
}

function toApy(perMsExcess: number): number {
  return Math.expm1(Math.log1p(perMsExcess) * MS_PER_YEAR);
}

function human(raw: string, decimals: number | null, extra: number): string | null {
  if (decimals === null) return null;
  try {
    return fromBaseUnits(raw, decimals + extra);
  } catch {
    return null;
  }
}

let snapshotCache: { at: number; snapshot: RheaLendingSnapshot } | null = null;

export async function getRheaLending(force = false): Promise<RheaLendingSnapshot> {
  if (!force && snapshotCache && Date.now() - snapshotCache.at < SNAPSHOT_TTL_MS) return snapshotCache.snapshot;

  const [config, entries] = await Promise.all([
    mainnetView<BurrowConfig>(RHEA_LENDING_CONTRACT, "get_config", {}),
    (async () => {
      const all: [string, BurrowAsset][] = [];
      for (let from = 0; ; from += PAGE) {
        const page = await mainnetView<[string, BurrowAsset][]>(RHEA_LENDING_CONTRACT, "get_assets_paged", {
          from_index: from,
          limit: PAGE,
        });
        all.push(...page);
        if (page.length < PAGE) break;
      }
      return all;
    })(),
  ]);

  let prices = new Map<string, number>();
  try {
    const { tokens } = await getOneClickTokens();
    prices = new Map(
      tokens
        .filter((token) => token.blockchain === "near" && token.contractAddress && typeof token.price === "number" && token.price > 0)
        .map((token) => [token.contractAddress as string, token.price as number]),
    );
  } catch {
    // Prices are optional context for the reserves table.
  }

  const reserves = await Promise.all(
    entries.map(async ([tokenId, asset]): Promise<RheaReserve> => {
      const meta = await tokenMetadata(tokenId);
      const extra = asset.config.extra_decimals ?? 0;
      const supplied = BigInt(asset.supplied.balance);
      const borrowed = BigInt(asset.borrowed.balance);
      const total = supplied + BigInt(asset.reserved || "0") + BigInt(asset.prot_fee || "0");
      const utilization = total > BigInt(0) ? Number((borrowed * BigInt(1_000_000)) / total) / 1_000_000 : 0;
      const borrowApy = borrowed > BigInt(0) ? toApy(burrowRateExcess(asset.config, utilization)) : 0;
      const supplyApy = borrowApy * utilization * (1 - asset.config.reserve_ratio / 10_000);
      const suppliedHuman = human(asset.supplied.balance, meta.decimals, extra);
      const borrowedHuman = human(asset.borrowed.balance, meta.decimals, extra);
      const price = prices.get(tokenId) ?? null;
      return {
        tokenId,
        symbol: meta.symbol,
        name: meta.name,
        decimals: meta.decimals,
        extraDecimals: extra,
        supplied: suppliedHuman,
        borrowed: borrowedHuman,
        reserved: human(asset.reserved || "0", meta.decimals, extra),
        suppliedRaw: asset.supplied.balance,
        borrowedRaw: asset.borrowed.balance,
        reservedRaw: asset.reserved || "0",
        utilization,
        borrowApyDerived: borrowApy,
        supplyApyDerived: supplyApy,
        canDeposit: asset.config.can_deposit,
        canWithdraw: asset.config.can_withdraw,
        canUseAsCollateral: asset.config.can_use_as_collateral,
        canBorrow: asset.config.can_borrow,
        volatilityRatioBps: asset.config.volatility_ratio,
        reserveRatioBps: asset.config.reserve_ratio,
        targetUtilizationBps: asset.config.target_utilization,
        suppliedLimitRaw: asset.config.supplied_limit ?? null,
        borrowedLimitRaw: asset.config.borrowed_limit ?? null,
        lastUpdate: new Date(Number(BigInt(asset.last_update_timestamp) / BigInt(1_000_000))).toISOString(),
        priceUsd: price,
        priceSource: price !== null ? "1click" : null,
        suppliedUsd: price !== null && suppliedHuman !== null ? Number(suppliedHuman) * price : null,
        borrowedUsd: price !== null && borrowedHuman !== null ? Number(borrowedHuman) * price : null,
      };
    }),
  );

  const snapshot: RheaLendingSnapshot = {
    contractId: RHEA_LENDING_CONTRACT,
    rpcUrl: MAINNET_RPC,
    config,
    reserves,
    fetchedAt: new Date().toISOString(),
  };
  snapshotCache = { at: Date.now(), snapshot };
  return snapshot;
}
