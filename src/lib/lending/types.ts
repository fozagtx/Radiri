import type { LendingAction, LendingActionResult, LendingClient } from "@/types/protocol";
import type { BlockReason } from "@/lib/risk";

/** Signs and sends NEAR transactions through the connected wallet (NEAR Connect). */
export interface NearTransactionSigner {
  signAndSendTransactions(transactions: { receiverId: string; actions: unknown[] }[]): Promise<unknown[]>;
}

export interface WalletBalance {
  amount: bigint;
  /** ft_balance_of on NEAR. */
  source: "chain";
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
  /** Testnet faucet: on-chain mint of a Radiri test token (no value). */
  faucet(accountId: string, tokenId: string, amount: string): Promise<FaucetResult>;
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
