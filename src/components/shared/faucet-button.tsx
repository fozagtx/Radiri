"use client";

import { useState } from "react";
import { Droplets, Loader2 } from "lucide-react";
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
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-amber-600/45 px-2.5 py-1 text-[11.5px] text-amber-800 transition-colors hover:bg-amber-500/8 disabled:opacity-60 dark:text-amber-300"
      >
        {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Droplets className="size-3" aria-hidden />}
        {`Testnet faucet: mint ${groupDecimal(whole)} ${asset.config.symbol}`}
      </button>
      <span className="text-[10.5px] text-muted-foreground">
        Test token with no value, minted on NEAR testnet.
      </span>
      {hashes && hashes.hashes.length > 0 ? <TxLinks hashes={hashes.hashes} urls={hashes.urls} /> : null}
      {error ? <span className="text-[11px] text-destructive">{error}</span> : null}
    </div>
  );
}
