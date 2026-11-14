/**
 * Shared types between the lending contract views, the data layer and the UI.
 * The lending shapes mirror docs/ARCHITECTURE.md section 4 exactly (JSON from the contract).
 * Change only by agreement.
 */

/* ------------------------------------------------------------------ */
/* Assets and eligibility                                              */
/* ------------------------------------------------------------------ */

export type AssetCategory = "meme" | "stock" | "stable" | "major" | "rwa" | "other";

/** Every asset carries an explicit, independent classification. */
export interface AssetEligibility {
  /** Present in the live 1Click catalog (cross-chain swap source or destination). */
  swap: boolean;
  /** Registered on the lending contract with can_collateralize = true. */
  collateral: boolean;
  /** Registered on the lending contract with can_borrow = true. */
  borrow: boolean;
}

/** Where the asset row comes from. */
export type AssetOrigin = "1click-live" | "lending-contract" | "testnet-test-token";

export interface CatalogAsset {
  /** 1Click asset id for swap assets ("nep141:..." / "1cs_v1:..."), NEAR token account id for lending-only assets. */
  id: string;
  symbol: string;
  name?: string;
  /** 1Click blockchain id ("eth", "sol", "near", "base", ...). */
  chain: string;
  decimals: number;
  category: AssetCategory;
  /** Token contract on its own chain; NEAR account id for chain "near". */
  contractAddress: string | null;
  priceUsd: number | null;
  priceUpdatedAt: string | null;
  eligibility: AssetEligibility;
  origin: AssetOrigin;
  /** True for testnet test tokens with no value. The UI must show the label. */
  isTestToken: boolean;
  /** For test tokens: the real asset whose price the oracle mirrors, e.g. "PEPE". */
  referenceSymbol?: string;
}

/* ------------------------------------------------------------------ */
/* Lending contract JSON (contracts/lending)                           */
/* ------------------------------------------------------------------ */

/** u128 as a decimal string, base units unless noted. */
export type U128 = string;

export interface InterestModel {
  base_bps: number;
  slope1_bps: number;
  slope2_bps: number;
  optimal_utilization_bps: number;
}

export type LendingCategory = "meme" | "stock" | "stable" | "major";

export interface AssetConfig {
  token_id: string;
  symbol: string;
  decimals: number;
  category: LendingCategory;
  can_collateralize: boolean;
  can_borrow: boolean;
  ltv_bps: number;
  liquidation_threshold_bps: number;
  liquidation_bonus_bps: number;
  reserve_factor_bps: number;
  collateral_cap: U128;
  borrow_cap: U128;
  interest: InterestModel;
  max_price_age_sec: number;
  max_price_change_bps: number;
  paused: boolean;
}

export interface OraclePrice {
  /** USD per whole token x 1e18. */
  price_wad: U128;
  timestamp_ms: number;
}

export interface AssetView {
  config: AssetConfig;
  cash: U128;
  total_borrowed: U128;
  reserves: U128;
  total_collateral: U128;
  total_supply_shares: U128;
  borrow_index: U128;
  utilization_bps: number;
  borrow_apr_bps: number;
  supply_apr_bps: number;
  price: OraclePrice | null;
  price_fresh: boolean;
  last_accrual_ms: number;
}

export interface AccountView {
  account_id: string;
  collateral: { token_id: string; amount: U128; value_wad: U128 }[];
  supplied: { token_id: string; shares: U128; amount: U128 }[];
  borrowed: { token_id: string; amount: U128; value_wad: U128 }[];
  collateral_value_wad: U128;
  borrow_limit_wad: U128;
  liquidation_threshold_wad: U128;
  debt_value_wad: U128;
  health_factor_wad: U128 | null;
  prices_fresh: boolean;
  liquidatable: boolean;
}

export type ActivityKind =
  | "deposit_collateral"
  | "withdraw_collateral"
  | "supply"
  | "withdraw_supply"
  | "borrow"
  | "repay"
  | "liquidated"
  | "liquidate";

export interface ActivityEntry {
  kind: ActivityKind;
  token_id: string;
  amount: U128;
  counterparty: string | null;
  timestamp_ms: number;
  block_height: number;
}

export interface LendingConfigView {
  owner_id: string;
  guardian_id: string;
  oracle_reporters: string[];
  paused: boolean;
  close_factor_bps: number;
}

/* ------------------------------------------------------------------ */
/* Lending client (src/lib/lending)                                    */
/* ------------------------------------------------------------------ */

/** Lending always runs against the NEAR testnet contract. */
export type LendingMode = "near";

export type LendingAction =
  | { kind: "deposit_collateral"; tokenId: string; amount: U128 }
  | { kind: "withdraw_collateral"; tokenId: string; amount: U128 }
  | { kind: "supply"; tokenId: string; amount: U128 }
  | { kind: "withdraw_supply"; tokenId: string; amount: U128 }
  | { kind: "borrow"; tokenId: string; amount: U128 }
  | { kind: "repay"; tokenId: string; amount: U128 };

export interface LendingActionResult {
  mode: LendingMode;
  /** NEAR transaction hashes. */
  txHashes: string[];
  /** Explorer links for mode "near". */
  explorerUrls: string[];
}

export interface LendingClient {
  readonly mode: LendingMode;
  /** Contract account id. */
  readonly contractId: string | null;
  getConfig(): Promise<LendingConfigView>;
  getAssets(): Promise<AssetView[]>;
  getAccount(accountId: string): Promise<AccountView | null>;
  getActivity(accountId: string, limit?: number): Promise<ActivityEntry[]>;
  execute(accountId: string, action: LendingAction): Promise<LendingActionResult>;
}

/* ------------------------------------------------------------------ */
/* Pricing (src/lib/oracle)                                            */
/* ------------------------------------------------------------------ */

export type PriceSource = "1click" | "lending-oracle";

export interface PriceObservation {
  symbol: string;
  /** Asset id the price belongs to (1Click asset id or NEAR token id). */
  assetId: string;
  priceUsd: number;
  source: PriceSource;
  /** When the source says the price was produced. */
  observedAt: string;
  ageSeconds: number;
  /** ageSeconds <= the max age configured for this asset/source. */
  fresh: boolean;
}

/* ------------------------------------------------------------------ */
/* Swaps (src/lib/intents)                                             */
/* ------------------------------------------------------------------ */

export interface SwapQuoteRequest {
  /** 1Click asset ids. */
  originAssetId: string;
  destinationAssetId: string;
  /** Human units of the origin asset. */
  amount: string;
  slippageBps: number;
  /** Destination-chain address that receives the output. Required for a live (non-dry) quote. */
  recipient?: string;
  /** Origin-chain address that receives refunds. Required for a live (non-dry) quote. */
  refundTo?: string;
  /** true = indicative quote, no deposit address. */
  dry: boolean;
}

export interface SwapQuote {
  dry: boolean;
  origin: CatalogAsset;
  destination: CatalogAsset;
  amountIn: string;
  amountInUsd: number | null;
  amountOut: string;
  amountOutUsd: number | null;
  minAmountOut: string;
  slippageBps: number;
  etaSeconds: number | null;
  fees: { label: string; amount: string; unit: string }[];
  /** Present on live quotes: where the user sends the origin asset. */
  depositAddress: string | null;
  depositMemo: string | null;
  /** ISO time after which the deposit is refunded. */
  deadline: string | null;
  correlationId: string | null;
  quotedAt: string;
}

export interface SwapQuoteFailure {
  reason: string;
  kind: "no-liquidity" | "unsupported" | "invalid-input" | "error";
}

/** 1Click execution status values, verbatim. */
export type SwapStatusValue =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "INCOMPLETE_DEPOSIT"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED";

export interface SwapStatus {
  depositAddress: string;
  status: SwapStatusValue;
  updatedAt: string;
  /** Origin and destination chain transaction hashes reported by 1Click. */
  originTxHashes: { hash: string; explorerUrl: string | null }[];
  destinationTxHashes: { hash: string; explorerUrl: string | null }[];
  amountOut: string | null;
  refundedAmount: string | null;
  refundReason: string | null;
}

/** A swap the user started from this app, kept for history and tracking. */
export interface SwapRecord {
  depositAddress: string;
  depositMemo: string | null;
  quote: SwapQuote;
  recipient: string;
  refundTo: string;
  depositTxHash: string | null;
  lastStatus: SwapStatusValue;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Unified activity feed (Activity page)                               */
/* ------------------------------------------------------------------ */

export interface ActivityItem {
  id: string;
  kind: ActivityKind | "swap";
  title: string;
  detail: string;
  timestamp: string;
  status: "pending" | "success" | "failed" | "refunded";
  source: "lending-contract" | "1click";
  explorerUrl: string | null;
}
