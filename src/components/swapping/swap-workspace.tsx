"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ChevronDown, Clock, Loader2, Settings2, ShieldCheck, Wallet, Zap } from "lucide-react";
import { TokenAvatar } from "@/components/app/token-avatar";
import { CopyField } from "@/components/dashboard/copy-field";
import { Note, Pill } from "@/components/shared/bits";
import { useNow } from "@/components/shared/use-now";
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
import { SwapTracker } from "./swap-tracker";
import { swappable, TokenSelector, type SwapCategory } from "./token-selector";
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
    const res = await fetch("/api/swaps/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = (await res.json()) as SwapQuoteResult;
    if ("quote" in result) return { state: "ready", quote: result.quote };
    return { state: "failed", failure: result.failure };
  } catch (error) {
    return { state: "failed", failure: { kind: "error", reason: error instanceof Error ? error.message : String(error) } };
  }
}

function usd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function trimAmount(value: string, digits = 6): string {
  const [whole, fraction = ""] = value.split(".");
  const cut = fraction.slice(0, digits).replace(/0+$/, "");
  const grouped = Number(whole).toLocaleString("en-US");
  return cut ? `${grouped}.${cut}` : grouped;
}

function rate(quote: RadiriSwapQuote): string {
  const inAmount = Number(quote.amountIn);
  const outAmount = Number(quote.amountOut);
  if (!inAmount || !outAmount) return "";
  const perOut = inAmount / outAmount;
  return `1 ${quote.destination.symbol} ≈ ${perOut >= 1 ? perOut.toLocaleString("en-US", { maximumFractionDigits: 2 }) : perOut.toPrecision(4)} ${quote.origin.symbol}`;
}

function countdown(deadline: string | null, nowMs: number): string | null {
  if (!deadline || nowMs === 0) return null;
  const left = Date.parse(deadline) - nowMs;
  if (left <= 0) return "expired";
  const minutes = Math.floor(left / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function TokenButton({ asset, onClick }: { asset: CatalogAsset | undefined; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-2 rounded-full border border-foreground/10 bg-card py-1.5 pr-3 pl-1.5 shadow-sm transition-all hover:border-foreground/30 hover:shadow"
    >
      {asset ? <TokenAvatar symbol={asset.symbol} category={asset.category} chain={asset.chain} size="sm" /> : null}
      <span className="flex flex-col items-start leading-tight">
        <span className="text-[15px] font-semibold tracking-tight">{asset?.symbol ?? "Select"}</span>
        {asset ? <span className="text-[10.5px] text-muted-foreground">{chainName(asset.chain)}</span> : null}
      </span>
      <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
    </button>
  );
}

function AddressField({ id, label, chain, value, onChange, suggestion }: { id: string; label: string; chain: string; value: string; onChange: (value: string) => void; suggestion: string | null }) {
  const check = value ? checkAddress(chain, value) : null;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-medium text-muted-foreground">
        {label} on {chainName(chain)}
      </label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value.trim())} placeholder={`${chainName(chain)} address`} className="h-10 rounded-xl font-mono text-xs" />
      {check && check.valid === false ? <span className="text-[11px] text-destructive">{check.reason}</span> : null}
      {suggestion && suggestion !== value ? (
        <button type="button" onClick={() => onChange(suggestion)} className="w-fit text-[11.5px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
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
  const nowMs = useNow(1_000);

  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
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

  const assets = useMemo(() => (catalog.state === "ready" ? swappable(catalog.assets) : []), [catalog]);
  const from = assets.find((asset) => asset.id === fromId) ?? findAsset(assets, DEFAULT_FROM.symbol, DEFAULT_FROM.chain);
  const to = assets.find((asset) => asset.id === toId) ?? findAsset(assets, DEFAULT_TO.symbol, DEFAULT_TO.chain);
  const origin = useConnectedAddress(from?.chain);
  const destination = useConnectedAddress(to?.chain);

  useEffect(() => {
    if (!from || !to || !amount.trim() || Number(amount) <= 0) {
      const timer = setTimeout(() => setIndicative({ state: "idle" }), 0);
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    const run = async () => {
      setIndicative((state) => (state.state === "ready" ? state : { state: "loading" }));
      const result = await requestQuote({ originAssetId: from.id, destinationAssetId: to.id, amount: amount.trim(), slippageBps, dry: true });
      if (!cancelled) setIndicative(result);
    };
    const timer = setTimeout(run, 500);
    const refresh = setInterval(run, 20_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(refresh);
    };
  }, [from, to, amount, slippageBps]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLive({ state: "idle" });
      setSendError(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [from?.id, to?.id, amount, slippageBps]);

  const quote = indicative.state === "ready" ? indicative.quote : null;
  const recipientCheck = to && recipient ? checkAddress(to.chain, recipient) : null;
  const refundCheck = from && refundTo ? checkAddress(from.chain, refundTo) : null;
  const addressesReady = !!recipient && !!refundTo && recipientCheck?.valid !== false && refundCheck?.valid !== false;
  const liveQuote = live.state === "ready" ? live.quote : null;
  const timeLeft = countdown(liveQuote?.deadline ?? null, nowMs);
  const deadlinePassed = timeLeft === "expired";
  const trackedRecord = tracking ? history.records.find((record) => record.depositAddress === tracking) : undefined;
  const walletFamily = from ? chainFamily(from.chain) : "other";
  const impact = quote && quote.amountInUsd && quote.amountOutUsd ? ((quote.amountOutUsd - quote.amountInUsd) / quote.amountInUsd) * 100 : null;

  async function getExecutableQuote() {
    if (!from || !to) return;
    setLive({ state: "loading" });
    const result = await requestQuote({ originAssetId: from.id, destinationAssetId: to.id, amount: amount.trim(), slippageBps, recipient, refundTo, dry: false });
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

  async function submitHash(target: RadiriSwapQuote, txHash: string) {
    if (!target.depositAddress) return;
    const existing = history.records.find((record) => record.depositAddress === target.depositAddress);
    if (existing) history.upsert({ ...existing, depositTxHash: txHash, updatedAt: new Date().toISOString() });
    try {
      const res = await fetch("/api/swaps/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depositAddress: target.depositAddress, txHash, ...(target.depositMemo ? { memo: target.depositMemo } : {}) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setSendError(`Deposit sent (${txHash}); 1Click has not registered the hash yet: ${body.error ?? `HTTP ${res.status}`}. It also detects deposits on its own.`);
      }
    } catch (error) {
      setSendError(`Deposit sent (${txHash}); notifying 1Click failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function sendWithWallet(target: RadiriSwapQuote) {
    if (!from || !target.depositAddress) return;
    setSending(true);
    setSendError(null);
    try {
      let hash: string;
      if (walletFamily === "evm") {
        const chainId = evmChainIdOf(from.chain);
        if (chainId === null) throw new Error(`No EVM chain id known for ${from.chain}`);
        hash = await evm.sendDeposit({
          chainId,
          token: from.contractAddress ? (from.contractAddress as `0x${string}`) : null,
          to: target.depositAddress as `0x${string}`,
          amount: BigInt(target.amountInBase),
        });
      } else if (walletFamily === "solana") {
        hash = await solana.sendDeposit({ mint: from.contractAddress, to: target.depositAddress, amount: BigInt(target.amountInBase), decimals: from.decimals });
      } else {
        throw new Error(`Send from ${chainName(from.chain)} manually: copy the deposit address and exact amount.`);
      }
      await submitHash(target, hash);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  }

  const cta = (() => {
    if (!from || !to) return { label: "Select tokens", disabled: true };
    if (!amount.trim() || Number(amount) <= 0) return { label: "Enter an amount", disabled: true };
    if (indicative.state === "loading") return { label: "Finding the best route…", disabled: true, busy: true };
    if (indicative.state === "failed") return { label: indicative.failure.kind === "no-liquidity" ? "No route at this size" : "Quote unavailable", disabled: true };
    if (!addressesReady) return { label: "Add recipient and refund address", disabled: true };
    if (live.state === "loading") return { label: "Locking the quote…", disabled: true, busy: true };
    return { label: liveQuote ? "Get a fresh deposit address" : "Get deposit address", disabled: false };
  })();

  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col gap-4">
      <div className="radiri-rise text-center">
        <h1 className="font-display text-[34px] leading-tight sm:text-[40px]">Swap meme coins for stocks</h1>
        <p className="mt-1 text-[13.5px] text-muted-foreground">Any chain in, any chain out. Settled by NEAR Intents solvers.</p>
      </div>

      <div className="radiri-rise relative rounded-[28px] border border-foreground/10 bg-card p-2 shadow-[0_30px_80px_-40px_rgba(25,25,25,0.45)]" style={{ animationDelay: "60ms" }}>
        {catalog.state === "loading" ? (
          <div className="flex h-72 items-center justify-center text-[13px] text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
            Loading the NEAR Intents catalog…
          </div>
        ) : catalog.state === "error" ? (
          <div className="p-3">
            <Note tone="bad">The NEAR Intents catalog could not be loaded: {catalog.error}</Note>
          </div>
        ) : picking ? (
          <TokenSelector
            title={picking === "from" ? "You pay with" : "You receive"}
            assets={assets}
            initialCategory={(picking === "from" ? from?.category : to?.category) === "stock" ? "stock" : ("meme" as SwapCategory)}
            selectedId={(picking === "from" ? from?.id : to?.id) ?? null}
            onSelect={(asset) => {
              if (picking === "from") setFromId(asset.id);
              else setToId(asset.id);
              setPicking(null);
            }}
            onClose={() => setPicking(null)}
          />
        ) : (
          <>
            <div className="flex items-center justify-between px-3 pt-1.5 pb-2">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
                <span className="radiri-live-dot size-1.5 rounded-full bg-emerald-600" aria-hidden />
                Live quotes · refreshed every 20s
              </span>
              <button
                type="button"
                onClick={() => setShowSettings((value) => !value)}
                aria-expanded={showSettings}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-foreground/6 hover:text-foreground"
              >
                <Settings2 className="size-3.5" aria-hidden />
                {(slippageBps / 100).toFixed(1)}% slippage
              </button>
            </div>
            {showSettings ? (
              <div className="mx-1 mb-2 flex items-center gap-2 rounded-2xl bg-foreground/[0.035] px-3 py-2">
                <span className="text-[12px] text-muted-foreground">Max slippage</span>
                {SLIPPAGE_OPTIONS.map((bps) => (
                  <button
                    key={bps}
                    type="button"
                    aria-pressed={slippageBps === bps}
                    onClick={() => setSlippageBps(bps)}
                    className={cn("rounded-full px-2.5 py-0.5 font-mono text-[12px] transition-colors", slippageBps === bps ? "bg-foreground text-background" : "text-foreground/70 hover:bg-foreground/6")}
                  >
                    {(bps / 100).toFixed(1)}%
                  </button>
                ))}
              </div>
            ) : null}

            <div className="relative flex flex-col gap-1">
              <div className="rounded-[22px] bg-foreground/[0.035] px-4 py-4 transition-colors focus-within:bg-foreground/[0.055]">
                <div className="text-[12.5px] text-muted-foreground">You pay</div>
                <div className="mt-1 flex items-center gap-3">
                  <input
                    aria-label={`Amount of ${from?.symbol ?? "the source token"}`}
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
                    className="w-full min-w-0 bg-transparent font-mono text-[30px] tracking-tight tabular-nums outline-none sm:text-[34px]"
                    placeholder="0"
                  />
                  <TokenButton asset={from} onClick={() => setPicking("from")} />
                </div>
                <div className="mt-1 h-4 text-[12px] text-muted-foreground">{usd(quote?.amountInUsd ?? (from?.priceUsd && Number(amount) ? from.priceUsd * Number(amount) : null))}</div>
              </div>

              <button
                type="button"
                aria-label="Reverse the swap direction"
                onClick={() => {
                  setFromId(to?.id ?? null);
                  setToId(from?.id ?? null);
                }}
                className="absolute top-1/2 left-1/2 z-10 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-2xl border-4 border-card bg-foreground/[0.06] text-foreground/75 backdrop-blur transition-all hover:rotate-180 hover:bg-foreground hover:text-background"
              >
                <ArrowDown className="size-4" aria-hidden />
              </button>

              <div className="rounded-[22px] bg-foreground/[0.035] px-4 py-4">
                <div className="text-[12.5px] text-muted-foreground">You receive</div>
                <div className="mt-1 flex items-center gap-3">
                  <div className={cn("w-full min-w-0 truncate font-mono text-[30px] tracking-tight tabular-nums sm:text-[34px]", !quote && "text-foreground/30")}>
                    {quote ? trimAmount(quote.amountOut, 6) : indicative.state === "loading" ? <span className="inline-block h-8 w-40 animate-pulse rounded-lg bg-foreground/8 align-middle" /> : "0"}
                  </div>
                  <TokenButton asset={to} onClick={() => setPicking("to")} />
                </div>
                <div className="mt-1 h-4 text-[12px] text-muted-foreground">
                  {usd(quote?.amountOutUsd)}
                  {impact !== null ? <span className={cn("ml-1.5", impact < -3 ? "text-destructive" : "")}>({impact.toFixed(2)}%)</span> : null}
                </div>
              </div>
            </div>

            {indicative.state === "failed" ? (
              <div className="mx-1 mt-2">
                <Note tone={indicative.failure.kind === "no-liquidity" ? "warn" : "bad"}>
                  NEAR Intents: {indicative.failure.reason}
                  {indicative.failure.kind === "no-liquidity" ? ". Try a smaller amount." : ""}
                </Note>
              </div>
            ) : null}

            {quote ? (
              <div className="mx-1 mt-2 rounded-2xl border border-foreground/8 px-3.5 py-2.5 text-[12.5px]">
                <button type="button" onClick={() => setShowDetails((value) => !value)} aria-expanded={showDetails} className="flex w-full items-center justify-between gap-2">
                  <span className="font-mono text-foreground/80">{rate(quote)}</span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="size-3.5" aria-hidden />
                    {quote.etaSeconds === null ? "–" : `~${quote.etaSeconds}s`}
                    <ChevronDown className={cn("size-3.5 transition-transform", showDetails && "rotate-180")} aria-hidden />
                  </span>
                </button>
                {showDetails ? (
                  <dl className="mt-2.5 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 border-t border-foreground/8 pt-2.5">
                    <dt className="text-muted-foreground">Minimum received</dt>
                    <dd className="text-right font-mono">
                      {trimAmount(quote.minAmountOut, 6)} {quote.destination.symbol}
                    </dd>
                    <dt className="text-muted-foreground">Route</dt>
                    <dd className="text-right">
                      {chainName(quote.origin.chain)} → NEAR Intents → {chainName(quote.destination.chain)}
                    </dd>
                    {quote.fees.map((fee) => (
                      <div key={fee.label} className="contents">
                        <dt className="text-muted-foreground">{fee.label}</dt>
                        <dd className="text-right font-mono">
                          {trimAmount(fee.amount, 8)} {fee.unit}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            ) : null}

            {from && to ? (
              <div className="mx-1 mt-2 flex flex-col gap-3 rounded-2xl border border-foreground/8 px-3.5 py-3">
                <div className="flex flex-wrap gap-2">
                  {origin.connect && !origin.address ? (
                    <button type="button" onClick={() => void origin.connect?.().catch((error: unknown) => setSendError(error instanceof Error ? error.message : String(error)))} className="inline-flex items-center gap-1.5 rounded-full border border-foreground/15 px-3 py-1.5 text-[12px] font-medium hover:border-foreground/35">
                      <Wallet className="size-3.5" aria-hidden />
                      Connect {origin.label}
                    </button>
                  ) : null}
                  {destination.connect && !destination.address && destination.label !== origin.label ? (
                    <button type="button" onClick={() => void destination.connect?.().catch((error: unknown) => setSendError(error instanceof Error ? error.message : String(error)))} className="inline-flex items-center gap-1.5 rounded-full border border-foreground/15 px-3 py-1.5 text-[12px] font-medium hover:border-foreground/35">
                      <Wallet className="size-3.5" aria-hidden />
                      Connect {destination.label}
                    </button>
                  ) : null}
                </div>
                <AddressField id="swap-recipient" label={`Receive ${to.symbol}`} chain={to.chain} value={recipient} onChange={setRecipient} suggestion={destination.address} />
                <AddressField id="swap-refund" label="Refund address" chain={from.chain} value={refundTo} onChange={setRefundTo} suggestion={origin.address} />
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => void getExecutableQuote()}
              disabled={cta.disabled}
              className="mx-1 mt-2 mb-1 flex h-14 w-[calc(100%-0.5rem)] items-center justify-center gap-2 rounded-[20px] bg-foreground text-[15.5px] font-semibold text-background transition-all hover:bg-foreground/85 disabled:bg-foreground/10 disabled:text-foreground/40"
            >
              {cta.busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Zap className="size-4" aria-hidden />}
              {cta.label}
            </button>
            {live.state === "failed" ? (
              <div className="mx-1 mb-1">
                <Note tone="bad">NEAR Intents: {live.failure.reason}</Note>
              </div>
            ) : null}
          </>
        )}
      </div>

      {liveQuote && liveQuote.depositAddress && !picking ? (
        <div className="radiri-rise rounded-[28px] border border-foreground/10 bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold tracking-tight">Send your {liveQuote.origin.symbol}</h2>
            <span className="flex items-center gap-2">
              {liveQuote.signatureVerified ? (
                <Pill tone="good">
                  <ShieldCheck className="size-3" aria-hidden />
                  signed quote
                </Pill>
              ) : null}
              {timeLeft ? <Pill tone={deadlinePassed ? "bad" : "neutral"}>{deadlinePassed ? "expired" : `${timeLeft} left`}</Pill> : null}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Send exactly this amount on {chainName(liveQuote.origin.chain)}. Solvers deliver {trimAmount(liveQuote.amountOut, 6)} {liveQuote.destination.symbol} to your recipient, or refund you.
          </p>
          <div className="mt-3 flex flex-col gap-2.5">
            <CopyField value={liveQuote.depositAddress} label="deposit address" />
            {liveQuote.depositMemo ? <CopyField value={liveQuote.depositMemo} label="deposit memo" /> : null}
            <CopyField value={liveQuote.amountIn} label="amount" />
            {deadlinePassed ? (
              <Note tone="warn">This quote expired. Get a fresh deposit address before sending anything.</Note>
            ) : walletFamily === "evm" || walletFamily === "solana" ? (
              <button
                type="button"
                onClick={() => void sendWithWallet(liveQuote)}
                disabled={sending || !origin.address}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-foreground text-[14.5px] font-semibold text-background transition-colors hover:bg-foreground/85 disabled:bg-foreground/10 disabled:text-foreground/40"
              >
                {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <TokenAvatar symbol={liveQuote.origin.symbol} category="meme" size="xs" />}
                {origin.address ? `Send ${trimAmount(liveQuote.amountIn, 4)} ${liveQuote.origin.symbol} with your ${origin.label}` : `Connect your ${origin.label} to send`}
              </button>
            ) : (
              <Note tone="neutral">Send the exact amount from any {chainName(liveQuote.origin.chain)} wallet to the deposit address.</Note>
            )}
            <div className="flex gap-2">
              <Input aria-label="Deposit transaction hash" placeholder="Sent manually? Paste the transaction hash" value={manualHash} onChange={(event) => setManualHash(event.target.value.trim())} className="h-10 rounded-xl font-mono text-xs" />
              <button type="button" disabled={!manualHash} onClick={() => void submitHash(liveQuote, manualHash)} className="shrink-0 rounded-xl border border-foreground/15 px-3 text-[12.5px] font-medium disabled:opacity-40">
                Submit
              </button>
            </div>
            {sendError ? <Note tone="bad">{sendError}</Note> : null}
          </div>
        </div>
      ) : null}

      {trackedRecord && !picking ? (
        <div className="radiri-rise rounded-[28px] border border-foreground/10 bg-card p-5">
          <h2 className="mb-2 text-[15px] font-semibold tracking-tight">Settlement</h2>
          <SwapTracker record={trackedRecord} />
          {trackedRecord.depositTxHash ? (
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              Deposit tx{" "}
              <a className="font-mono underline underline-offset-2" href={txExplorerUrl(trackedRecord.quote.origin.chain, trackedRecord.depositTxHash) ?? undefined} target="_blank" rel="noreferrer">
                {trackedRecord.depositTxHash.slice(0, 14)}…
              </a>
            </p>
          ) : null}
        </div>
      ) : null}

      {history.records.length > 0 && !picking ? (
        <div className="rounded-[28px] border border-foreground/10 bg-card p-4">
          <h2 className="px-1 pb-2 text-[13.5px] font-semibold tracking-tight">Your swaps</h2>
          <ul className="flex flex-col gap-1">
            {history.records.slice(0, 8).map((record) => (
              <li key={record.depositAddress}>
                <button type="button" onClick={() => setTracking(record.depositAddress)} className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-foreground/5">
                  <span className="inline-flex items-center">
                    <TokenAvatar symbol={record.quote.origin.symbol} category={record.quote.origin.category} size="sm" className="ring-2 ring-card" />
                    <TokenAvatar symbol={record.quote.destination.symbol} category={record.quote.destination.category} size="sm" className="-ml-2 ring-2 ring-card" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">
                    {trimAmount(record.quote.amountIn, 2)} {record.quote.origin.symbol} → {trimAmount(record.quote.amountOut, 4)} {record.quote.destination.symbol}
                  </span>
                  <Pill tone={record.lastStatus === "SUCCESS" ? "good" : record.lastStatus === "FAILED" ? "bad" : record.lastStatus === "REFUNDED" ? "warn" : "neutral"}>{record.lastStatus}</Pill>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="px-2 text-center text-[11.5px] text-muted-foreground">
        NEAR Intents has no testnet, so swaps run on mainnet with real funds. You sign the deposit in your own wallet. Tokenized stocks are Ondo
        Global Markets tokens; availability depends on your region.
      </p>
    </div>
  );
}
