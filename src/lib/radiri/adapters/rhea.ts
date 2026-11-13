import { fromBaseUnits, toBaseUnits } from "../catalog";
import type { RouteFailure, RouteQuote, StableAsset } from "../types";

const RHEA_ROUTER = "https://smartx.rhea.finance/swapMultiDexPath";
const RHEA_CHAIN = "near";
const PATH_DEPTH = 3;
const QUOTE_TIMEOUT_MS = 20_000;

interface RheaPathData {
  amount_in: string;
  amount_out: string;
  min_amount_out: string;
  dexs?: string[];
  msg?: string;
  signature?: string;
  tokens?: string[];
}

interface RheaResponse {
  result_code: number;
  result_message: string;
  result_data: RheaPathData | null;
}

export interface RheaQuoteParams {
  from: StableAsset;
  to: StableAsset;
  amount: number;
  slippageBps: number;
}

function failure(from: StableAsset, to: StableAsset, reason: string, kind: RouteFailure["kind"]): RouteFailure {
  return { source: "rhea", from, to, reason, kind };
}

function classify(reason: string): RouteFailure["kind"] {
  if (/no router|no liquidity|no path|insufficient/i.test(reason)) return "no-liquidity";
  return "error";
}

/** Quotes the Rhea Smart Router (NEAR-chain pools only). Read-only, no signature is submitted. */
export async function quoteRhea({ from, to, amount, slippageBps }: RheaQuoteParams): Promise<RouteQuote | RouteFailure> {
  if (from.chain.toLowerCase() !== RHEA_CHAIN || to.chain.toLowerCase() !== RHEA_CHAIN) {
    return failure(from, to, `Rhea Smart Router covers NEAR-chain pools only; ${from.chain} -> ${to.chain} is not supported`, "unsupported");
  }
  const tokenIn = from.contractAddress;
  const tokenOut = to.contractAddress;
  if (!tokenIn) return failure(from, to, `no NEAR account id known for ${from.symbol}:${from.chain}`, "unsupported");
  if (!tokenOut) return failure(from, to, `no NEAR account id known for ${to.symbol}:${to.chain}`, "unsupported");

  const url = new URL(RHEA_ROUTER);
  url.searchParams.set("amountIn", toBaseUnits(amount, from.decimals));
  url.searchParams.set("tokenIn", tokenIn);
  url.searchParams.set("tokenOut", tokenOut);
  url.searchParams.set("slippage", String(slippageBps / 10_000));
  url.searchParams.set("pathDeep", String(PATH_DEPTH));

  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "Radiri/0.1 (+https://radiri.vercel.app)",
      },
      signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
    });
  } catch (error) {
    return failure(from, to, error instanceof Error ? error.message : String(error), "error");
  }

  const raw = await res.text();
  if (raw.trimStart().startsWith("<")) {
    return failure(
      from,
      to,
      `Rhea answered with an HTML page instead of a quote (HTTP ${res.status}), usually a Cloudflare challenge on this network`,
      "error",
    );
  }
  if (!res.ok) {
    return failure(from, to, raw.trim().slice(0, 300) || `HTTP ${res.status}`, classify(raw));
  }

  let payload: RheaResponse;
  try {
    payload = JSON.parse(raw) as RheaResponse;
  } catch (error) {
    return failure(from, to, `unexpected Rhea payload: ${error instanceof Error ? error.message : String(error)}`, "error");
  }

  if (payload.result_code !== 0 || !payload.result_data) {
    const reason = payload.result_message || `result_code ${payload.result_code}`;
    return failure(from, to, reason, classify(reason));
  }

  const data = payload.result_data;
  const amountOut = fromBaseUnits(data.amount_out, to.decimals);
  const minAmountOut = fromBaseUnits(data.min_amount_out, to.decimals);
  if (!Number.isFinite(amountOut) || amountOut <= 0) {
    return failure(from, to, `Rhea Smart Router returned amount_out ${data.amount_out} for ${amount} ${from.symbol}`, "no-liquidity");
  }

  const impliedCost = amount - amountOut;

  return {
    source: "rhea",
    from,
    to,
    amountIn: amount,
    amountOut,
    minAmountOut,
    costBps: (impliedCost / amount) * 10_000,
    worstCaseCostBps: ((amount - minAmountOut) / amount) * 10_000,
    // Rhea reports the DEX path, not an itemised fee. The implied cost is the
    // price impact plus pool fee that the quoted output already reflects.
    fees:
      impliedCost > 0
        ? [{ label: "Implied AMM fee + price impact", amount: impliedCost, unit: from.symbol }]
        : [],
    // Rhea does not return an ETA; null rather than a guessed number.
    etaSeconds: null,
    slippageBps,
    quotedAt: new Date().toISOString(),
    execution: {
      provider: "rhea",
      dry: true,
      dexs: data.dexs ?? [],
      tokens: data.tokens ?? [],
      routerSignature: data.signature,
    },
  };
}
