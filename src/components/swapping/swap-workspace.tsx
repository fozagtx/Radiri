"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Box, Button, Card, Collapsible, Container, DataList, Flex, Heading, HStack, IconButton, Input, SegmentGroup, Skeleton, Spinner, Stack, Text } from "@chakra-ui/react";
import { ArrowDown, ChevronDown, Clock, ShieldCheck } from "lucide-react";
import { TokenAvatar } from "@/components/app/token-avatar";
import { CopyField } from "@/components/dashboard/copy-field";
import { Note, Pill } from "@/components/shared/bits";
import { useNow } from "@/components/shared/use-now";
import { useSwapHistory } from "@/hooks/use-swap-history";
import { checkAddress } from "@/lib/intents/addresses";
import { chainFamily, chainName, evmChainIdOf, txExplorerUrl } from "@/lib/intents/chains";
import type { RadiriSwapQuote, SwapQuoteResult } from "@/lib/intents/types";
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
    <Button onClick={onClick} variant="outline" bg="bg.panel" borderRadius="full" h="auto" py="1.5" pl="1.5" pr="3" gap="2" flexShrink={0} boxShadow="xs" _hover={{ borderColor: "border.emphasized", boxShadow: "sm" }}>
      {asset ? <TokenAvatar symbol={asset.symbol} category={asset.category} chain={asset.chain} size="sm" /> : null}
      <Stack gap="0" align="flex-start">
        <Text fontWeight="semibold" textStyle="md" lineHeight="1.1">
          {asset?.symbol ?? "Select"}
        </Text>
        {asset ? (
          <Text textStyle="2xs" color="fg.muted" fontWeight="normal">
            {chainName(asset.chain)}
          </Text>
        ) : null}
      </Stack>
      <ChevronDown size={16} />
    </Button>
  );
}

function AddressField({ id, label, chain, value, onChange, suggestion }: { id: string; label: string; chain: string; value: string; onChange: (value: string) => void; suggestion: string | null }) {
  const check = value ? checkAddress(chain, value) : null;
  return (
    <Stack gap="1.5">
      <Text asChild textStyle="xs" fontWeight="medium" color="fg.muted">
        <label htmlFor={id}>
          {label} on {chainName(chain)}
        </label>
      </Text>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value.trim())} placeholder={`${chainName(chain)} address`} fontFamily="mono" textStyle="xs" borderRadius="xl" bg="bg.panel" />
      {check && check.valid === false ? (
        <Text textStyle="xs" color="red.600">
          {check.reason}
        </Text>
      ) : null}
      {suggestion && suggestion !== value ? (
        <Button variant="plain" size="xs" alignSelf="flex-start" px="0" h="auto" color="fg.muted" textDecoration="underline" onClick={() => onChange(suggestion)}>
          Use connected wallet {suggestion.slice(0, 6)}…{suggestion.slice(-4)}
        </Button>
      ) : null}
    </Stack>
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

  const panelBox = { bg: "bg.subtle", borderRadius: "2xl", px: "4", py: "4" } as const;

  return (
    <Container maxW="xl" px="4" py={{ base: "6", md: "10" }}>
      <Stack gap="5">
        <Box textAlign="center" className="radiri-rise">
          <Heading as="h1" fontFamily="display" fontWeight="normal" fontSize={{ base: "4xl", md: "5xl" }} lineHeight="1.05" letterSpacing="-0.03em">
            Swap meme coins for stocks
          </Heading>
          <Text mt="2" textStyle="sm" color="fg.muted">
            Any chain in, any chain out. Settled by NEAR Intents solvers.
          </Text>
        </Box>

        <Card.Root variant="outline" bg="bg.panel" borderRadius="3xl" boxShadow="lift" className="radiri-rise">
          <Card.Body p="3">
            {catalog.state === "loading" ? (
              <Flex h="72" align="center" justify="center" gap="2" color="fg.muted" textStyle="sm">
                <Spinner size="sm" />
                Loading the NEAR Intents catalog…
              </Flex>
            ) : catalog.state === "error" ? (
              <Note tone="bad">The NEAR Intents catalog could not be loaded: {catalog.error}</Note>
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
              <Stack gap="2">
                <Flex justify="space-between" align="center" px="2" pt="1">
                  <HStack gap="2" textStyle="xs" color="fg.muted" fontWeight="medium">
                    <span className="radiri-live-dot size-1.5 rounded-full bg-emerald-600" aria-hidden />
                    Live quotes · refreshed every 20s
                  </HStack>
                  <Button size="xs" variant="ghost" borderRadius="full" color="fg.muted" onClick={() => setShowSettings((value) => !value)} aria-expanded={showSettings}>
                    Slippage {(slippageBps / 100).toFixed(1)}%
                  </Button>
                </Flex>
                {showSettings ? (
                  <HStack {...panelBox} py="2.5" justify="space-between">
                    <Text textStyle="xs" color="fg.muted">
                      Max slippage
                    </Text>
                    <SegmentGroup.Root size="xs" value={String(slippageBps)} onValueChange={(details) => details.value && setSlippageBps(Number(details.value))}>
                      <SegmentGroup.Indicator />
                      <SegmentGroup.Items items={SLIPPAGE_OPTIONS.map((bps) => ({ value: String(bps), label: `${(bps / 100).toFixed(1)}%` }))} />
                    </SegmentGroup.Root>
                  </HStack>
                ) : null}

                <Box position="relative">
                  <Stack gap="1.5">
                    <Box {...panelBox} _focusWithin={{ bg: "bg.muted" }} transition="background 0.15s">
                      <Text textStyle="sm" color="fg.muted">
                        You pay
                      </Text>
                      <Flex align="center" gap="3" mt="1">
                        <Input
                          aria-label={`Amount of ${from?.symbol ?? "the source token"}`}
                          inputMode="decimal"
                          value={amount}
                          onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
                          variant="flushed"
                          border="0"
                          px="0"
                          h="auto"
                          fontFamily="mono"
                          fontSize={{ base: "3xl", md: "4xl" }}
                          letterSpacing="-0.02em"
                          placeholder="0"
                          _focusVisible={{ boxShadow: "none" }}
                        />
                        <TokenButton asset={from} onClick={() => setPicking("from")} />
                      </Flex>
                      <Text mt="1" h="4" textStyle="xs" color="fg.muted">
                        {usd(quote?.amountInUsd ?? (from?.priceUsd && Number(amount) ? from.priceUsd * Number(amount) : null))}
                      </Text>
                    </Box>
                    <Box {...panelBox}>
                      <Text textStyle="sm" color="fg.muted">
                        You receive
                      </Text>
                      <Flex align="center" gap="3" mt="1">
                        <Box flex="1" minW="0" fontFamily="mono" fontSize={{ base: "3xl", md: "4xl" }} letterSpacing="-0.02em" color={quote ? "fg" : "fg.subtle"} truncate>
                          {quote ? trimAmount(quote.amountOut, 6) : indicative.state === "loading" ? <Skeleton h="10" w="44" borderRadius="lg" /> : "0"}
                        </Box>
                        <TokenButton asset={to} onClick={() => setPicking("to")} />
                      </Flex>
                      <Text mt="1" h="4" textStyle="xs" color="fg.muted">
                        {usd(quote?.amountOutUsd)}
                        {impact !== null ? (
                          <Text as="span" ml="1.5" color={impact < -3 ? "red.600" : undefined}>
                            ({impact.toFixed(2)}%)
                          </Text>
                        ) : null}
                      </Text>
                    </Box>
                  </Stack>
                  <IconButton
                    aria-label="Reverse the swap direction"
                    position="absolute"
                    top="50%"
                    left="50%"
                    transform="translate(-50%, -50%)"
                    size="sm"
                    borderRadius="xl"
                    borderWidth="4px"
                    borderColor="bg.panel"
                    bg="bg.muted"
                    color="fg"
                    _hover={{ bg: "ink", color: "white" }}
                    onClick={() => {
                      setFromId(to?.id ?? null);
                      setToId(from?.id ?? null);
                    }}
                  >
                    <ArrowDown size={16} />
                  </IconButton>
                </Box>

                {indicative.state === "failed" ? (
                  <Note tone={indicative.failure.kind === "no-liquidity" ? "warn" : "bad"}>
                    NEAR Intents: {indicative.failure.reason}
                    {indicative.failure.kind === "no-liquidity" ? ". Try a smaller amount." : ""}
                  </Note>
                ) : null}

                {quote ? (
                  <Collapsible.Root open={showDetails} onOpenChange={(details) => setShowDetails(details.open)}>
                    <Box borderWidth="1px" borderColor="border" borderRadius="xl" px="4" py="2.5">
                      <Collapsible.Trigger asChild>
                        <Flex as="button" w="full" justify="space-between" align="center" gap="2" textStyle="sm">
                          <Text fontFamily="mono" textStyle="xs">
                            {rate(quote)}
                          </Text>
                          <HStack gap="2" color="fg.muted" textStyle="xs">
                            <Clock size={13} />
                            {quote.etaSeconds === null ? "–" : `~${quote.etaSeconds}s`}
                            <ChevronDown size={14} style={{ transform: showDetails ? "rotate(180deg)" : undefined, transition: "transform 0.2s" }} />
                          </HStack>
                        </Flex>
                      </Collapsible.Trigger>
                      <Collapsible.Content>
                        <DataList.Root orientation="horizontal" size="sm" gap="1.5" mt="3" pt="3" borderTopWidth="1px" borderColor="border.muted">
                          <DataList.Item>
                            <DataList.ItemLabel color="fg.muted">Minimum received</DataList.ItemLabel>
                            <DataList.ItemValue fontFamily="mono" justifyContent="flex-end">
                              {trimAmount(quote.minAmountOut, 6)} {quote.destination.symbol}
                            </DataList.ItemValue>
                          </DataList.Item>
                          <DataList.Item>
                            <DataList.ItemLabel color="fg.muted">Route</DataList.ItemLabel>
                            <DataList.ItemValue justifyContent="flex-end">
                              {chainName(quote.origin.chain)} → NEAR Intents → {chainName(quote.destination.chain)}
                            </DataList.ItemValue>
                          </DataList.Item>
                          {quote.fees.map((fee) => (
                            <DataList.Item key={fee.label}>
                              <DataList.ItemLabel color="fg.muted">{fee.label}</DataList.ItemLabel>
                              <DataList.ItemValue fontFamily="mono" justifyContent="flex-end">
                                {trimAmount(fee.amount, 8)} {fee.unit}
                              </DataList.ItemValue>
                            </DataList.Item>
                          ))}
                        </DataList.Root>
                      </Collapsible.Content>
                    </Box>
                  </Collapsible.Root>
                ) : null}

                {from && to ? (
                  <Stack gap="3" borderWidth="1px" borderColor="border" borderRadius="xl" px="4" py="4">
                    <HStack gap="2" wrap="wrap">
                      {origin.connect && !origin.address ? (
                        <Button size="xs" variant="outline" borderRadius="full" onClick={() => void origin.connect?.().catch((error: unknown) => setSendError(error instanceof Error ? error.message : String(error)))}>
                          Connect {origin.label}
                        </Button>
                      ) : null}
                      {destination.connect && !destination.address && destination.label !== origin.label ? (
                        <Button size="xs" variant="outline" borderRadius="full" onClick={() => void destination.connect?.().catch((error: unknown) => setSendError(error instanceof Error ? error.message : String(error)))}>
                          Connect {destination.label}
                        </Button>
                      ) : null}
                    </HStack>
                    <AddressField id="swap-recipient" label={`Receive ${to.symbol}`} chain={to.chain} value={recipient} onChange={setRecipient} suggestion={destination.address} />
                    <AddressField id="swap-refund" label="Refund address" chain={from.chain} value={refundTo} onChange={setRefundTo} suggestion={origin.address} />
                  </Stack>
                ) : null}

                <Button
                  size="lg"
                  h="13"
                  borderRadius="2xl"
                  bg="ink"
                  color="white"
                  _hover={{ bg: "#2a2a2a" }}
                  _disabled={{ bg: "bg.muted", color: "fg.subtle", opacity: 1 }}
                  disabled={cta.disabled}
                  loading={cta.busy}
                  loadingText={cta.label}
                  onClick={() => void getExecutableQuote()}
                >
                  {cta.label}
                </Button>
                {live.state === "failed" ? <Note tone="bad">NEAR Intents: {live.failure.reason}</Note> : null}
              </Stack>
            )}
          </Card.Body>
        </Card.Root>

        {liveQuote && liveQuote.depositAddress && !picking ? (
          <Card.Root variant="outline" bg="bg.panel" borderRadius="3xl" boxShadow="panel" className="radiri-rise">
            <Card.Body gap="4">
              <Flex justify="space-between" align="center" wrap="wrap" gap="2">
                <Text fontWeight="semibold" textStyle="md">
                  Send your {liveQuote.origin.symbol}
                </Text>
                <HStack gap="2">
                  {liveQuote.signatureVerified ? (
                    <Badge colorPalette="green" variant="subtle" borderRadius="full" gap="1">
                      <ShieldCheck size={12} />
                      signed quote
                    </Badge>
                  ) : null}
                  {timeLeft ? (
                    <Badge colorPalette={deadlinePassed ? "red" : "gray"} variant="subtle" borderRadius="full" fontFamily="mono">
                      {deadlinePassed ? "expired" : `${timeLeft} left`}
                    </Badge>
                  ) : null}
                </HStack>
              </Flex>
              <Text textStyle="sm" color="fg.muted">
                Send exactly this amount on {chainName(liveQuote.origin.chain)}. Solvers deliver {trimAmount(liveQuote.amountOut, 6)} {liveQuote.destination.symbol} to your recipient, or refund you.
              </Text>
              <Stack gap="2">
                <CopyField value={liveQuote.depositAddress} label="Deposit to" />
                {liveQuote.depositMemo ? <CopyField value={liveQuote.depositMemo} label="Memo" /> : null}
                <CopyField value={liveQuote.amountIn} label="Amount" />
              </Stack>
              {deadlinePassed ? (
                <Note tone="warn">This quote expired. Get a fresh deposit address before sending anything.</Note>
              ) : walletFamily === "evm" || walletFamily === "solana" ? (
                <Button size="md" borderRadius="xl" bg="ink" color="white" _hover={{ bg: "#2a2a2a" }} loading={sending} disabled={!origin.address} onClick={() => void sendWithWallet(liveQuote)}>
                  {origin.address ? `Send ${trimAmount(liveQuote.amountIn, 4)} ${liveQuote.origin.symbol} with your ${origin.label}` : `Connect your ${origin.label} to send`}
                </Button>
              ) : (
                <Note tone="neutral">Send the exact amount from any {chainName(liveQuote.origin.chain)} wallet to the deposit address.</Note>
              )}
              <HStack gap="2">
                <Input aria-label="Deposit transaction hash" placeholder="Sent manually? Paste the transaction hash" value={manualHash} onChange={(event) => setManualHash(event.target.value.trim())} fontFamily="mono" textStyle="xs" borderRadius="xl" />
                <Button variant="outline" borderRadius="xl" disabled={!manualHash} onClick={() => void submitHash(liveQuote, manualHash)}>
                  Submit
                </Button>
              </HStack>
              {sendError ? <Note tone="bad">{sendError}</Note> : null}
            </Card.Body>
          </Card.Root>
        ) : null}

        {trackedRecord && !picking ? (
          <Card.Root variant="outline" bg="bg.panel" borderRadius="3xl" boxShadow="panel" className="radiri-rise">
            <Card.Body gap="3">
              <Text fontWeight="semibold" textStyle="md">
                Settlement
              </Text>
              <SwapTracker record={trackedRecord} />
              {trackedRecord.depositTxHash ? (
                <Text textStyle="xs" color="fg.muted">
                  Deposit tx{" "}
                  <a style={{ fontFamily: "var(--font-geist-mono)", textDecoration: "underline" }} href={txExplorerUrl(trackedRecord.quote.origin.chain, trackedRecord.depositTxHash) ?? undefined} target="_blank" rel="noreferrer">
                    {trackedRecord.depositTxHash.slice(0, 14)}…
                  </a>
                </Text>
              ) : null}
            </Card.Body>
          </Card.Root>
        ) : null}

        {history.records.length > 0 && !picking ? (
          <Card.Root variant="outline" bg="bg.panel" borderRadius="3xl">
            <Card.Body gap="2">
              <Text fontWeight="semibold" textStyle="sm">
                Your swaps
              </Text>
              {history.records.slice(0, 8).map((record) => (
                <HStack key={record.depositAddress} as="button" gap="3" px="2" py="2" borderRadius="xl" textAlign="left" _hover={{ bg: "bg.subtle" }} onClick={() => setTracking(record.depositAddress)}>
                  <HStack gap="0">
                    <TokenAvatar symbol={record.quote.origin.symbol} category={record.quote.origin.category} size="sm" />
                    <TokenAvatar symbol={record.quote.destination.symbol} category={record.quote.destination.category} size="sm" className="-ml-2" />
                  </HStack>
                  <Text flex="1" minW="0" truncate textStyle="sm">
                    {trimAmount(record.quote.amountIn, 2)} {record.quote.origin.symbol} → {trimAmount(record.quote.amountOut, 4)} {record.quote.destination.symbol}
                  </Text>
                  <Pill tone={record.lastStatus === "SUCCESS" ? "good" : record.lastStatus === "FAILED" ? "bad" : record.lastStatus === "REFUNDED" ? "warn" : "neutral"}>{record.lastStatus}</Pill>
                </HStack>
              ))}
            </Card.Body>
          </Card.Root>
        ) : null}

        <Text textAlign="center" textStyle="xs" color="fg.muted" px="2">
          NEAR Intents has no testnet, so swaps run on mainnet with real funds. You sign the deposit in your own wallet. Tokenized stocks are Ondo Global
          Markets tokens; availability depends on your region.
        </Text>
      </Stack>
    </Container>
  );
}
