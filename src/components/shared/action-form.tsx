"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type ExecutionResult, LendingActionError } from "@/lib/lending";
import { type LendingActionKind, maxActionAmount, previewAction, tryParseUnits } from "@/lib/risk";
import { useNearWallet } from "@/lib/wallets/near";
import { AmountInput } from "./amount-input";
import { Note, ReasonList, TxLinks } from "./bits";
import { message } from "./format";
import { useLending } from "./lending-provider";
import { ReviewPanel } from "./review-panel";

export const ACTION_COPY: Record<LendingActionKind, { label: string; verb: string; done: string }> = {
  deposit_collateral: { label: "Deposit amount", verb: "Deposit", done: "Collateral deposited" },
  withdraw_collateral: { label: "Withdraw amount", verb: "Withdraw", done: "Collateral withdrawn" },
  supply: { label: "Supply amount", verb: "Supply", done: "Supplied" },
  withdraw_supply: { label: "Withdraw amount", verb: "Withdraw", done: "Supply withdrawn" },
  borrow: { label: "Borrow amount", verb: "Borrow", done: "Borrowed" },
  repay: { label: "Repay amount", verb: "Repay", done: "Repaid" },
};

const USES_WALLET: LendingActionKind[] = ["deposit_collateral", "supply", "repay"];

type Outcome =
  | { kind: "success"; result: ExecutionResult }
  | { kind: "error"; message: string; error: LendingActionError | null };

/**
 * Amount -> live preview -> blocking reasons -> confirm, for one lending action on one token.
 * Mount with `key={kind + tokenId}` so switching assets starts from a clean form.
 */
export function ActionForm({
  kind,
  tokenId,
  focusCollateralId,
  onDone,
}: {
  kind: LendingActionKind;
  tokenId: string;
  /** Collateral whose liquidation price the review shows (borrow / repay). */
  focusCollateralId?: string | null;
  onDone?: () => void;
}) {
  const lending = useLending();
  const wallet = useNearWallet();
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const asset = lending.assetIndex.get(tokenId);
  const market = lending.market;
  if (!asset || !market) return null;

  const decimals = asset.config.decimals;
  const symbol = asset.config.symbol;
  const walletBalance = USES_WALLET.includes(kind) ? lending.balances[tokenId]?.amount ?? null : null;
  const parsed = tryParseUnits(input, decimals);
  const max = maxActionAmount(market, lending.holdings, kind, tokenId, walletBalance);
  const preview = parsed !== null ? previewAction(market, lending.holdings, { kind, tokenId, amount: parsed, walletBalance }) : null;
  const needsWallet = lending.mode === "near" && !lending.walletAccountId;
  const balanceLabel =
    kind === "deposit_collateral" || kind === "supply" || kind === "repay"
      ? { label: lending.mode === "near" ? "Wallet" : "Sim wallet", amount: walletBalance }
      : kind === "withdraw_collateral"
        ? { label: "Deposited", amount: lending.holdings.collateral[tokenId] ?? BigInt(0) }
        : kind === "withdraw_supply"
          ? { label: "Supplied", amount: lending.holdings.supplied[tokenId] ?? BigInt(0) }
          : { label: "Pool cash", amount: BigInt(asset.cash) };

  async function submit() {
    if (!preview?.ok || parsed === null) return;
    setSubmitting(true);
    setOutcome(null);
    try {
      const result = await lending.execute({ kind, tokenId, amount: parsed.toString() });
      setOutcome({ kind: "success", result });
      setInput("");
      onDone?.();
    } catch (error) {
      setOutcome({ kind: "error", message: message(error), error: error instanceof LendingActionError ? error : null });
    } finally {
      setSubmitting(false);
    }
  }

  const copy = ACTION_COPY[kind];

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <AmountInput
        id={`amount-${kind}-${tokenId}`}
        label={copy.label}
        value={input}
        onChange={(value) => {
          setInput(value);
          setOutcome(null);
        }}
        decimals={decimals}
        symbol={symbol}
        max={max}
        balance={balanceLabel}
        disabled={submitting}
      />

      {preview ? (
        <ReviewPanel preview={preview} market={market} holdingsBefore={lending.holdings} focusCollateralId={focusCollateralId} />
      ) : null}
      {preview ? <ReasonList reasons={preview.reasons} /> : null}

      {needsWallet ? (
        <Button type="button" variant="outline" onClick={() => void wallet.signIn()} disabled={wallet.connecting}>
          Connect NEAR wallet to sign
        </Button>
      ) : (
        <Button type="submit" size="lg" disabled={!preview?.ok || submitting} className="w-full">
          {submitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {submitting
            ? lending.mode === "near"
              ? "Waiting for wallet…"
              : "Simulating…"
            : `${copy.verb} ${symbol}${lending.mode === "simulation" ? " (simulation)" : ""}`}
        </Button>
      )}

      {lending.mode === "near" && !needsWallet ? (
        <p className="text-[11px] text-muted-foreground">
          Your wallet signs every step in one prompt: a one-time 0.1 NEAR storage deposit if this account is new to the
          contract{kind === "borrow" || kind.startsWith("withdraw") ? ", a token storage deposit if you have never held this token," : ""} then
          the {kind === "deposit_collateral" || kind === "supply" || kind === "repay" ? "ft_transfer_call (1 yoctoNEAR)" : `${kind} call (1 yoctoNEAR, 300 TGas)`}.
        </p>
      ) : null}

      <div aria-live="polite">
        {outcome?.kind === "success" ? (
          <Note tone="good">
            <p className="font-medium">
              {copy.done}
              {outcome.result.mode === "simulation" ? " in the simulation · no on-chain transaction" : " on chain"}
            </p>
            {outcome.result.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
            <TxLinks hashes={outcome.result.txHashes} urls={outcome.result.explorerUrls} />
          </Note>
        ) : null}
        {outcome?.kind === "error" ? (
          <Note tone="bad">
            <p>{outcome.message}</p>
            {outcome.error ? <TxLinks hashes={outcome.error.txHashes} urls={outcome.error.explorerUrls} /> : null}
          </Note>
        ) : null}
      </div>
    </form>
  );
}
