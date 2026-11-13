import { quoteOneClick } from "./adapters/oneclick";
import { quoteRhea } from "./adapters/rhea";
import { assetLabel, findAsset, getStableAssets } from "./catalog";
import { deriveMatrixOpportunities, deriveOpportunities, pairKey } from "./opportunities";
import type {
  CompareRequest,
  CompareResponse,
  MatrixCell,
  MatrixResponse,
  PairRef,
  RouteFailure,
  RouteQuote,
  StableAsset,
} from "./types";

const DEFAULT_SLIPPAGE_BPS = 50;
const MAX_SLIPPAGE_BPS = 5_000;
/** 1Click is a shared public endpoint; keep the matrix sweep polite. */
const MATRIX_CONCURRENCY = 4;

/** Chains and symbols swept by `/api/matrix` by default. */
const MATRIX_CHAINS = ["near", "eth", "arb", "base", "sol"];
const MATRIX_SYMBOLS = ["USDC", "USDT"];

/** Bad input from the caller (HTTP 400). Anything else is an upstream failure. */
export class CompareInputError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "CompareInputError";
  }
}

export function pairId(from: { symbol: string; chain: string }, to: { symbol: string; chain: string }): string {
  return pairKey(from, to);
}

export function pairRef(asset: StableAsset): PairRef {
  return { symbol: asset.symbol, chain: asset.chain };
}

function isFailure(value: RouteQuote | RouteFailure): value is RouteFailure {
  return "reason" in value;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeSlippage(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_SLIPPAGE_BPS;
  if (value < 0 || value > MAX_SLIPPAGE_BPS) {
    throw new CompareInputError(`slippageBps must be between 0 and ${MAX_SLIPPAGE_BPS}, got ${value}`);
  }
  return Math.round(value);
}

async function requireAsset(ref: PairRef): Promise<StableAsset> {
  if (!ref || typeof ref.symbol !== "string" || typeof ref.chain !== "string" || !ref.symbol || !ref.chain) {
    throw new CompareInputError("from and to must each be { symbol, chain }");
  }
  const asset = await findAsset(ref.symbol, ref.chain);
  if (!asset) {
    throw new CompareInputError(`No stablecoin ${ref.symbol} on chain "${ref.chain}". GET /api/stables for the live list.`);
  }
  return asset;
}

function requireAmount(value: number): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new CompareInputError(`amount must be a positive number, got ${value}`);
  return amount;
}

async function mapPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Runs every source in parallel for one pair and size, then ranks the quotes. */
export async function compareRoutes(request: CompareRequest): Promise<CompareResponse> {
  const amount = requireAmount(request.amount);
  const slippageBps = normalizeSlippage(request.slippageBps);
  const [from, to] = await Promise.all([requireAsset(request.from), requireAsset(request.to)]);
  if (from.assetId === to.assetId) throw new CompareInputError(`${assetLabel(from)} to ${assetLabel(to)} is the same asset`);

  const params = { from, to, amount, slippageBps };
  const settled = await Promise.allSettled([quoteOneClick(params), quoteRhea(params)]);

  const routes: RouteQuote[] = [];
  const failures: RouteFailure[] = [];
  settled.forEach((outcome, index) => {
    const source = index === 0 ? "near-intents" : "rhea";
    if (outcome.status === "fulfilled") {
      if (isFailure(outcome.value)) failures.push(outcome.value);
      else routes.push(outcome.value);
    } else {
      failures.push({ source, from, to, reason: messageOf(outcome.reason), kind: "error" });
    }
  });

  routes.sort((a, b) => b.amountOut - a.amountOut || a.costBps - b.costBps);

  return {
    request: { from: pairRef(from), to: pairRef(to), amount, slippageBps },
    routes,
    failures,
    best: routes[0] ?? null,
    opportunities: deriveOpportunities(routes, failures),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Default sweep: every intra-chain stable pair on the sweep chains plus the same
 * stablecoin moved across chains — the shapes where liquidity gaps and
 * cross-chain spreads actually show up.
 */
export function defaultMatrixPairs(assets: StableAsset[]): { from: StableAsset; to: StableAsset }[] {
  const wanted = assets.filter(
    (asset) => MATRIX_CHAINS.includes(asset.chain.toLowerCase()) && MATRIX_SYMBOLS.includes(asset.symbol.toUpperCase()),
  );

  const pairs: { from: StableAsset; to: StableAsset }[] = [];
  const seen = new Set<string>();
  const push = (from: StableAsset, to: StableAsset) => {
    const key = `${from.assetId}>${to.assetId}`;
    if (from.assetId === to.assetId || seen.has(key)) return;
    seen.add(key);
    pairs.push({ from, to });
  };

  const byChain = new Map<string, StableAsset[]>();
  const bySymbol = new Map<string, StableAsset[]>();
  for (const asset of wanted) {
    const chain = asset.chain.toLowerCase();
    byChain.set(chain, [...(byChain.get(chain) ?? []), asset]);
    bySymbol.set(asset.symbol.toUpperCase(), [...(bySymbol.get(asset.symbol.toUpperCase()) ?? []), asset]);
  }

  for (const group of byChain.values()) {
    for (const from of group) {
      for (const to of group) push(from, to);
    }
  }

  for (const group of bySymbol.values()) {
    for (const from of group) {
      for (const to of group) push(from, to);
    }
  }

  return pairs;
}

export interface MatrixOptions {
  amount: number;
  slippageBps?: number;
  pairs?: { from: PairRef; to: PairRef }[];
  concurrency?: number;
}

/** Quotes a sweep of pairs and derives opportunities across all of them. */
export async function buildMatrix({ amount, slippageBps, pairs, concurrency }: MatrixOptions): Promise<MatrixResponse> {
  const size = requireAmount(amount);
  const tolerance = normalizeSlippage(slippageBps);

  let specs: { from: StableAsset; to: StableAsset }[];
  if (pairs?.length) {
    specs = await Promise.all(
      pairs.map(async (pair) => ({ from: await requireAsset(pair.from), to: await requireAsset(pair.to) })),
    );
  } else {
    specs = defaultMatrixPairs(await getStableAssets());
    if (specs.length === 0) throw new CompareInputError("the live catalog has no sweepable stablecoin pairs");
  }

  const cells = await mapPool(specs, concurrency ?? MATRIX_CONCURRENCY, async (spec): Promise<MatrixCell> => {
    const response = await compareRoutes({ from: pairRef(spec.from), to: pairRef(spec.to), amount: size, slippageBps: tolerance });
    return { from: spec.from, to: spec.to, best: response.best, failures: response.failures };
  });

  return {
    amount: size,
    generatedAt: new Date().toISOString(),
    cells,
    opportunities: deriveMatrixOpportunities(cells),
  };
}
