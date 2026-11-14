import "server-only";

import { lendingAssetBySymbol, LENDING_ASSETS } from "@/config/lending-assets";
import { getOneClickTokens } from "@/lib/intents/tokens";
import type { OneClickTokenRow } from "@/config/assets";
import type { PriceObservation, PriceSource } from "@/types/protocol";
import { pickPricedRow, rowsForSymbol } from "./oneclick";
import { fetchLatestPrices, findEquityFeed, type PythFeed, type PythLatestPrice } from "./pyth";
import { ageSeconds, isFresh, maxAgeFor } from "./staleness";
import { numberToDecimalString } from "./wad";

/**
 * Reference prices for Radiri: 1Click `/v0/tokens` prices (meme coins and every other 1Click asset) and
 * Pyth Hermes for US equities. When Hermes cannot serve an equity (it now requires an API key), the
 * equity falls back to the live 1Click price of its Ondo tokenized stock (`AAPL` -> `AAPLon`), with
 * `source: "1click"`, the Ondo asset id, and a note saying so. Nothing is ever synthesized.
 */

export interface PriceQuote extends PriceObservation {
  /** Exact decimal USD price as the source reported it (for price_wad conversion). */
  priceDecimal: string;
}

export interface MissingPrice {
  symbol: string;
  reason: string;
}

export interface PriceCollection {
  quotes: PriceQuote[];
  missing: MissingPrice[];
  notes: string[];
}

/** US equity tickers routed to Pyth Hermes first. */
export const EQUITY_TICKERS = new Set([
  "AAPL",
  "TSLA",
  "NVDA",
  "MSFT",
  "AMZN",
  "GOOGL",
  "META",
  "INTC",
  "MRVL",
  "HOOD",
  "CRCL",
  "SPY",
  "QQQ",
  "MU",
  ...LENDING_ASSETS.filter((spec) => spec.referenceSource === "pyth-hermes").map((spec) => spec.referenceSymbol.toUpperCase()),
]);

const MAX_SYMBOLS = 50;

function observation(
  symbol: string,
  assetId: string,
  priceDecimal: string,
  source: PriceSource,
  observedAtMs: number,
  nowMs: number,
): PriceQuote {
  const age = ageSeconds(observedAtMs, nowMs);
  return {
    symbol,
    assetId,
    priceUsd: Number(priceDecimal),
    priceDecimal,
    source,
    observedAt: new Date(observedAtMs).toISOString(),
    ageSeconds: age,
    fresh: isFresh(age, maxAgeFor(symbol, source)),
  };
}

function fromOneClick(symbol: string, row: OneClickTokenRow, nowMs: number): PriceQuote {
  return observation(
    symbol,
    row.assetId,
    numberToDecimalString(row.price as number),
    "1click",
    Date.parse(row.priceUpdatedAt as string),
    nowMs,
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function collectPrices(requested: string[]): Promise<PriceCollection> {
  const nowMs = Date.now();
  const seen = new Set<string>();
  const symbols = requested
    .map((symbol) => symbol.trim())
    .filter((symbol) => {
      const key = symbol.toUpperCase();
      if (!symbol || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SYMBOLS);

  const quotes = new Map<string, PriceQuote>();
  const missing: MissingPrice[] = [];
  const notes: string[] = [];

  let tokens: OneClickTokenRow[] = [];
  let tokensError: string | null = null;
  try {
    tokens = (await getOneClickTokens()).tokens;
  } catch (error) {
    tokensError = `1Click /v0/tokens failed: ${message(error)}`;
  }

  const equities: string[] = [];
  for (const symbol of symbols) {
    const testToken = lendingAssetBySymbol(symbol);
    if (testToken) {
      missing.push({
        symbol,
        reason: `${testToken.config.symbol} is a Radiri testnet test token with no value; its oracle mirrors ${testToken.referenceSymbol}, request that symbol`,
      });
      continue;
    }
    if (EQUITY_TICKERS.has(symbol.toUpperCase())) {
      equities.push(symbol);
      continue;
    }
    const row = pickPricedRow(tokens, symbol);
    if (row) {
      quotes.set(symbol, fromOneClick(symbol, row, nowMs));
      continue;
    }
    if (rowsForSymbol(tokens, symbol).length > 0) {
      missing.push({ symbol, reason: `1Click lists ${symbol} but reports no usable price (price 0 or no priceUpdatedAt)` });
      continue;
    }
    // Not a 1Click symbol: maybe a US equity ticker Hermes knows.
    equities.push(symbol);
  }

  if (equities.length > 0) {
    const feeds = new Map<string, PythFeed | null>();
    const discoveryErrors = new Map<string, string>();
    await Promise.all(
      equities.map(async (symbol) => {
        try {
          feeds.set(symbol, await findEquityFeed(symbol));
        } catch (error) {
          discoveryErrors.set(symbol, message(error));
        }
      }),
    );

    const ids = [...new Set([...feeds.values()].filter((feed): feed is PythFeed => feed !== null).map((feed) => feed.id))];
    let latest = new Map<string, PythLatestPrice>();
    let pythError: string | null = null;
    try {
      latest = await fetchLatestPrices(ids);
    } catch (error) {
      pythError = message(error);
    }

    for (const symbol of equities) {
      const feed = feeds.get(symbol) ?? null;
      const price = feed ? latest.get(feed.id.replace(/^0x/, "").toLowerCase()) : undefined;
      if (feed && price && Number(price.priceDecimal) > 0) {
        quotes.set(symbol, observation(symbol, feed.id, price.priceDecimal, "pyth-hermes", price.publishTimeMs, nowMs));
        continue;
      }

      const pythReason = discoveryErrors.get(symbol)
        ? discoveryErrors.get(symbol)!
        : !feed
          ? `Pyth Hermes lists no Equity.US.${symbol.toUpperCase()}/USD feed`
          : (pythError ?? `Pyth Hermes returned no price for ${feed.symbol} (${feed.id})`);

      const ondoSymbol = `${symbol.toUpperCase()}on`;
      const ondo = pickPricedRow(tokens, ondoSymbol);
      if (ondo) {
        quotes.set(symbol, fromOneClick(symbol, ondo, nowMs));
        notes.push(
          `${symbol}: priced from 1Click ${ondo.symbol} (Ondo tokenized stock on ${ondo.blockchain}, asset ${ondo.assetId}) because ${pythReason}`,
        );
        continue;
      }
      const reasons = [pythReason];
      if (tokensError) reasons.push(tokensError);
      else if (EQUITY_TICKERS.has(symbol.toUpperCase())) reasons.push(`1Click lists no priced ${ondoSymbol}`);
      else reasons.unshift(`${symbol} is not in the 1Click catalog`);
      missing.push({ symbol, reason: reasons.join("; ") });
    }
  }

  return {
    quotes: symbols.map((symbol) => quotes.get(symbol)).filter((quote): quote is PriceQuote => Boolean(quote)),
    missing,
    notes,
  };
}

/** Public pricing contract used by /api/pricing and the lending UI. */
export async function getPrices(
  symbols: string[],
): Promise<{ observations: PriceObservation[]; missing: MissingPrice[]; notes?: string[] }> {
  const { quotes, missing, notes } = await collectPrices(symbols);
  const observations: PriceObservation[] = quotes.map((quote) => ({
    symbol: quote.symbol,
    assetId: quote.assetId,
    priceUsd: quote.priceUsd,
    source: quote.source,
    observedAt: quote.observedAt,
    ageSeconds: quote.ageSeconds,
    fresh: quote.fresh,
  }));
  return notes.length ? { observations, missing, notes } : { observations, missing };
}
