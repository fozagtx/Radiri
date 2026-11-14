import "server-only";

import { lendingAssetBySymbol } from "@/config/lending-assets";
import { getOneClickTokens } from "@/lib/intents/tokens";
import type { OneClickTokenRow } from "@/config/assets";
import type { PriceObservation } from "@/types/protocol";
import { pickPricedRow, rowsForSymbol } from "./oneclick";
import { ageSeconds, isFresh, maxAgeFor } from "./staleness";
import { numberToDecimalString } from "./wad";

/**
 * Reference prices for Radiri, all from the live 1Click `/v0/tokens` catalog (with Ondo tokenized
 * stocks included): meme coins by their own symbol (PEPE, $WIF, ...) and tokenized stocks by their
 * Ondo symbol (AAPLon, TSLAon, NVDAon on BNB Chain). `observedAt` is 1Click's `priceUpdatedAt`.
 * A symbol without a usable price is reported as missing with the reason; nothing is synthesized.
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
}

const MAX_SYMBOLS = 50;

function fromOneClick(symbol: string, row: OneClickTokenRow, nowMs: number): PriceQuote {
  const observedAtMs = Date.parse(row.priceUpdatedAt as string);
  const age = ageSeconds(observedAtMs, nowMs);
  const priceDecimal = numberToDecimalString(row.price as number);
  return {
    symbol,
    assetId: row.assetId,
    priceUsd: Number(priceDecimal),
    priceDecimal,
    source: "1click",
    observedAt: new Date(observedAtMs).toISOString(),
    ageSeconds: age,
    fresh: isFresh(age, maxAgeFor(symbol, "1click")),
  };
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

  let tokens: OneClickTokenRow[];
  try {
    tokens = (await getOneClickTokens()).tokens;
  } catch (error) {
    const reason = `1Click /v0/tokens failed: ${message(error)}`;
    return { quotes: [], missing: symbols.map((symbol) => ({ symbol, reason })) };
  }

  const quotes: PriceQuote[] = [];
  const missing: MissingPrice[] = [];
  for (const symbol of symbols) {
    const testToken = lendingAssetBySymbol(symbol);
    if (testToken) {
      missing.push({
        symbol,
        reason: `${testToken.config.symbol} is a Radiri testnet test token with no value; its oracle mirrors ${testToken.referenceSymbol}, request that symbol`,
      });
      continue;
    }
    const row = pickPricedRow(tokens, symbol);
    if (row) {
      quotes.push(fromOneClick(symbol, row, nowMs));
    } else if (rowsForSymbol(tokens, symbol).length > 0) {
      missing.push({ symbol, reason: `1Click lists ${symbol} but reports no usable price (price 0 or no priceUpdatedAt)` });
    } else {
      missing.push({ symbol, reason: `${symbol} is not in the 1Click catalog` });
    }
  }
  return { quotes, missing };
}

/** Public pricing contract used by /api/pricing and the lending UI. */
export async function getPrices(symbols: string[]): Promise<{ observations: PriceObservation[]; missing: MissingPrice[] }> {
  const { quotes, missing } = await collectPrices(symbols);
  const observations: PriceObservation[] = quotes.map((quote) => ({
    symbol: quote.symbol,
    assetId: quote.assetId,
    priceUsd: quote.priceUsd,
    source: quote.source,
    observedAt: quote.observedAt,
    ageSeconds: quote.ageSeconds,
    fresh: quote.fresh,
  }));
  return { observations, missing };
}
