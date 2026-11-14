"use client";

import { useState } from "react";
import { Button, HStack, Stack, Text } from "@chakra-ui/react";
import { FAUCET_AMOUNT, txExplorerUrl } from "@/lib/lending";
import { groupDecimal, parseUnits } from "@/lib/risk";
import { useNearWallet } from "@/lib/wallets/near";
import type { AssetView } from "@/types/protocol";
import { TxLinks } from "./bits";
import { message } from "./format";
import { useLending } from "./lending-provider";

/**
 * Advances a wallet-generated implicit account that does not exist on chain yet. Returns the
 * funding transaction hash, or null when the account already existed.
 */
async function ensureAccountFunded(accountId: string): Promise<string | null> {
  const res = await fetch("/api/faucet/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId }),
  });
  const body = (await res.json().catch(() => null)) as { funded?: boolean; txHash?: string | null; reason?: string | null; error?: string } | null;
  if (!res.ok) throw new Error(body?.error ?? `Faucet HTTP ${res.status}`);
  if (body?.funded) return body.txHash ?? null;
  if (body?.reason === "account already has funds" || body?.reason === "account already exists") return null;
  throw new Error(
    `${accountId} is not funded on NEAR testnet and the app could not fund it (${body?.reason ?? "unknown reason"}). Connect a testnet account that already exists.`,
  );
}

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
    const accountId = lending.walletAccountId;
    if (!accountId) {
      await wallet.signIn();
      return;
    }
    setBusy(true);
    setError(null);
    setHashes(null);
    try {
      const fundingTx = await ensureAccountFunded(accountId);
      const result = await lending.faucet(asset.config.token_id, parseUnits(whole, asset.config.decimals).toString());
      setHashes({
        hashes: fundingTx ? [fundingTx, ...result.txHashes] : result.txHashes,
        urls: fundingTx ? [txExplorerUrl(fundingTx), ...result.explorerUrls] : result.explorerUrls,
      });
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
