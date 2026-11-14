/**
 * Writes the two files that keep the Rust contract and the TypeScript side in lockstep:
 *
 *   contracts/lending/assets.testnet.json        register_asset arguments, an exact mirror of
 *                                                src/config/lending-assets.ts (used by deploy-lending.sh)
 *   contracts/lending/tests/vectors/lending-math.json
 *                                                math vectors computed by the TypeScript mirror
 *                                                (src/lib/risk); the contract's vector test asserts the
 *                                                Rust math returns exactly the same numbers.
 *
 * Usage: pnpm gen:lending   (src/lib/risk/vectors.test.ts fails if either file is stale)
 */
import { writeFileSync } from "node:fs";
import { buildAssetsJson, buildMathVectors } from "../src/lib/risk/vectors";

writeFileSync("contracts/lending/assets.testnet.json", `${JSON.stringify(buildAssetsJson(), null, 2)}\n`);
writeFileSync("contracts/lending/tests/vectors/lending-math.json", `${JSON.stringify(buildMathVectors(), null, 2)}\n`);
console.log("wrote contracts/lending/assets.testnet.json and contracts/lending/tests/vectors/lending-math.json");
