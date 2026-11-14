"use client";

import { useState } from "react";
import { Box, Button, Stack, Text } from "@chakra-ui/react";
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
  const capacity = maxActionAmount(market, lending.holdings, kind, tokenId, walletBalance);
  // Prices can move between this preview and execution, and an exact-boundary amount is rejected
  // on chain when the borrow limit dips. Leave 1% headroom when health is the limiting factor.
  const max =
    capacity.limitedBy === "health" && (kind === "borrow" || kind === "withdraw_collateral")
      ? { ...capacity, amount: capacity.amount - capacity.amount / BigInt(100) }
      : capacity;
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
    <Stack
      as="form"
      gap="4"
      onSubmit={(event: React.FormEvent) => {
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
        <Button type="button" size="md" borderRadius="xl" variant="outline" onClick={() => void wallet.signIn()} disabled={wallet.connecting}>
          Connect NEAR wallet to sign
        </Button>
      ) : (
        <Button
          type="submit"
          size="md"
          w="full"
          borderRadius="xl"
          bg="ink"
          color="white"
          _hover={{ bg: "#2a2a2a" }}
          disabled={!preview?.ok || submitting}
          loading={submitting}
          loadingText="Waiting for wallet…"
        >
          {`${copy.verb} ${symbol}`}
        </Button>
      )}

      {!needsWallet ? (
        <Text textStyle="xs" color="fg.muted">
          Your wallet signs every step in one prompt: a one-time 0.1 NEAR storage deposit if this account is new to the
          contract{kind === "borrow" || kind.startsWith("withdraw") ? ", a token storage deposit if you have never held this token," : ""} then
          the {kind === "deposit_collateral" || kind === "supply" || kind === "repay" ? "ft_transfer_call (1 yoctoNEAR)" : `${kind} call (1 yoctoNEAR, 300 TGas)`}.
        </Text>
      ) : null}

      <Box aria-live="polite">
        {outcome?.kind === "success" ? (
          <Note tone="good">
            <Text fontWeight="semibold">{copy.done} on NEAR testnet</Text>
            {outcome.result.notes.map((note) => (
              <Text key={note}>{note}</Text>
            ))}
            <TxLinks hashes={outcome.result.txHashes} urls={outcome.result.explorerUrls} />
          </Note>
        ) : null}
        {outcome?.kind === "error" ? (
          <Note tone="bad">
            <Text>{outcome.message}</Text>
            {outcome.error ? <TxLinks hashes={outcome.error.txHashes} urls={outcome.error.explorerUrls} /> : null}
          </Note>
        ) : null}
      </Box>
    </Stack>
  );
}
