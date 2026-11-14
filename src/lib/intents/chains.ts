/**
 * 1Click blockchain ids and what Radiri knows about each: display name, chain family, EVM chain id
 * and explorer links. Client-safe (no secrets, no network).
 */

export type ChainFamily = "evm" | "solana" | "near" | "other";

export interface ChainInfo {
  id: string;
  name: string;
  family: ChainFamily;
  /** EVM chain id for wallet transfers. */
  evmChainId?: number;
  /** Transaction URL prefix; the hash is appended. */
  txExplorer?: string;
}

const CHAINS: Record<string, ChainInfo> = {
  eth: { id: "eth", name: "Ethereum", family: "evm", evmChainId: 1, txExplorer: "https://etherscan.io/tx/" },
  base: { id: "base", name: "Base", family: "evm", evmChainId: 8453, txExplorer: "https://basescan.org/tx/" },
  arb: { id: "arb", name: "Arbitrum", family: "evm", evmChainId: 42161, txExplorer: "https://arbiscan.io/tx/" },
  bsc: { id: "bsc", name: "BNB Chain", family: "evm", evmChainId: 56, txExplorer: "https://bscscan.com/tx/" },
  pol: { id: "pol", name: "Polygon", family: "evm", evmChainId: 137, txExplorer: "https://polygonscan.com/tx/" },
  op: { id: "op", name: "Optimism", family: "evm", evmChainId: 10, txExplorer: "https://optimistic.etherscan.io/tx/" },
  avax: { id: "avax", name: "Avalanche", family: "evm", evmChainId: 43114, txExplorer: "https://snowtrace.io/tx/" },
  gnosis: { id: "gnosis", name: "Gnosis", family: "evm", evmChainId: 100, txExplorer: "https://gnosisscan.io/tx/" },
  bera: { id: "bera", name: "Berachain", family: "evm", evmChainId: 80094, txExplorer: "https://berascan.com/tx/" },
  scroll: { id: "scroll", name: "Scroll", family: "evm", evmChainId: 534352, txExplorer: "https://scrollscan.com/tx/" },
  monad: { id: "monad", name: "Monad", family: "evm", evmChainId: 143 },
  xlayer: { id: "xlayer", name: "X Layer", family: "evm", evmChainId: 196 },
  plasma: { id: "plasma", name: "Plasma", family: "evm", evmChainId: 9745 },
  abs: { id: "abs", name: "Abstract", family: "evm", evmChainId: 2741 },
  hood: { id: "hood", name: "Robinhood Chain", family: "evm", evmChainId: 4663 },
  sol: { id: "sol", name: "Solana", family: "solana", txExplorer: "https://solscan.io/tx/" },
  near: { id: "near", name: "NEAR", family: "near", txExplorer: "https://nearblocks.io/txns/" },
  btc: { id: "btc", name: "Bitcoin", family: "other", txExplorer: "https://mempool.space/tx/" },
  doge: { id: "doge", name: "Dogecoin", family: "other" },
  tron: { id: "tron", name: "Tron", family: "other", txExplorer: "https://tronscan.org/#/transaction/" },
  sui: { id: "sui", name: "Sui", family: "other" },
  aptos: { id: "aptos", name: "Aptos", family: "other" },
  ton: { id: "ton", name: "TON", family: "other" },
  xrp: { id: "xrp", name: "XRP Ledger", family: "other" },
  zec: { id: "zec", name: "Zcash", family: "other" },
  ltc: { id: "ltc", name: "Litecoin", family: "other" },
  bch: { id: "bch", name: "Bitcoin Cash", family: "other" },
  dash: { id: "dash", name: "Dash", family: "other" },
  stellar: { id: "stellar", name: "Stellar", family: "other" },
  cardano: { id: "cardano", name: "Cardano", family: "other" },
  starknet: { id: "starknet", name: "Starknet", family: "other" },
  hypercore: { id: "hypercore", name: "Hyperliquid", family: "other" },
  movement: { id: "movement", name: "Movement", family: "other" },
  aleo: { id: "aleo", name: "Aleo", family: "other" },
  miden: { id: "miden", name: "Miden", family: "other" },
  fogo: { id: "fogo", name: "Fogo", family: "other" },
  qtc: { id: "qtc", name: "Quantus", family: "other" },
  prl: { id: "prl", name: "PRL", family: "other" },
  adi: { id: "adi", name: "ADI", family: "other" },
};

export function chainInfo(chain: string): ChainInfo {
  const key = chain.trim().toLowerCase();
  return CHAINS[key] ?? { id: key, name: key.toUpperCase(), family: "other" };
}

export function chainName(chain: string): string {
  return chainInfo(chain).name;
}

export function chainFamily(chain: string): ChainFamily {
  return chainInfo(chain).family;
}

export function evmChainIdOf(chain: string): number | null {
  return chainInfo(chain).evmChainId ?? null;
}

export function txExplorerUrl(chain: string, hash: string): string | null {
  const prefix = chainInfo(chain).txExplorer;
  return prefix ? `${prefix}${hash}` : null;
}

/** 1Click EVM chains Radiri can send deposits on from a connected wallet. */
export const EVM_CHAIN_IDS: Record<string, number> = Object.fromEntries(
  Object.values(CHAINS)
    .filter((info) => info.family === "evm" && info.evmChainId !== undefined)
    .map((info) => [info.id, info.evmChainId as number]),
);

/** NEAR Intents explorer: search by deposit address. */
export const INTENTS_EXPLORER_URL = "https://explorer.near-intents.org";
