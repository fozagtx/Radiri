"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2">
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[11.5px] whitespace-pre text-foreground/80">
        {value}
      </code>
      <button
        onClick={() => void copy()}
        className="flex shrink-0 items-center gap-1 rounded-full border border-foreground/15 px-2.5 py-1 text-[11px] text-foreground/70 transition-colors hover:border-foreground/35 hover:text-foreground"
        aria-label={label ? `Copy ${label}` : "Copy"}
      >
        {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
