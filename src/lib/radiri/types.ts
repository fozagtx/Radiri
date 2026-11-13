/**
 * Shared contract between the Radiri data layer (src/lib/radiri, src/app/api)
 * and the UI (src/app pages, src/components/radiri). Change only by agreement.
 */

/** 1Click blockchain id, e.g. "eth", "arb", "base", "sol", "near". */
export type Chain = string;

export interface StableAsset {
  /** 1Click asset id, e.g. "nep141:eth-0xa0b8...omft.near" */
  assetId: string;
  symbol: string; // "USDC" | "USDT" | "DAI" | "USD1" | "USDe" ...
  chain: Chain;
  decimals: number;
  priceUsd: number | null;
  /** Token contract on its own chain (NEAR account id for chain "near"). */
  contractAddress: string | null;
}

export type RouteSource = "near-intents" | "rhea";

export interface RouteQuote {
  source: RouteSource;
  from: StableAsset;
  to: StableAsset;
  /** Human units of `from`. */
  amountIn: number;
  /** Human units of `to`. */
  amountOut: number;
  /** Worst case after slippage, human units of `to`. */
  minAmountOut: number;
  /**
   * Execution cost vs. a 1:1 peg, in basis points:
   * (amountIn - amountOut) / amountIn * 10_000. Negative = user receives more than sent.
   */
  costBps: number;
  /** Same but against minAmountOut. */
  worstCaseCostBps: number;
  /** Explicit fees reported by the source, in units of `from` where known. */
  fees: { label: string; amount: number; unit: string }[];
  etaSeconds: number | null;
  /** Slippage tolerance used for the quote, bps. */
  slippageBps: number;
  quotedAt: string; // ISO
  /** Source-specific payload needed to execute (e.g. 1Click quoteRequest). Never contains secrets. */
  execution?: unknown;
}

export interface RouteFailure {
  source: RouteSource;
  from: StableAsset;
  to: StableAsset;
  /** Verbatim reason from the source when available, e.g. "No liquidity available". */
  reason: string;
  kind: "no-liquidity" | "unsupported" | "error";
}

export type OpportunityKind =
  | "liquidity-gap" // a source has no route for a pair/size another source can fill
  | "expensive-route" // costBps above threshold
  | "cross-chain-spread" // same stable pair is meaningfully cheaper via another chain
  | "source-divergence"; // two sources disagree on the same pair by > threshold

export interface Opportunity {
  kind: OpportunityKind;
  severity: "info" | "warn" | "high";
  title: string;
  detail: string;
  from: { symbol: string; chain: Chain };
  to: { symbol: string; chain: Chain };
  metricBps?: number;
}

export interface PairRef {
  symbol: string;
  chain: Chain;
}

export interface CompareRequest {
  from: PairRef;
  to: PairRef;
  /** Human units of the `from` token, e.g. 10000 */
  amount: number;
  slippageBps?: number; // default 50
}

export interface CompareResponse {
  request: CompareRequest;
  /** Sorted best (highest amountOut) first. */
  routes: RouteQuote[];
  failures: RouteFailure[];
  best: RouteQuote | null;
  opportunities: Opportunity[];
  generatedAt: string;
}

export interface MatrixCell {
  from: StableAsset;
  to: StableAsset;
  best: RouteQuote | null;
  failures: RouteFailure[];
}

export interface MatrixResponse {
  amount: number;
  generatedAt: string;
  cells: MatrixCell[];
  opportunities: Opportunity[];
}

export interface AnalystRequest {
  compare: CompareResponse;
  question?: string;
}

export interface AnalystResponse {
  model: string;
  text: string;
  /** Present when NEAR AI Cloud returns verification material for the reply. */
  verification?: {
    chatId?: string;
    verifyUrl?: string;
    signature?: string;
    signingAddress?: string;
  };
}

/** On-chain snapshot as returned by the Radiri contract (see contract/src/lib.rs). */
export interface OnchainSnapshot {
  pair_id: string; // "USDC:eth>USDT:arb"
  source: RouteSource;
  amount_in_usd: number;
  cost_bps: number; // i32
  eta_s: number | null;
  status: "ok" | "no_liquidity" | "error";
  timestamp_ms: number;
  block_height: number;
}

export interface ApiError {
  error: string;
}
