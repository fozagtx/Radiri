import type { LendingAction, LendingActionResult, LendingClient, PriceObservation } from "@/types/protocol";
import type { BlockReason } from "@/lib/risk";

/** Signs and sends NEAR transactions through the connected wallet (NEAR Connect). */
export interface NearTransactionSigner {
  signAndSendTransactions(transactions: { receiverId: string; actions: unknown[] }[]): Promise<unknown[]>;
}

/** Where the test token prices of a simulation come from. */
export interface PriceFeedStatus {
  source: "/api/pricing";
  fetchedAtMs: number | null;
  error: string | null;
  observations: PriceObservation[];
  missing: { symbol: string; reason: string }[];
}

export interface WalletBalance {
  amount: bigint;
  /** "chain" = ft_balance_of on NEAR; "simulation" = simulated test-token wallet. */
  source: "chain" | "simulation";
}

export interface FaucetResult extends LendingActionResult {
  tokenId: string;
  amount: string;
}

/** LendingActionResult plus anything the chain reported that the user should know. */
export interface ExecutionResult extends LendingActionResult {
  /** e.g. "The contract used 400 of 500 base units and refunded the rest." */
  notes: string[];
}

/** LendingClient plus what the UI needs around it. */
export interface LendingClientExt extends LendingClient {
  /** Wallet balance of a token, or null when unknown (no account / RPC error). */
  getWalletBalance(tokenId: string, accountId: string): Promise<WalletBalance | null>;
  /** Testnet faucet (on-chain mint) or simulated faucet. Test tokens have no value. */
  faucet(accountId: string, tokenId: string, amount: string): Promise<FaucetResult>;
  /** Price feed status (simulation only; null on-chain where the contract oracle is authoritative). */
  getPriceFeedStatus(): PriceFeedStatus | null;
}

/** Rejected before signing: the same reasons the contract would give. */
export class LendingActionError extends Error {
  readonly reasons: BlockReason[];
  readonly txHashes: string[];
  readonly explorerUrls: string[];

  constructor(message: string, options: { reasons?: BlockReason[]; txHashes?: string[]; explorerUrls?: string[] } = {}) {
    super(message);
    this.name = "LendingActionError";
    this.reasons = options.reasons ?? [];
    this.txHashes = options.txHashes ?? [];
    this.explorerUrls = options.explorerUrls ?? [];
  }
}

export type { LendingAction };
