import { beforeEach, describe, expect, it } from "vitest";
import { lendingAssetBySymbol } from "@/config/lending-assets";
import type { PriceObservation } from "@/types/protocol";
import { parseUnits, WAD } from "@/lib/risk";
import { lendingActivityItems, mergeActivity, swapActivityItems } from "./activity";
import { matchObservation, observationToOraclePrice, parsePricingResponse, type PricingResponse } from "./sim-prices";
import { resetSimMemory } from "./sim-store";
import { SimulatedLendingClient } from "./simulated-client";
import { LendingActionError } from "./types";

const PEPE = lendingAssetBySymbol("tPEPE")!.config.token_id;
const AAPL = lendingAssetBySymbol("tAAPL")!.config.token_id;
const ALICE = "alice.testnet";

function observation(symbol: string, priceUsd: number, nowMs: number, ageSeconds = 5, fresh = true): PriceObservation {
  return {
    symbol,
    assetId: symbol,
    priceUsd,
    source: "1click",
    observedAt: new Date(nowMs - ageSeconds * 1000).toISOString(),
    ageSeconds,
    fresh,
  };
}

function setup(options: { aaplAge?: number; fail?: boolean } = {}) {
  let now = 1_763_000_000_000;
  const client = new SimulatedLendingClient({
    now: () => now,
    priceTtlMs: 0,
    fetchPrices: async (): Promise<PricingResponse> => {
      if (options.fail) throw new Error("HTTP 404");
      return {
        observations: [
          observation("PEPE", 0.0000044, now),
          observation("$WIF", 2, now),
          observation("SHIB", 0.000012, now),
          observation("BRETT", 0.05, now),
          observation("AAPLon", 110, now, options.aaplAge ?? 5),
          observation("TSLAon", 250, now),
        ],
        missing: [{ symbol: "NVDAon", reason: "1Click lists NVDAon but reports no usable price" }],
      };
    },
  });
  return { client, advance: (ms: number) => (now += ms) };
}

const units = (text: string, decimals: number) => parseUnits(text, decimals).toString();

describe("SimulatedLendingClient", () => {
  beforeEach(() => resetSimMemory());

  it("seeds labelled pool liquidity and maps reference prices onto test tokens", async () => {
    const { client } = setup();
    const assets = await client.getAssets();
    const pepe = assets.find((asset) => asset.config.token_id === PEPE)!;
    expect(pepe.cash).toBe(units("40000000000", 18));
    expect(pepe.price?.price_wad).toBe("4400000000000");
    expect(pepe.price_fresh).toBe(true);
    const nvda = assets.find((asset) => asset.config.symbol === "tNVDA")!;
    expect(nvda.price).toBeNull();
    expect(nvda.price_fresh).toBe(false);
    expect(client.getPriceFeedStatus().missing).toEqual([{ symbol: "NVDAon", reason: "1Click lists NVDAon but reports no usable price" }]);
  });

  it("runs journey A: faucet tPEPE, deposit, borrow tAAPL, repay, withdraw", async () => {
    const { client } = setup();
    await client.faucet(ALICE, PEPE, units("1000000000", 18));
    expect((await client.getWalletBalance(PEPE, ALICE))?.amount).toBe(parseUnits("1000000000", 18));

    const deposit = await client.execute(ALICE, { kind: "deposit_collateral", tokenId: PEPE, amount: units("1000000000", 18) });
    expect(deposit).toEqual({ mode: "simulation", txHashes: [], explorerUrls: [] });

    let account = await client.getAccount(ALICE);
    expect(account?.borrow_limit_wad).toBe((WAD * BigInt(1_100)).toString());

    // Exactly the borrow limit: 10 AAPL at $110.
    await client.execute(ALICE, { kind: "borrow", tokenId: AAPL, amount: units("10", 8) });
    account = await client.getAccount(ALICE);
    expect(account?.debt_value_wad).toBe((WAD * BigInt(1_100)).toString());
    expect(account?.health_factor_wad).toBe("1600000000000000000");
    expect((await client.getWalletBalance(AAPL, ALICE))?.amount).toBe(parseUnits("10", 8));

    await expect(client.execute(ALICE, { kind: "borrow", tokenId: AAPL, amount: "1" })).rejects.toBeInstanceOf(LendingActionError);

    await client.execute(ALICE, { kind: "repay", tokenId: AAPL, amount: units("10", 8) });
    account = await client.getAccount(ALICE);
    expect(account?.borrowed).toEqual([]);
    expect(account?.health_factor_wad).toBeNull();

    await client.execute(ALICE, { kind: "withdraw_collateral", tokenId: PEPE, amount: units("1000000000", 18) });
    expect((await client.getWalletBalance(PEPE, ALICE))?.amount).toBe(parseUnits("1000000000", 18));

    const activity = await client.getActivity(ALICE);
    expect(activity.map((entry) => entry.kind)).toEqual(["withdraw_collateral", "repay", "borrow", "deposit_collateral"]);
    expect(activity.every((entry) => entry.block_height === 0)).toBe(true);
  });

  it("runs journey B: deposit tAAPL, borrow tPEPE (18 decimals)", async () => {
    const { client } = setup();
    await client.faucet(ALICE, AAPL, units("10", 8));
    await client.execute(ALICE, { kind: "deposit_collateral", tokenId: AAPL, amount: units("10", 8) });
    await client.execute(ALICE, { kind: "borrow", tokenId: PEPE, amount: units("125000000", 18) });
    const account = await client.getAccount(ALICE);
    expect(account?.debt_value_wad).toBe((WAD * BigInt(550)).toString());
  });

  it("blocks a borrow when the borrowed asset's reference price is stale, like the contract", async () => {
    const { client } = setup({ aaplAge: 901 });
    await client.faucet(ALICE, PEPE, units("1000000000", 18));
    await client.execute(ALICE, { kind: "deposit_collateral", tokenId: PEPE, amount: units("1000000000", 18) });
    const error = await client.execute(ALICE, { kind: "borrow", tokenId: AAPL, amount: units("1", 8) }).catch((caught) => caught);
    expect(error).toBeInstanceOf(LendingActionError);
    expect((error as LendingActionError).reasons.map((reason) => reason.code)).toEqual(["stale-price"]);
  });

  it("blocks every borrow when /api/pricing is unavailable", async () => {
    const { client } = setup({ fail: true });
    await client.faucet(ALICE, PEPE, units("1000000000", 18));
    await client.execute(ALICE, { kind: "deposit_collateral", tokenId: PEPE, amount: units("1000000000", 18) });
    const error = await client.execute(ALICE, { kind: "borrow", tokenId: AAPL, amount: "1" }).catch((caught) => caught);
    expect((error as LendingActionError).reasons.map((reason) => reason.code)).toContain("missing-price");
    expect(client.getPriceFeedStatus().error).toContain("404");
  });

  it("rejects deposits above the simulated wallet balance", async () => {
    const { client } = setup();
    const error = await client.execute(ALICE, { kind: "deposit_collateral", tokenId: PEPE, amount: "1" }).catch((caught) => caught);
    expect((error as LendingActionError).reasons.map((reason) => reason.code)).toEqual(["insufficient-balance"]);
  });

  it("accrues interest on debt over time", async () => {
    const { client, advance } = setup();
    await client.faucet(ALICE, PEPE, units("1000000000", 18));
    await client.execute(ALICE, { kind: "deposit_collateral", tokenId: PEPE, amount: units("1000000000", 18) });
    await client.execute(ALICE, { kind: "borrow", tokenId: AAPL, amount: units("5", 8) });
    advance(31_536_000_000);
    const account = await client.getAccount(ALICE);
    const debt = BigInt(account!.borrowed[0].amount);
    // utilization 5 / 1000 = 50 bps -> APR 100 + 800 * 50 / 7000 = 105 bps
    expect(debt).toBe(BigInt(5 * 10 ** 8) + BigInt(5 * 10 ** 8) * BigInt(105) / BigInt(10_000));
  });

  it("supplies and withdraws through pool shares", async () => {
    const { client } = setup();
    await client.faucet(ALICE, AAPL, units("4", 8));
    await client.execute(ALICE, { kind: "supply", tokenId: AAPL, amount: units("4", 8) });
    let account = await client.getAccount(ALICE);
    expect(account?.supplied[0].amount).toBe(units("4", 8));
    await client.execute(ALICE, { kind: "withdraw_supply", tokenId: AAPL, amount: units("4", 8) });
    account = await client.getAccount(ALICE);
    expect(account?.supplied).toEqual([]);
  });
});

describe("price mapping", () => {
  it("matches reference symbols, prefers the freshest and converts to wad", () => {
    const now = Date.UTC(2026, 10, 13);
    const older = { ...observation("PEPE", 0.000004, now, 100), ageSeconds: 100 };
    const newer = observation("PEPE", 0.0000044, now, 5);
    expect(matchObservation([older, newer], "PEPE")).toBe(newer);
    expect(matchObservation([observation("WIF", 2, now)], "$WIF")?.symbol).toBe("WIF");
    expect(observationToOraclePrice(newer, now)).toEqual({ price_wad: "4400000000000", timestamp_ms: now - 5_000 });
    expect(observationToOraclePrice({ ...newer, priceUsd: 0 }, now)).toBeNull();
    expect(parsePricingResponse({ observations: [newer, { bad: true }], missing: [{ symbol: "X" }] })).toEqual({
      observations: [newer],
      missing: [{ symbol: "X", reason: "no price" }],
    });
    expect(parsePricingResponse(null)).toEqual({ observations: [], missing: [] });
  });
});

describe("activity feed", () => {
  it("labels sources, links on-chain blocks and sorts newest first", () => {
    const lending = lendingActivityItems(
      [{ kind: "borrow", token_id: AAPL, amount: "150000000", counterparty: null, timestamp_ms: 2_000, block_height: 99 }],
      { source: "lending-contract", tokenInfo: () => ({ symbol: "tAAPL", decimals: 8 }) },
    );
    expect(lending[0]).toMatchObject({ title: "Borrowed", detail: "1.5 tAAPL", source: "lending-contract", status: "success" });
    expect(lending[0].explorerUrl).toMatch(/\/blocks\/99$/);
    const sim = lendingActivityItems(
      [{ kind: "repay", token_id: AAPL, amount: "1", counterparty: null, timestamp_ms: 1_000, block_height: 0 }],
      { source: "simulation", tokenInfo: () => undefined },
    );
    expect(sim[0].explorerUrl).toBeNull();
    expect(sim[0].detail).toBe(`1 base units ${AAPL}`);
    const merged = mergeActivity(sim, lending);
    expect(merged.map((item) => item.source)).toEqual(["lending-contract", "simulation"]);
    expect(swapActivityItems([])).toEqual([]);
  });
});
