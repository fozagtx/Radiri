import { FlaskConical } from "lucide-react";
import { EXPLORER_URL, LENDING_CONTRACT_ID } from "@/lib/config";

/** One-line note on the lending pages: live NEAR testnet contract, test tokens with no value. */
export function ModeBanner() {
  return (
    <div
      role="note"
      className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-foreground/10 bg-card/70 px-3.5 py-2.5 text-[12px] text-muted-foreground"
    >
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        <span className="radiri-live-dot size-1.5 rounded-full bg-emerald-600" aria-hidden />
        Live on NEAR testnet
      </span>
      <span aria-hidden>·</span>
      <a href={`${EXPLORER_URL}/address/${LENDING_CONTRACT_ID}`} target="_blank" rel="noreferrer" className="font-mono underline underline-offset-2 hover:text-foreground">
        {LENDING_CONTRACT_ID}
      </a>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-1">
        <FlaskConical className="size-3" aria-hidden />
        Test tokens with no value, priced at their real meme coin and stock references
      </span>
    </div>
  );
}
