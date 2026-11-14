"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { ModeBadge, WalletSection } from "./wallet-section";

/** Phone-width strip under the notch navbar: mode badge always visible, wallets on demand. */
export function MobileWalletBar() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-foreground/8 px-4 pb-2 md:hidden">
      <div className="flex items-center justify-between gap-2">
        <ModeBadge />
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mobile-wallets"
          className="inline-flex items-center gap-1 rounded-full border border-foreground/15 px-2.5 py-1 text-[11.5px] text-foreground/75"
        >
          Wallets
          <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </div>
      {open ? (
        <div id="mobile-wallets" className="mt-2 rounded-xl border border-foreground/10 bg-card p-3">
          <WalletSection />
        </div>
      ) : null}
    </div>
  );
}
