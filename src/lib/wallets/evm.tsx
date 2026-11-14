"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { erc20Abi, type Chain } from "viem";
import {
  abstract,
  arbitrum,
  avalanche,
  base,
  berachain,
  bsc,
  gnosis,
  mainnet,
  monad,
  optimism,
  plasma,
  polygon,
  robinhood,
  scroll,
  xLayer,
} from "viem/chains";
import {
  WagmiProvider,
  createConfig,
  http,
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  type Config,
} from "wagmi";
import { sendTransaction, switchChain, writeContract } from "wagmi/actions";
import { injected, walletConnect } from "wagmi/connectors";

/**
 * EVM wallets for 1Click deposits: wagmi 3 + viem with the `injected` connector (EIP-6963 discovery
 * included) and, when NEXT_PUBLIC_REOWN_PROJECT_ID is set, WalletConnect via Reown. Chains are the
 * EVM chains 1Click supports. The user signs every transaction in their own wallet; Radiri never
 * holds a key.
 */

/** 1Click EVM chains (ids match src/lib/intents/chains.ts). */
export const EVM_CHAINS: readonly [Chain, ...Chain[]] = [
  mainnet,
  base,
  arbitrum,
  bsc,
  polygon,
  optimism,
  avalanche,
  gnosis,
  berachain,
  scroll,
  monad,
  xLayer,
  plasma,
  abstract,
  robinhood,
];

const REOWN_PROJECT_ID = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID?.trim() || "";

function makeConfig(): Config {
  const connectors = [injected({ shimDisconnect: true })];
  if (REOWN_PROJECT_ID) {
    connectors.push(
      walletConnect({
        projectId: REOWN_PROJECT_ID,
        showQrModal: true,
        metadata: {
          name: "Radiri",
          description: "Cross-chain meme coin and tokenized stock swaps via NEAR Intents",
          url: typeof window !== "undefined" ? window.location.origin : "https://radiri.vercel.app",
          icons: [],
        },
      }) as unknown as (typeof connectors)[number],
    );
  }
  return createConfig({
    chains: EVM_CHAINS,
    connectors,
    ssr: true,
    transports: Object.fromEntries(EVM_CHAINS.map((chain) => [chain.id, http()])),
  });
}

export interface EvmDepositParams {
  /** EVM chain id the deposit must be sent on (1Click origin chain). */
  chainId: number;
  /** ERC-20 contract, or null for the chain's native coin. */
  token: `0x${string}` | null;
  /** 1Click deposit address. */
  to: `0x${string}`;
  /** Exact base units. */
  amount: bigint;
}

export interface EvmConnectorInfo {
  id: string;
  name: string;
  icon?: string;
}

export interface EvmWalletState {
  address: string | null;
  chainId: number | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** False when no EvmWalletProvider is mounted above the caller. */
  available: boolean;
  status: "disconnected" | "connecting" | "reconnecting" | "connected";
  connectors: EvmConnectorInfo[];
  connectWith: (connectorId: string) => Promise<void>;
  switchChain: (chainId: number) => Promise<void>;
  /** Sends the deposit (native transfer or ERC-20 `transfer`) and returns the transaction hash. */
  sendDeposit: (params: EvmDepositParams) => Promise<`0x${string}`>;
  walletConnectEnabled: boolean;
}

const notMounted = async (): Promise<never> => {
  throw new Error("EVM wallets are not available here (EvmWalletProvider is not mounted)");
};

const DISCONNECTED: EvmWalletState = {
  address: null,
  chainId: null,
  connect: notMounted,
  disconnect: async () => {},
  available: false,
  status: "disconnected",
  connectors: [],
  connectWith: notMounted,
  switchChain: notMounted,
  sendDeposit: notMounted,
  walletConnectEnabled: false,
};

const EvmContext = createContext<EvmWalletState | null>(null);

function EvmBridge({ config, children }: { config: Config; children: React.ReactNode }) {
  const connection = useConnection();
  const connectors = useConnectors();
  const { mutateAsync: connectAsync } = useConnect();
  const { mutateAsync: disconnectAsync } = useDisconnect();

  const connectWith = useCallback(
    async (connectorId: string) => {
      const connector = connectors.find((item) => item.id === connectorId || item.uid === connectorId);
      if (!connector) throw new Error(`EVM connector ${connectorId} is not available`);
      await connectAsync({ connector });
    },
    [connectors, connectAsync],
  );

  const connect = useCallback(async () => {
    // Prefer a discovered browser wallet (EIP-6963), then the generic injected one, then WalletConnect.
    const ordered = [
      ...connectors.filter((item) => item.type === "injected" && item.id !== "injected"),
      ...connectors.filter((item) => item.id === "injected"),
      ...connectors.filter((item) => item.type === "walletConnect"),
    ];
    const connector = ordered[0];
    if (!connector) throw new Error("No EVM wallet found. Install a browser wallet or configure WalletConnect.");
    await connectAsync({ connector });
  }, [connectors, connectAsync]);

  const disconnect = useCallback(async () => {
    await disconnectAsync();
  }, [disconnectAsync]);

  const doSwitchChain = useCallback(
    async (chainId: number) => {
      await switchChain(config, { chainId: chainId as (typeof EVM_CHAINS)[number]["id"] });
    },
    [config],
  );

  const sendDeposit = useCallback(
    async ({ chainId, token, to, amount }: EvmDepositParams): Promise<`0x${string}`> => {
      if (!connection.address) throw new Error("Connect an EVM wallet first");
      if (amount <= BigInt(0)) throw new Error("Deposit amount must be positive");
      if (!EVM_CHAINS.some((chain) => chain.id === chainId)) throw new Error(`Chain ${chainId} is not configured`);
      if (connection.chainId !== chainId) await switchChain(config, { chainId });
      if (token === null) {
        return sendTransaction(config, { chainId, to, value: amount });
      }
      return writeContract(config, {
        chainId,
        address: token,
        abi: erc20Abi,
        functionName: "transfer",
        args: [to, amount],
      });
    },
    [config, connection.address, connection.chainId],
  );

  const value = useMemo<EvmWalletState>(
    () => ({
      address: connection.address ?? null,
      chainId: connection.chainId ?? null,
      connect,
      disconnect,
      available: true,
      status: connection.status,
      connectors: connectors.map((item) => ({ id: item.uid, name: item.name, icon: item.icon })),
      connectWith,
      switchChain: doSwitchChain,
      sendDeposit,
      walletConnectEnabled: Boolean(REOWN_PROJECT_ID),
    }),
    [connection.address, connection.chainId, connection.status, connect, disconnect, connectors, connectWith, doSwitchChain, sendDeposit],
  );

  return <EvmContext.Provider value={value}>{children}</EvmContext.Provider>;
}

export function EvmWalletProvider({ children }: { children: React.ReactNode }) {
  const outer = useContext(EvmContext);
  // Mounted twice (e.g. by a layout and a page): reuse the outer provider and create nothing.
  const [config] = useState(() => (outer ? null : makeConfig()));
  const [queryClient] = useState(() => (outer ? null : new QueryClient()));
  if (outer || !config || !queryClient) return <>{children}</>;
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <EvmBridge config={config}>{children}</EvmBridge>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

/** EVM wallet state; a disconnected placeholder (available = false) outside EvmWalletProvider. */
export function useEvmWallet(): EvmWalletState {
  return useContext(EvmContext) ?? DISCONNECTED;
}
