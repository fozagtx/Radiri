"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownUp, Loader2, Wallet } from "lucide-react";
import { CopyField } from "@/components/dashboard/copy-field";
import { Note, PageHeader, Pill, Section, SkeletonRows } from "@/components/shared/bits";
import { useNow } from "@/components/shared/use-now";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSwapHistory } from "@/hooks/use-swap-history";
import { checkAddress } from "@/lib/intents/addresses";
import { chainFamily, chainName, evmChainIdOf, txExplorerUrl } from "@/lib/intents/chains";
import type { RadiriSwapQuote, SwapQuoteResult } from "@/lib/intents/types";
import { cn } from "@/lib/utils";
import { useEvmWallet } from "@/lib/wallets/evm";
import { useNearWallet } from "@/lib/wallets/near";
import { useSolanaWallet } from "@/lib/wallets/solana";
import type { CatalogAsset, SwapQuoteFailure, SwapRecord } from "@/types/protocol";
import { AssetSelect, type CategoryFilter } from "./asset-select";
import { SwapTracker } from "./swap-tracker";
import { findAsset, useSwapCatalog } from "./use-swap-catalog";

const SLIPPAGE_OPTIONS = [50, 100, 200];
const DEFAULT_FROM = { symbol: "PEPE", chain: "eth" };
const DEFAULT_TO = { symbol: "AAPLon", chain: "bsc" };

type QuoteState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; quote: RadiriSwapQuote }
  | { state: "failed"; failure: SwapQuoteFailure };

async function requestQuote(body: Record<string, unknown>): Promise<QuoteState> {
  try {
    const res = await fetch("/api/swaps/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await res.json()) as SwapQuoteResult;
    if ("quote" in result) return { state: "ready", quote: result.quote };
    return { state: "failed", failure: result.failure };
  } catch (error) {
    return { state: "failed", failure: { kind: "error", reason: error instanceof Error ? error.message : String(error) } };
  }
}

function usd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "–";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function trimAmount(value: string, digits = 8): string {
  const [whole, fraction = ""] = value.split(".");
  const cut = fraction.slice(0, digits).replace(/0+$/, "");
  return cut ? `${whole}.${cut}` : whole;
}

function QuoteFigures({ quote }: { quote: RadiriSwapQuote }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
      <div>
        <dt className="text-muted-foreground">You send</dt>
        <dd className="font-mono">
          {trimAmount(quote.amountIn)} {quote.origin.symbol}
        </dd>
        <dd className="font-mono text-[11px] text-muted-foreground">{usd(quote.amountInUsd)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Estimated output</dt>
        <dd className="font-mono">
          {trimAmount(quote.amountOut)} {quote.destination.symbol}
        </dd>
        <dd className="font-mono text-[11px] text-muted-foreground">{usd(quote.amountOutUsd)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Minimum output</dt>
        <dd className="font-mono">
          {trimAmount(quote.minAmountOut)} {quote.destination.symbol}
        </dd>
        <dd className="text-[11px] text-muted-foreground">at {(quote.slippageBps / 100).toFixed(2)}% slippage</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Estimated time</dt>
        <dd className="font-mono">{quote.etaSeconds === null ? "–" : `${quote.etaSeconds} s`}</dd>
      </div>
      {quote.fees.length > 0 ? (
        <div className="col-span-2 sm:col-span-4">
          <dt className="text-muted-foreground">Fees reported by 1Click</dt>
          {quote.fees.map((fee) => (
            <dd key={fee.label} className="font-mono text-[11px]">
              {fee.label}: {trimAmount(fee.amount)} {fee.unit}
            </dd>
          ))}
        </div>
      ) : null}
    </dl>
  );
}

/** Address input validated against the chain's format. */
function AddressField({
  id,
  label,
  chain,
  value,
  onChange,
  suggestion,
}: {
  id: string;
  label: string;
  chain: string;
  value: string;
  onChange: (value: string) => void;
  suggestion: string | null;
}) {
  const check = value ? checkAddress(chain, value) : null;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] font-medium text-muted-foreground">
        {label} <span className="font-normal">({chainName(chain)})</span>
      </label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value.trim())} placeholder={`${chainName(chain)} address`} className="font-mono text-xs" />
      {check && check.valid === false ? <span className="text-[11px] text-destructive">{check.reason}</span> : null}
      {suggestion && suggestion !== value ? (
        <button type="button" onClick={() => onChange(suggestion)} className="w-fit text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
          Use connected wallet {suggestion.slice(0, 6)}…{suggestion.slice(-4)}
        </button>
      ) : null}
    </div>
  );
}

function useConnectedAddress(chain: string | undefined): { address: string | null; connect: (() => Promise<void>) | null; label: string } {
  const evm = useEvmWallet();
  const solana = useSolanaWallet();
  const near = useNearWallet();
  const family = chain ? chainFamily(chain) : "other";
  if (family === "evm") return { address: evm.address, connect: evm.connect, label: "EVM wallet" };
  if (family === "solana") return { address: solana.address, connect: solana.connect, label: "Solana wallet" };
  if (family === "near" && near.network === "mainnet") return { address: near.accountId, connect: near.signIn, label: "NEAR wallet" };
  return { address: null, connect: null, label: "wallet" };
}

export function SwapWorkspace() {
  const catalog = useSwapCatalog();
  const history = useSwapHistory();
  const evm = useEvmWallet();
  const solana = useSolanaWallet();
  const nowMs = useNow(5_000);

  const [fromFilter, setFromFilter] = useState<CategoryFilter>("meme");
  const [toFilter, setToFilter] = useState<CategoryFilter>("stock");
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [amount, setAmount] = useState("1000000000");
  const [slippageBps, setSlippageBps] = useState(100);
  const [indicative, setIndicative] = useState<QuoteState>({ state: "idle" });
  const [recipient, setRecipient] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [live, setLive] = useState<QuoteState>({ state: "idle" });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [manualHash, setManualHash] = useState("");
  const [tracking, setTracking] = useState<string | null>(null);

  const assets = useMemo(() => (catalog.state === "ready" ? catalog.assets : []), [catalog]);
  const from: CatalogAsset | undefined =
    assets.find((asset) => asset.id === fromId) ?? findAsset(assets, DEFAULT_FROM.symbol, DEFAULT_FROM.chain);
  const to: CatalogAsset | undefined = assets.find((asset) => asset.id === toId) ?? findAsset(assets, DEFAULT_TO.symbol, DEFAULT_TO.chain);

  const origin = useConnectedAddress(from?.chain);
  const destination = useConnectedAddress(to?.chain);

  // Indicative (dry) quote, debounced on every input change.
  useEffect(() => {
    if (!from || !to || !amount.trim() || Number(amount) <= 0) {
      const timer = setTimeout(() => setIndicative({ state: "idle" }), 0);
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setIndicative({ state: "loading" });
      const result = await requestQuote({
        originAssetId: from.id,
        destinationAssetId: to.id,
        amount: amount.trim(),
        slippageBps,
        dry: true,
      });
      if (!cancelled) setIndicative(result);
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [from, to, amount, slippageBps]);

  // A new pair or amount invalidates an executable quote.
  useEffect(() => {
    const timer = setTimeout(() => {
      setLive({ state: "idle" });
      setSendError(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [from?.id, to?.id, amount, slippageBps]);

  const recipientCheck = to && recipient ? checkAddress(to.chain, recipient) : null;
  const refundCheck = from && refundTo ? checkAddress(from.chain, refundTo) : null;
  const canRequestLive =
    !!from && !!to && indicative.state === "ready" && recipientCheck?.valid !== false && refundCheck?.valid !== false && !!recipient && !!refundTo;

  async function getExecutableQuote() {
    if (!from || !to) return;
    setLive({ state: "loading" });
    const result = await requestQuote({
      originAssetId: from.id,
      destinationAssetId: to.id,
      amount: amount.trim(),
      slippageBps,
      recipient,
      refundTo,
      dry: false,
    });
    setLive(result);
    if (result.state === "ready" && result.quote.depositAddress) {
      const now = new Date().toISOString();
      const record: SwapRecord = {
        depositAddress: result.quote.depositAddress,
        depositMemo: result.quote.depositMemo,
        quote: result.quote,
        recipient,
        refundTo,
        depositTxHash: null,
        lastStatus: "PENDING_DEPOSIT",
        createdAt: now,
        updatedAt: now,
      };
      history.upsert(record);
      setTracking(record.depositAddress);
    }
  }

  async function submitHash(quote: RadiriSwapQuote, txHash: string) {
    if (!quote.depositAddress) return;
    const existing = history.records.find((record) => record.depositAddress === quote.depositAddress);
    if (existing) history.upsert({ ...existing, depositTxHash: txHash, updatedAt: new Date().toISOString() });
    try {
      const res = await fetch("/api/swaps/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depositAddress: quote.depositAddress, txHash, ...(quote.depositMemo ? { memo: quote.depositMemo } : {}) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setSendError(`Deposit sent (${txHash}), but 1Click did not register the hash yet: ${body.error ?? `HTTP ${res.status}`}. It also detects deposits on its own.`);
      }
    } catch (error) {
      setSendError(`Deposit sent (${txHash}); notifying 1Click failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function sendWithWallet(quote: RadiriSwapQuote) {
    if (!from || !quote.depositAddress) return;
    setSending(true);
    setSendError(null);
    try {
      const family = chainFamily(from.chain);
      let hash: string;
      if (family === "evm") {
        const chainId = evmChainIdOf(from.chain);
        if (chainId === null) throw new Error(`No EVM chain id known for ${from.chain}`);
        hash = await evm.sendDeposit({
          chainId,
          token: from.contractAddress ? (from.contractAddress as `0x${string}`) : null,
          to: quote.depositAddress as `0x${string}`,
          amount: BigInt(quote.amountInBase),
        });
      } else if (family === "solana") {
        hash = await solana.sendDeposit({ mint: from.contractAddress, to: quote.depositAddress, amount: BigInt(quote.amountInBase), decimals: from.decimals });
      } else {
        throw new Error(`Sending from ${chainName(from.chain)} is manual: copy the deposit address and exact amount below.`);
      }
      await submitHash(quote, hash);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  }

  const liveQuote = live.state === "ready" ? live.quote : null;
  const deadlinePassed = liveQuote?.deadline && nowMs > 0 ? nowMs > Date.parse(liveQuote.deadline) : false;
  const trackedRecord = tracking ? history.records.find((record) => record.depositAddress === tracking) : undefined;
  const walletFamily = from ? chainFamily(from.chain) : "other";

  return (
    <>
      <PageHeader
        title="Swap"
        description="Swap meme coins for tokenized stocks (and back) across chains through NEAR Intents 1Click."
      />
      <div className="mb-3">
        <Note tone="warn">
          NEAR Intents has no testnet: swaps run on mainnet with real funds. You sign the deposit in your own wallet; Radiri never holds
          a key. Tokenized stocks here are Ondo Global Markets tokens; availability depends on your region and on 1Click.
        </Note>
      </div>

      {catalog.state === "loading" ? (
        <SkeletonRows rows={5} />
      ) : catalog.state === "error" ? (
        <Note tone="bad">The 1Click asset catalog could not be loaded: {catalog.error}</Note>
      ) : (
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Section title="1 · Choose the swap" description="Source and destination asset with their networks, amount and slippage.">
            <div className="flex flex-col gap-3">
              <AssetSelect label="From" assets={assets} filter={fromFilter} onFilterChange={setFromFilter} value={from?.id ?? null} onChange={setFromId} />
              <div className="flex justify-center">
                <button
                  type="button"
                  aria-label="Reverse the swap direction"
                  onClick={() => {
                    setFromId(to?.id ?? null);
                    setToId(from?.id ?? null);
                    setFromFilter(toFilter);
                    setToFilter(fromFilter);
                  }}
                  className="grid size-8 place-items-center rounded-full border border-foreground/15 text-foreground/70 transition-colors hover:border-foreground/35 hover:text-foreground"
                >
                  <ArrowDownUp className="size-3.5" aria-hidden />
                </button>
              </div>
              <AssetSelect label="To" assets={assets} filter={toFilter} onFilterChange={setToFilter} value={to?.id ?? null} onChange={setToId} />

              <div className="flex flex-col gap-1">
                <label htmlFor="swap-amount" className="text-[11px] font-medium text-muted-foreground">
                  Amount{from ? ` (${from.symbol})` : ""}
                </label>
                <Input id="swap-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))} className="font-mono" />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">Slippage</span>
                {SLIPPAGE_OPTIONS.map((bps) => (
                  <button
                    key={bps}
                    type="button"
                    aria-pressed={slippageBps === bps}
                    onClick={() => setSlippageBps(bps)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 font-mono text-[11px] transition-colors",
                      slippageBps === bps ? "border-foreground bg-foreground text-background" : "border-foreground/15 text-foreground/70 hover:border-foreground/35",
                    )}
                  >
                    {(bps / 100).toFixed(1)}%
                  </button>
                ))}
              </div>

              <div className="rounded-xl bg-foreground/[0.03] px-3 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-muted-foreground">Indicative quote (dry run)</span>
                  {indicative.state === "loading" ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden /> : null}
                </div>
                {indicative.state === "ready" ? (
                  <QuoteFigures quote={indicative.quote} />
                ) : indicative.state === "failed" ? (
                  <Note tone={indicative.failure.kind === "no-liquidity" ? "warn" : "bad"}>
                    1Click: {indicative.failure.reason}
                  </Note>
                ) : indicative.state === "idle" ? (
                  <p className="text-xs text-muted-foreground">Enter an amount to get a quote.</p>
                ) : (
                  <SkeletonRows rows={2} />
                )}
              </div>
            </div>
          </Section>

          <div className="flex flex-col gap-3">
            <Section title="2 · Recipient and refund" description="Where the output goes, and where a refund goes if the swap cannot complete.">
              {from && to ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    {origin.connect && !origin.address ? (
                      <Button size="sm" variant="outline" onClick={() => void origin.connect?.().catch((error: unknown) => setSendError(error instanceof Error ? error.message : String(error)))}>
                        <Wallet aria-hidden />
                        Connect {origin.label} ({chainName(from.chain)})
                      </Button>
                    ) : null}
                    {destination.connect && !destination.address && destination.label !== origin.label ? (
                      <Button size="sm" variant="outline" onClick={() => void destination.connect?.().catch((error: unknown) => setSendError(error instanceof Error ? error.message : String(error)))}>
                        <Wallet aria-hidden />
                        Connect {destination.label} ({chainName(to.chain)})
                      </Button>
                    ) : null}
                  </div>
                  <AddressField id="swap-recipient" label="Recipient" chain={to.chain} value={recipient} onChange={setRecipient} suggestion={destination.address} />
                  <AddressField id="swap-refund" label="Refund address" chain={from.chain} value={refundTo} onChange={setRefundTo} suggestion={origin.address} />
                  <Button onClick={() => void getExecutableQuote()} disabled={!canRequestLive || live.state === "loading"}>
                    {live.state === "loading" ? <Loader2 className="animate-spin" aria-hidden /> : null}
                    Get executable quote
                  </Button>
                  {live.state === "failed" ? <Note tone="bad">1Click: {live.failure.reason}</Note> : null}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Choose both assets first.</p>
              )}
            </Section>

            {liveQuote && liveQuote.depositAddress ? (
              <Section
                title="3 · Send the deposit"
                description={liveQuote.deadline ? `Send before ${new Date(liveQuote.deadline).toLocaleString()}, or the deposit is refunded.` : undefined}
                action={liveQuote.signatureVerified ? <Pill tone="good">quote signature verified</Pill> : null}
              >
                <div className="flex flex-col gap-3">
                  <QuoteFigures quote={liveQuote} />
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-muted-foreground">Deposit address ({chainName(liveQuote.origin.chain)})</span>
                    <CopyField value={liveQuote.depositAddress} label="deposit address" />
                  </div>
                  {liveQuote.depositMemo ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] font-medium text-muted-foreground">Deposit memo (required)</span>
                      <CopyField value={liveQuote.depositMemo} label="deposit memo" />
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-muted-foreground">Exact amount</span>
                    <CopyField value={`${liveQuote.amountIn}`} label="amount" />
                  </div>

                  {deadlinePassed ? (
                    <Note tone="warn">This quote has expired. Request a new executable quote before sending anything.</Note>
                  ) : walletFamily === "evm" || walletFamily === "solana" ? (
                    <Button onClick={() => void sendWithWallet(liveQuote)} disabled={sending || !origin.address}>
                      {sending ? <Loader2 className="animate-spin" aria-hidden /> : <Wallet aria-hidden />}
                      {origin.address ? `Send ${trimAmount(liveQuote.amountIn)} ${liveQuote.origin.symbol} with ${origin.label}` : `Connect ${origin.label} to send`}
                    </Button>
                  ) : (
                    <Note tone="neutral">Send the exact amount from any {chainName(liveQuote.origin.chain)} wallet to the deposit address above.</Note>
                  )}

                  <div className="flex flex-col gap-1">
                    <label htmlFor="swap-hash" className="text-[11px] font-medium text-muted-foreground">
                      Sent manually? Paste the deposit transaction hash (optional, speeds up detection)
                    </label>
                    <div className="flex gap-2">
                      <Input id="swap-hash" value={manualHash} onChange={(event) => setManualHash(event.target.value.trim())} className="font-mono text-xs" />
                      <Button variant="outline" disabled={!manualHash} onClick={() => void submitHash(liveQuote, manualHash)}>
                        Submit
                      </Button>
                    </div>
                  </div>
                  {sendError ? <Note tone="bad">{sendError}</Note> : null}
                </div>
              </Section>
            ) : null}

            {trackedRecord ? (
              <Section title="4 · Settlement" description="Status straight from 1Click. Radiri never infers a success.">
                <SwapTracker record={trackedRecord} />
                {trackedRecord.depositTxHash ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Deposit tx:{" "}
                    {txExplorerUrl(trackedRecord.quote.origin.chain, trackedRecord.depositTxHash) ? (
                      <a className="font-mono underline underline-offset-2" href={txExplorerUrl(trackedRecord.quote.origin.chain, trackedRecord.depositTxHash) ?? undefined} target="_blank" rel="noreferrer">
                        {trackedRecord.depositTxHash.slice(0, 12)}…
                      </a>
                    ) : (
                      <span className="font-mono">{trackedRecord.depositTxHash}</span>
                    )}
                  </p>
                ) : null}
              </Section>
            ) : null}
          </div>
        </div>
      )}

      {history.records.length > 0 ? (
        <Section title="Your swaps" description="Started in this browser. Select one to track its settlement." className="mt-3">
          <ul className="divide-y divide-foreground/6">
            {history.records.slice(0, 10).map((record) => (
              <li key={record.depositAddress} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                <span>
                  <span className="font-mono">
                    {trimAmount(record.quote.amountIn, 4)} {record.quote.origin.symbol}
                  </span>{" "}
                  ({chainName(record.quote.origin.chain)}) →{" "}
                  <span className="font-mono">
                    {trimAmount(record.quote.amountOut, 6)} {record.quote.destination.symbol}
                  </span>{" "}
                  ({chainName(record.quote.destination.chain)})
                </span>
                <span className="flex items-center gap-2">
                  <Pill>{record.lastStatus}</Pill>
                  <button
                    type="button"
                    onClick={() => setTracking(record.depositAddress)}
                    className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    Track
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
