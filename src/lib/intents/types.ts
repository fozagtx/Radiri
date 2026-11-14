import type { SwapQuote, SwapQuoteFailure, SwapStatus } from "@/types/protocol";

/**
 * Radiri's swap shapes: the shared protocol types plus the fields a wallet needs to send an exact
 * deposit and the user needs to keep for disputes. Client-safe (types only).
 *
 * Amount strings without a `Base` suffix are exact decimal strings in human units of their token;
 * `…Base` strings are integer base units.
 */
export interface RadiriSwapQuote extends SwapQuote {
  /** Exact origin base units to deposit (EXACT_INPUT: equal to the requested amount). */
  amountInBase: string;
  amountOutBase: string;
  minAmountOutBase: string;
  /** 1Click service signature over the quote. Keep it with the quote (1Click: needed to resolve disputes). */
  signature: string | null;
  /** Live quotes: result of the SDK's verifyQuoteSignature. Null for dry quotes. */
  signatureVerified: boolean | null;
  /** Live quotes: when the deposit address goes inactive (1Click `quote.deadline` / `timeWhenInactive`). */
  timeWhenInactive: string | null;
  /** True when a dry quote was priced with placeholder recipient/refund addresses (nothing can be sent). */
  placeholderAddresses: boolean;
  /** Recipient and refund address the quote was requested with. */
  recipient: string;
  refundTo: string;
}

export type SwapQuoteResult = { quote: RadiriSwapQuote } | { failure: SwapQuoteFailure };

export interface RadiriSwapStatus extends SwapStatus {
  /** Amount 1Click saw arrive at the deposit address, human units of the origin asset. */
  depositedAmount: string | null;
  nearTxHashes: string[];
  correlationId: string | null;
  /** Search the deposit address here for full details. */
  intentsExplorerUrl: string;
}

export const SWAP_STATUS_VALUES = [
  "PENDING_DEPOSIT",
  "KNOWN_DEPOSIT_TX",
  "INCOMPLETE_DEPOSIT",
  "PROCESSING",
  "SUCCESS",
  "REFUNDED",
  "FAILED",
] as const;

/** Statuses after which 1Click will not change the swap any more. */
export const TERMINAL_SWAP_STATUSES = new Set<string>(["SUCCESS", "REFUNDED", "FAILED"]);
