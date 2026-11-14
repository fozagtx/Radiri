"use client";

import { FlaskConical, Link2, Loader2 } from "lucide-react";
import { LENDING_CONTRACT_ID, LENDING_MODE, NETWORK } from "@/lib/config";
import { useEvmWallet } from "@/lib/wallets/evm";
import { useNearWallet } from "@/lib/wallets/near";
import { useSolanaWallet } from "@/lib/wallets/solana";
import { cn } from "@/lib/utils";

function short(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

/** Permanent lending mode badge: "On-chain · <contract>" or "Simulation". */
export function ModeBadge({ className }: { className?: string }) {
  if (LENDING_MODE === "near") {
    return (
      <span
        title={`Lending reads and writes ${LENDING_CONTRACT_ID} on NEAR ${NETWORK}`}
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-full border border-emerald-600/30 bg-emerald-600/8 px-2.5 py-1 font-mono text-[10px] text-emerald-800 dark:text-emerald-300",
          className,
        )}
      >
        <Link2 className="size-3 shrink-0" aria-hidden />
        <span className="truncate">On-chain · {LENDING_CONTRACT_ID}</span>
      </span>
    );
  }
  return (
    <span
      title="No lending contract configured: browser-local simulation, no on-chain transaction"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-amber-500/45 bg-amber-500/10 px-2.5 py-1 font-mono text-[10px] text-amber-900 dark:text-amber-200",
        className,
      )}
    >
      <FlaskConical className="size-3 shrink-0" aria-hidden />
      Simulation
    </span>
  );
}

function WalletRow({
  chain,
  hint,
  address,
  busy,
  onConnect,
  onDisconnect,
}: {
  chain: string;
  hint: string;
  address: string | null;
  busy?: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 flex-col">
        <span className="text-[12px] font-medium text-foreground/85">{chain}</span>
        <span className="truncate text-[10px] text-muted-foreground">{hint}</span>
      </div>
      {address ? (
        <button
          type="button"
          onClick={onDisconnect}
          title={`${address} · click to disconnect`}
          aria-label={`Disconnect ${chain} wallet ${address}`}
          className="max-w-[7.5rem] shrink-0 truncate rounded-full border border-foreground/15 px-2.5 py-1 font-mono text-[10.5px] text-foreground/75 transition-colors hover:border-foreground/35 hover:text-foreground"
        >
          {short(address)}
        </button>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-foreground/15 px-2.5 py-1 text-[11px] font-medium text-foreground/80 transition-colors hover:border-foreground/35 hover:text-foreground disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
          Connect
        </button>
      )}
    </div>
  );
}

/** NEAR (lending network), EVM and Solana (swap origins) wallets, network label and mode badge. */
export function WalletSection({ className }: { className?: string }) {
  const near = useNearWallet();
  const evm = useEvmWallet();
  const solana = useSolanaWallet();

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex items-center justify-between px-0.5 font-mono text-[9.5px] tracking-[0.1em] text-muted-foreground uppercase">
        <span>Wallets</span>
        <span>NEAR {NETWORK}</span>
      </div>
      {near.ready ? (
        <WalletRow
          chain="NEAR"
          hint="Lending network"
          address={near.accountId}
          busy={near.connecting}
          onConnect={() => void near.signIn()}
          onDisconnect={() => void near.signOut()}
        />
      ) : (
        <div className="h-8 animate-pulse rounded-full bg-foreground/5" aria-hidden />
      )}
      {near.error ? <p className="text-[10.5px] text-destructive">{near.error}</p> : null}
      <WalletRow
        chain="EVM"
        hint={evm.chainId ? `Swaps · chain ${evm.chainId}` : "Swap origin"}
        address={evm.address}
        onConnect={() => void evm.connect()}
        onDisconnect={() => void evm.disconnect()}
      />
      <WalletRow
        chain="Solana"
        hint="Swap origin"
        address={solana.address}
        onConnect={() => void solana.connect()}
        onDisconnect={() => void solana.disconnect()}
      />
      <ModeBadge className="mt-0.5 self-start" />
    </div>
  );
}
