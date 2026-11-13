export type NearNetwork = "testnet" | "mainnet";

export const NETWORK: NearNetwork =
  process.env.NEXT_PUBLIC_NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet";

export const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";

export const RPC_URL =
  process.env.NEXT_PUBLIC_NEAR_RPC_URL ??
  (NETWORK === "mainnet" ? "https://rpc.mainnet.fastnear.com" : "https://rpc.testnet.fastnear.com");

export const EXPLORER_URL =
  NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
