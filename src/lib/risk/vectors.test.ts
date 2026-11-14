import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAssetsJson, buildMathVectors } from "./vectors";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as unknown;

describe("generated contract artifacts", () => {
  it("assets.testnet.json mirrors src/config/lending-assets.ts (run pnpm gen:lending if this fails)", () => {
    expect(read("contracts/lending/assets.testnet.json")).toEqual(buildAssetsJson());
  });

  it("lending-math.json matches the TypeScript risk math (run pnpm gen:lending if this fails)", () => {
    expect(read("contracts/lending/tests/vectors/lending-math.json")).toEqual(JSON.parse(JSON.stringify(buildMathVectors())));
  });

  it("covers every formula the contract and the UI share", () => {
    const fns = new Set(buildMathVectors().map((vector) => vector.fn));
    expect([...fns].sort()).toEqual(["accrue_index", "health_factor_wad", "interest_rates", "liquidation", "utilization_bps", "value_wad"]);
  });
});
