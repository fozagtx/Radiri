import { LENDING_CONTRACT_ID } from "@/lib/config";
import { NearLendingClient } from "./near-client";
import type { LendingClientExt, NearTransactionSigner } from "./types";

export interface LendingClientOptions {
  /** Wallet signer. Without it the client can read but not execute. */
  signer?: NearTransactionSigner | null;
  /** Override for tests. Defaults to the deployed testnet lending contract. */
  contractId?: string;
}

/** The lending client: always the NEAR testnet lending contract. */
export function getLendingClient(options: LendingClientOptions = {}): LendingClientExt {
  return new NearLendingClient({ contractId: options.contractId ?? LENDING_CONTRACT_ID, signer: options.signer ?? null });
}
