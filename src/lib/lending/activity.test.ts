import { describe, expect, it } from "vitest";
import { lendingActivityItems, mergeActivity, swapActivityItems } from "./activity";

const AAPL = "taapl.radiri-markets.testnet";

describe("activity feed", () => {
  it("formats contract activity, links blocks and sorts newest first", () => {
    const newer = lendingActivityItems(
      [{ kind: "borrow", token_id: AAPL, amount: "150000000", counterparty: null, timestamp_ms: 2_000, block_height: 99 }],
      { source: "lending-contract", tokenInfo: () => ({ symbol: "tAAPL", decimals: 8 }) },
    );
    expect(newer[0]).toMatchObject({ title: "Borrowed", detail: "1.5 tAAPL", source: "lending-contract", status: "success" });
    expect(newer[0].explorerUrl).toMatch(/\/blocks\/99$/);
    const older = lendingActivityItems(
      [{ kind: "repay", token_id: AAPL, amount: "1", counterparty: null, timestamp_ms: 1_000, block_height: 98 }],
      { source: "lending-contract", tokenInfo: () => undefined },
    );
    expect(older[0].detail).toBe(`1 base units ${AAPL}`);
    expect(mergeActivity(older, newer).map((item) => item.title)).toEqual(["Borrowed", "Repaid debt"]);
    expect(swapActivityItems([])).toEqual([]);
  });
});
