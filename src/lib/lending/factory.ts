import { LENDING_CONTRACT_ID, LENDING_MODE } from "@/lib/config";
import { NearLendingClient } from "./near-client";
import { SimulatedLendingClient } from "./simulated-client";
import type { LendingClientExt, NearTransactionSigner } from "./types";

let simulated: SimulatedLendingClient | null = null;

export interface LendingClientOptions {
  /** Wallet signer for on-chain mode. Without it the client can read but not execute. */
  signer?: NearTransactionSigner | null;
  /** Override for tests. Defaults to NEXT_PUBLIC_LENDING_CONTRACT_ID. */
  contractId?: string;
}

/**
 * The lending client for this deployment: `NearLendingClient` when NEXT_PUBLIC_LENDING_CONTRACT_ID
 * is set, otherwise the labelled browser-local `SimulatedLendingClient` (one shared instance so the
 * price cache survives re-renders).
 */
export function getLendingClient(options: LendingClientOptions = {}): LendingClientExt {
  const contractId = options.contractId ?? LENDING_CONTRACT_ID;
  const mode = options.contractId !== undefined ? (contractId ? "near" : "simulation") : LENDING_MODE;
  if (mode === "near" && contractId) return new NearLendingClient({ contractId, signer: options.signer ?? null });
  simulated ??= new SimulatedLendingClient();
  return simulated;
}
