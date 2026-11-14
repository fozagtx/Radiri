"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { RadiriMark } from "@/components/landing/mark";
import { cn } from "@/lib/utils";
import { type AppNavItem, isActive, PRIMARY_NAV, TOOLS_NAV } from "./nav";
import { WalletSection } from "./wallet-section";

function NavGroup({ label, items, pathname }: { label: string; items: AppNavItem[]; pathname: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-1.5 pb-1 font-mono text-[9.5px] tracking-[0.12em] text-muted-foreground uppercase">{label}</span>
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] transition-colors",
              active ? "bg-foreground/6 text-foreground" : "text-muted-foreground hover:bg-foreground/4 hover:text-foreground",
            )}
          >
            <item.icon className="size-3.5 opacity-70" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

/** Desktop sidebar of the app shell. Name kept for existing imports. */
export function DashboardSidebar() {
  const pathname = usePathname() ?? "";

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between overflow-y-auto border-r bg-background px-3 py-4 md:flex">
      <div className="flex flex-col gap-6">
        <Link href="/" className="flex items-center gap-2 px-1.5" aria-label="Radiri home">
          <RadiriMark size={20} />
          <span className="text-[15px] font-semibold tracking-[-0.03em] text-foreground/85">Radiri</span>
        </Link>

        <nav aria-label="App" className="flex flex-col gap-5">
          <NavGroup label="App" items={PRIMARY_NAV} pathname={pathname} />
          <NavGroup label="Tools" items={TOOLS_NAV} pathname={pathname} />
        </nav>
      </div>

      <div className="flex flex-col gap-3 px-0.5 pt-4">
        <WalletSection />
        <a
          href="https://github.com/fozagtx/Radiri"
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between rounded-lg px-1.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-foreground/4 hover:text-foreground"
        >
          Source
          <ArrowUpRight className="size-3.5 opacity-70" aria-hidden />
        </a>
      </div>
    </aside>
  );
}
