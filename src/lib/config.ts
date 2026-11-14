import type { LendingMode } from "@/types/protocol";

export type NearNetwork = "testnet" | "mainnet";

export const NETWORK: NearNetwork =
  process.env.NEXT_PUBLIC_NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet";

/** Snapshot registry contract (route monitor). */
export const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";

export const RPC_URL =
  process.env.NEXT_PUBLIC_NEAR_RPC_URL ??
  (NETWORK === "mainnet" ? "https://rpc.mainnet.fastnear.com" : "https://rpc.testnet.fastnear.com");

export const EXPLORER_URL =
  NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";

/** Radiri lending contract. Unset = the labelled browser-local simulation. */
export const LENDING_CONTRACT_ID = (process.env.NEXT_PUBLIC_LENDING_CONTRACT_ID ?? "").trim();

export const LENDING_MODE: LendingMode = LENDING_CONTRACT_ID ? "near" : "simulation";
