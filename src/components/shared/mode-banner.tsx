import { FlaskConical, Link2 } from "lucide-react";
import { EXPLORER_URL, LENDING_CONTRACT_ID, LENDING_MODE, NETWORK } from "@/lib/config";

/**
 * Permanent mode banner for the lending pages. In simulation it must read
 * "Simulation · no on-chain transaction" and say where the numbers come from.
 */
export function ModeBanner() {
  if (LENDING_MODE === "simulation") {
    return (
      <div
        role="status"
        className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/8 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-200"
      >
        <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold">Simulation · no on-chain transaction</p>
          <p className="mt-0.5 text-amber-900/80 dark:text-amber-200/80">
            No lending contract is configured, so positions live only in this browser and nothing is signed or sent.
            The same risk engine as the contract checks every action against live reference prices; pool liquidity is
            seeded by the simulation. Set <code className="font-mono">NEXT_PUBLIC_LENDING_CONTRACT_ID</code> to use the
            NEAR {NETWORK} contract.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div role="status" className="mb-4 flex items-start gap-2.5 rounded-xl border border-foreground/12 bg-card px-3 py-2.5 text-xs">
      <Link2 className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold">
          On-chain · NEAR {NETWORK} ·{" "}
          <a
            href={`${EXPLORER_URL}/address/${LENDING_CONTRACT_ID}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono underline underline-offset-2"
          >
            {LENDING_CONTRACT_ID}
          </a>
        </p>
        <p className="mt-0.5 text-muted-foreground">
          Positions are read from the lending contract and every action is a transaction you sign. Assets are Radiri
          test tokens with no value; their oracle prices mirror real meme coins and stocks.
        </p>
      </div>
    </div>
  );
}
