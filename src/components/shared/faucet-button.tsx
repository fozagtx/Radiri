"use client";

import { useState } from "react";
import { Button, HStack, Stack, Text } from "@chakra-ui/react";
import { FAUCET_AMOUNT } from "@/lib/lending";
import { groupDecimal, parseUnits } from "@/lib/risk";
import { useNearWallet } from "@/lib/wallets/near";
import type { AssetView } from "@/types/protocol";
import { TxLinks } from "./bits";
import { message } from "./format";
import { useLending } from "./lending-provider";

/**
 * Clearly labelled test-token faucet. On chain it calls the Radiri test token's
 * mint(account_id, amount) on NEAR testnet.
 */
export function FaucetButton({ asset }: { asset: AssetView }) {
  const lending = useLending();
  const wallet = useNearWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hashes, setHashes] = useState<{ hashes: string[]; urls: string[] } | null>(null);
  const whole = FAUCET_AMOUNT[asset.config.symbol] ?? "1";

  async function run() {
    if (!lending.walletAccountId) {
      await wallet.signIn();
      return;
    }
    setBusy(true);
    setError(null);
    setHashes(null);
    try {
      const result = await lending.faucet(asset.config.token_id, parseUnits(whole, asset.config.decimals).toString());
      setHashes({ hashes: result.txHashes, urls: result.explorerUrls });
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap="1.5" align="flex-start">
      <HStack gap="2" wrap="wrap">
        <Button size="sm" variant="outline" borderRadius="full" loading={busy} onClick={() => void run()}>
          {`Mint ${groupDecimal(whole)} ${asset.config.symbol}`}
        </Button>
        <Text textStyle="xs" color="fg.muted">
          Testnet faucet · test token with no value
        </Text>
      </HStack>
      {hashes && hashes.hashes.length > 0 ? <TxLinks hashes={hashes.hashes} urls={hashes.urls} /> : null}
      {error ? (
        <Text textStyle="xs" color="red.600">
          {error}
        </Text>
      ) : null}
    </Stack>
  );
}
