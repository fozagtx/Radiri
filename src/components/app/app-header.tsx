"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Wallet } from "lucide-react";
import { ModeBadge, WalletSection } from "@/components/dashboard/wallet-section";
import { isActive, PRIMARY_NAV } from "@/components/dashboard/nav";
import { LiveTicker } from "@/components/app/live-ticker";
import { RadiriMark } from "@/components/landing/mark";
import { cn } from "@/lib/utils";
import { useEvmWallet } from "@/lib/wallets/evm";
import { useNearWallet } from "@/lib/wallets/near";
import { useSolanaWallet } from "@/lib/wallets/solana";

function short(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

/** One button for all three wallets (NEAR for lending, EVM and Solana for swap deposits). */
function WalletMenu() {
  const near = useNearWallet();
  const evm = useEvmWallet();
  const solana = useSolanaWallet();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const connected = [near.accountId, evm.address, solana.address].filter((value): value is string => Boolean(value));

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors",
          connected.length ? "border border-foreground/15 bg-card text-foreground hover:border-foreground/35" : "bg-foreground text-background hover:bg-foreground/85",
        )}
      >
        <Wallet className="size-3.5" aria-hidden />
        {connected.length ? (
          <span className="font-mono text-[12px]">
            {short(connected[0])}
            {connected.length > 1 ? <span className="ml-1 text-muted-foreground">+{connected.length - 1}</span> : null}
          </span>
        ) : (
          "Connect wallet"
        )}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Wallets"
          className="absolute right-0 z-50 mt-2 w-[19rem] rounded-2xl border border-foreground/10 bg-card p-4 shadow-[0_24px_60px_-20px_rgba(25,25,25,0.35)]"
        >
          <WalletSection />
          <p className="mt-3 border-t border-foreground/8 pt-3 text-[11px] text-muted-foreground">
            NEAR signs lending actions. EVM and Solana wallets send swap deposits. Radiri never holds a key.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function AppHeader() {
  const pathname = usePathname() ?? "";
  return (
    <header className="sticky top-0 z-40 border-b border-foreground/8 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="Radiri home">
          <RadiriMark size={22} />
          <span className="text-[16px] font-semibold tracking-[-0.03em]">Radiri</span>
        </Link>

        <nav aria-label="App" className="hidden flex-1 items-center justify-center gap-1 md:flex">
          {PRIMARY_NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors",
                  active ? "bg-foreground text-background" : "text-foreground/65 hover:bg-foreground/6 hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <ModeBadge className="hidden lg:inline-flex" />
          <WalletMenu />
        </div>
      </div>

      <nav aria-label="App" className="flex gap-1 overflow-x-auto px-4 pb-2.5 md:hidden">
        {PRIMARY_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-[13px] transition-colors",
                active ? "bg-foreground text-background" : "bg-foreground/5 text-foreground/70",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <LiveTicker />
    </header>
  );
}
