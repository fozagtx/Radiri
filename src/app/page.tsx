import { Activity, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RadiriDashboard } from "@/components/radiri/radiri-dashboard";
import { INTENTS_URL } from "@/components/radiri/format";
import { WalletStatus } from "@/components/radiri/wallet-status";
import { NETWORK } from "@/lib/config";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Activity className="size-4" aria-hidden />
            </span>
            <div className="flex flex-col leading-tight">
              <h1 className="text-sm font-semibold tracking-tight">Radiri</h1>
              <span className="text-[0.7rem] text-muted-foreground">Stablecoin liquidity aggregator</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[0.65rem] uppercase">
              {NETWORK}
            </Badge>
            <a
              href={INTENTS_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1 text-xs text-muted-foreground underline underline-offset-3 hover:text-foreground sm:inline-flex"
            >
              intents.near.org
              <ExternalLink className="size-3" aria-hidden />
            </a>
            <WalletStatus />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-3">
        <RadiriDashboard />
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-1 px-4 py-3 text-[0.7rem] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            Radiri quotes 1Click and Rhea in dry run mode. Execution happens in your own wallet at intents.near.org.
          </span>
          <span>Snapshots are written by the monitor to the registry contract on NEAR.</span>
        </div>
      </footer>
    </div>
  );
}
