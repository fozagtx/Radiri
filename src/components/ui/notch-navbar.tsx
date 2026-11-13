"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWallet } from "@/components/wallet-provider";
import { RadiriMark } from "@/components/landing/mark";

export type NavItem = { label: string; href: string; external?: boolean };

const DEFAULT_LINKS: NavItem[] = [
  { label: "How it works", href: "/#how" },
  { label: "FAQs", href: "/#faq" },
];

const HAIR = "currentColor";

function WalletAction({ block = false }: { block?: boolean }) {
  const { accountId, ready, signIn, signOut } = useWallet();

  if (!ready) {
    return <span className={cn("h-8 w-28 animate-pulse rounded-full bg-foreground/5", block && "w-full")} aria-hidden />;
  }

  if (!accountId) {
    return (
      <button
        onClick={() => void signIn()}
        className={cn(
          "rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-colors hover:bg-foreground/90",
          block ? "w-full" : "whitespace-nowrap",
        )}
      >
        Connect wallet
      </button>
    );
  }

  return (
    <button
      onClick={() => void signOut()}
      title="Sign out"
      className={cn(
        "rounded-full border border-foreground/15 px-3.5 py-2 font-mono text-[11px] text-foreground/75 transition-colors hover:border-foreground/35 hover:text-foreground",
        block ? "w-full" : "max-w-44 truncate",
      )}
    >
      {accountId}
    </button>
  );
}

export function NotchNavbar({
  className,
  links = DEFAULT_LINKS,
  ...props
}: React.HTMLAttributes<HTMLElement> & { links?: NavItem[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className={cn("fixed inset-x-0 top-0 z-50 flex h-14 px-0", className)} {...props}>
        <div className="relative z-20 h-9 min-w-0 flex-1 bg-background">
          <svg className="absolute inset-x-0 bottom-0 h-px w-full" preserveAspectRatio="none" aria-hidden>
            <line x1="0" y1="0.5" x2="100%" y2="0.5" stroke={HAIR} strokeOpacity={0.09} strokeWidth={1} className="text-foreground" />
          </svg>
        </div>

        <div className="relative z-10 -ml-px flex h-14 shrink-0">
          <div className="relative h-full w-[40px] shrink-0">
            <div
              className="absolute inset-0 bg-background"
              style={{ clipPath: "path('M0 0 H40 V56 C20 56 20 36 0 36 Z')" }}
            />
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 40 56" aria-hidden>
              <path d="M0 35.5 C20 35.5 20 55.5 40 55.5" fill="none" stroke={HAIR} strokeOpacity={0.09} strokeWidth={1} className="text-foreground" />
            </svg>
          </div>

          <div className="relative -ml-px h-full min-w-0 flex-1">
            <div className="absolute inset-0 bg-background">
              <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full" preserveAspectRatio="none" aria-hidden>
                <line x1="0" y1="0.5" x2="100%" y2="0.5" stroke={HAIR} strokeOpacity={0.09} strokeWidth={1} className="text-foreground" />
              </svg>
            </div>

            <div className="relative flex h-full w-full items-center justify-between gap-6 px-5">
              <div className="flex min-w-0 items-center gap-7">
                <Link href="/" className="group flex shrink-0 items-center gap-2" aria-label="Radiri home">
                  <RadiriMark size={22} />
                  <span className="text-[17px] font-semibold tracking-[-0.035em] text-foreground/85 transition-colors group-hover:text-foreground">
                    Radiri
                  </span>
                </Link>

                <nav className="hidden items-center gap-6 md:flex">
                  {links.map((item) =>
                    item.external ? (
                      <a
                        key={item.label}
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[13.5px] text-foreground/55 transition-colors hover:text-foreground"
                      >
                        {item.label}
                      </a>
                    ) : (
                      <Link
                        key={item.label}
                        href={item.href}
                        className="text-[13.5px] text-foreground/55 transition-colors hover:text-foreground"
                      >
                        {item.label}
                      </Link>
                    ),
                  )}
                </nav>
              </div>

              <div className="hidden shrink-0 items-center gap-3 md:flex">
                <WalletAction />
              </div>

              <div className="flex shrink-0 items-center md:hidden">
                <WalletAction />
              </div>

              <button
                className="-mr-1 p-1 text-foreground/60 transition-colors hover:text-foreground md:hidden"
                onClick={() => setOpen(!open)}
                aria-label="Toggle menu"
                aria-expanded={open}
              >
                {open ? <X className="size-5" /> : <Menu className="size-5" />}
              </button>
            </div>
          </div>

          <div className="relative -ml-px h-full w-[40px] shrink-0">
            <div
              className="absolute inset-0 bg-background"
              style={{ clipPath: "path('M0 0 H40 V36 C20 36 20 56 0 56 Z')" }}
            />
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 40 56" aria-hidden>
              <path d="M0 55.5 C20 55.5 20 35.5 40 35.5" fill="none" stroke={HAIR} strokeOpacity={0.09} strokeWidth={1} className="text-foreground" />
            </svg>
          </div>
        </div>

        <div className="relative z-20 -ml-px h-9 min-w-0 flex-1 bg-background">
          <svg className="absolute inset-x-0 bottom-0 h-px w-full" preserveAspectRatio="none" aria-hidden>
            <line x1="0" y1="0.5" x2="100%" y2="0.5" stroke={HAIR} strokeOpacity={0.09} strokeWidth={1} className="text-foreground" />
          </svg>
        </div>
      </header>

      {open ? (
        <div className="fixed inset-x-0 top-14 z-40 border-b border-foreground/8 bg-background p-3 shadow-sm md:hidden">
          <nav className="flex flex-col">
            {links.map((item) =>
              item.external ? (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg px-3 py-2.5 text-sm text-foreground/75 transition-colors hover:bg-foreground/5 hover:text-foreground"
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </a>
              ) : (
                <Link
                  key={item.label}
                  href={item.href}
                  className="rounded-lg px-3 py-2.5 text-sm text-foreground/75 transition-colors hover:bg-foreground/5 hover:text-foreground"
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              ),
            )}
            <div className="mt-2 border-t border-foreground/8 pt-3">
              <WalletAction block />
            </div>
          </nav>
        </div>
      ) : null}
    </>
  );
}
