"use client";

import { Badge, Box, Button, HStack, Stack, Text } from "@chakra-ui/react";
import { Link2 } from "lucide-react";
import { ChainLogo } from "@/components/app/token-avatar";
import { LENDING_CONTRACT_ID, NETWORK } from "@/lib/config";
import { useEvmWallet } from "@/lib/wallets/evm";
import { useNearWallet } from "@/lib/wallets/near";
import { useSolanaWallet } from "@/lib/wallets/solana";

function short(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

/** Lending network badge: the live NEAR testnet contract. */
export function ModeBadge({ className }: { className?: string }) {
  return (
    <Badge className={className} colorPalette="green" variant="subtle" size="md" borderRadius="full" gap="1.5" fontFamily="mono" title={`Lending reads and writes ${LENDING_CONTRACT_ID} on NEAR ${NETWORK}`}>
      <Link2 size={12} aria-hidden />
      NEAR {NETWORK}
    </Badge>
  );
}

function WalletRow({ chain, logo, hint, address, busy, onConnect, onDisconnect }: { chain: string; logo: string; hint: string; address: string | null; busy?: boolean; onConnect: () => void; onDisconnect: () => void }) {
  return (
    <HStack justify="space-between" gap="3" py="2">
      <HStack gap="2.5" minW="0">
        <ChainLogo chain={logo} size={28} />
        <Stack gap="0" minW="0">
          <Text textStyle="sm" fontWeight="semibold">
            {chain}
          </Text>
          <Text textStyle="xs" color="fg.muted" truncate>
            {address ? short(address) : hint}
          </Text>
        </Stack>
      </HStack>
      {address ? (
        <Button size="xs" variant="outline" borderRadius="full" onClick={onDisconnect}>
          Disconnect
        </Button>
      ) : (
        <Button size="xs" variant="solid" colorPalette="gray" bg="ink" color="white" borderRadius="full" loading={busy} onClick={onConnect}>
          Connect
        </Button>
      )}
    </HStack>
  );
}

/** NEAR (lending), EVM and Solana (swap deposits) wallets. */
export function WalletSection() {
  const near = useNearWallet();
  const evm = useEvmWallet();
  const solana = useSolanaWallet();
  return (
    <Box>
      <WalletRow chain="NEAR testnet" logo="near" hint="Signs lending actions" address={near.accountId} busy={near.connecting || !near.ready} onConnect={() => void near.signIn()} onDisconnect={() => void near.signOut()} />
      {near.error ? (
        <Text textStyle="xs" color="red.600">
          {near.error}
        </Text>
      ) : null}
      <WalletRow chain="EVM" logo="eth" hint="Ethereum, Base, BNB Chain… swap deposits" address={evm.address} onConnect={() => void evm.connect()} onDisconnect={() => void evm.disconnect()} />
      <WalletRow chain="Solana" logo="sol" hint="Swap deposits" address={solana.address} onConnect={() => void solana.connect()} onDisconnect={() => void solana.disconnect()} />
    </Box>
  );
}
