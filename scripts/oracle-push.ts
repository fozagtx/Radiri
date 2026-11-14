/**
 * Pushes live 1Click prices for every registered asset to the lending contract's oracle.
 *
 *   pnpm oracle:push             sign with RADIRI_ORACLE_ACCOUNT / RADIRI_ORACLE_PRIVATE_KEY (.env.local)
 *   pnpm oracle:push --dry-run   print what would be reported, submit nothing
 *
 * The key must be a function-call key limited to report_prices (scripts/testnet-deploy.ts creates it).
 * The app also calls the same logic through POST /api/oracle/refresh whenever prices are stale.
 */
import { existsSync, readFileSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}

async function main() {
  // Imported after the env is loaded: config modules read it at import time.
  const { pushOraclePrices } = await import("../src/lib/oracle/push");
  const { LENDING_CONTRACT_ID, EXPLORER_URL } = await import("../src/lib/config");
  const dryRun = process.argv.includes("--dry-run");
  const result = await pushOraclePrices({ force: true, dryRun });
  console.log(`oracle:push: ${LENDING_CONTRACT_ID}${dryRun ? " (dry run)" : ""}`);
  for (const line of result.lines) console.log(`  ${line.status === "reported" ? "ok  " : "skip"} ${line.symbol.padEnd(7)} ${line.detail}`);
  console.log(`oracle:push: ${result.reason}`);
  if (result.txHash) console.log(`oracle:push: ${EXPLORER_URL}/txns/${result.txHash}`);
  if (!result.submitted && !dryRun) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`oracle:push: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
