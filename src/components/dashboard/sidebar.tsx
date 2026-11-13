"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Boxes, LayoutGrid, Plug, ReceiptText, Sparkles } from "lucide-react";
import { useWallet } from "@/components/wallet-provider";
import { RadiriMark } from "@/components/landing/mark";
import { cn } from "@/lib/utils";
import { NETWORK } from "@/lib/config";

const SECTIONS = [
  {
    label: "Dashboard",
    items: [
      { label: "Routes", href: "/dashboard", icon: LayoutGrid, exact: true },
      { label: "Matrix", href: "/dashboard#matrix", icon: Boxes },
      { label: "Opportunities", href: "/dashboard#opportunities", icon: Sparkles },
      { label: "Snapshots", href: "/dashboard#snapshots", icon: ReceiptText },
    ],
  },
  {
    label: "Integrations",
    items: [{ label: "Connect MCP", href: "/mcp", icon: Plug, exact: true }],
  },
];

function WalletBox() {
  const { accountId, ready, signIn, signOut } = useWallet();

  if (!ready) return <div className="h-8 w-full animate-pulse rounded-full bg-foreground/5" aria-hidden />;

  if (!accountId) {
    return (
      <button
        onClick={() => void signIn()}
        className="w-full rounded-full border border-foreground/15 px-3 py-2 text-[12.5px] font-medium text-foreground/80 transition-colors hover:border-foreground/35 hover:text-foreground"
      >
        Connect wallet
      </button>
    );
  }

  return (
    <button
      onClick={() => void signOut()}
      title="Sign out"
      className="w-full truncate rounded-full border border-foreground/15 px-3 py-2 font-mono text-[11px] text-foreground/75 transition-colors hover:border-foreground/35 hover:text-foreground"
    >
      {accountId}
    </button>
  );
}

export function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col justify-between border-r bg-background px-3 py-4 md:flex">
      <div className="flex flex-col gap-6">
        <Link href="/" className="flex items-center gap-2 px-1.5" aria-label="Radiri home">
          <RadiriMark size={20} />
          <span className="text-[15px] font-semibold tracking-[-0.03em] text-foreground/85">Radiri</span>
        </Link>

        <nav className="flex flex-col gap-5">
          {SECTIONS.map((section) => (
            <div key={section.label} className="flex flex-col gap-1">
              <span className="px-1.5 pb-1 font-mono text-[9.5px] tracking-[0.12em] text-muted-foreground uppercase">
                {section.label}
              </span>
              {section.items.map((item) => {
                const active = item.exact ? pathname === item.href : false;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] transition-colors",
                      active
                        ? "bg-foreground/6 text-foreground"
                        : "text-muted-foreground hover:bg-foreground/4 hover:text-foreground",
                    )}
                  >
                    <item.icon className="size-3.5 opacity-70" aria-hidden />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </div>

      <div className="flex flex-col gap-2 px-0.5">
        <a
          href="https://github.com/fozagtx/Radiri"
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between rounded-lg px-2 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-foreground/4 hover:text-foreground"
        >
          Source
          <ArrowUpRight className="size-3.5 opacity-70" aria-hidden />
        </a>
        <div className="flex items-center justify-between px-2 pb-1 font-mono text-[9.5px] tracking-[0.1em] text-muted-foreground uppercase">
          <span>Network</span>
          <span>{NETWORK}</span>
        </div>
        <WalletBox />
      </div>
    </aside>
  );
}
