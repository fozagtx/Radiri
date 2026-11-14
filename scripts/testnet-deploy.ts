/**
 * Deploys Radiri lending to NEAR TESTNET end to end with near-api-js (no CLI needed):
 *
 *   NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/testnet-deploy.ts [owner.testnet]
 *
 * 1. Creates the owner account through the NEAR testnet faucet (helper.testnet.near.org) and, if one
 *    faucet grant is not enough, tops it up from extra faucet accounts.
 * 2. Creates sub-accounts: one per test token, lending.<owner>, oracle.<owner>.
 * 3. Deploys and initialises the test tokens and the lending contract, registers every asset from
 *    contracts/lending/assets.testnet.json, registers the lending contract on each token and seeds
 *    each pool with test liquidity supplied by the owner.
 * 4. Adds a function-call key on oracle.<owner> that can only call report_prices (1 NEAR allowance).
 *
 * Public results go to src/config/deployment.ts (committed). Keys never enter the repository:
 * full-access keys go to ~/.near-credentials/testnet/, the oracle key to .env.local (gitignored).
 * Testnet only: the script refuses any account that does not end in .testnet. Re-running resumes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, type KeyPairString } from "near-api-js";

const RPC = "https://rpc.testnet.fastnear.com";
const HELPER = "https://helper.testnet.near.org/account";
const NEAR = BigInt(10) ** BigInt(24);
const milliNear = (n: number) => (BigInt(n) * NEAR) / BigInt(1000);
const TGAS = BigInt(10) ** BigInt(12);
const CREDENTIALS = join(homedir(), ".near-credentials", "testnet");
const ASSETS = JSON.parse(readFileSync("contracts/lending/assets.testnet.json", "utf8")) as Record<string, unknown>[];
const TOKEN_WASM = readFileSync("contracts/target/near/radiri_test_token/radiri_test_token.wasm");
const LENDING_WASM = readFileSync("contracts/target/near/radiri_lending/radiri_lending.wasm");

const provider = new JsonRpcProvider({ url: RPC });

function log(message: string) {
  console.log(`[deploy] ${message}`);
}

function saveKey(accountId: string, keyPair: KeyPair) {
  mkdirSync(CREDENTIALS, { recursive: true });
  writeFileSync(
    join(CREDENTIALS, `${accountId}.json`),
    JSON.stringify({ account_id: accountId, public_key: keyPair.getPublicKey().toString(), private_key: keyPair.toString() }),
    { mode: 0o600 },
  );
}

function loadKey(accountId: string): KeyPair | null {
  const file = join(CREDENTIALS, `${accountId}.json`);
  if (!existsSync(file)) return null;
  const { private_key } = JSON.parse(readFileSync(file, "utf8")) as { private_key: string };
  return KeyPair.fromString(private_key as KeyPairString);
}

async function exists(accountId: string): Promise<boolean> {
  try {
    await provider.viewAccount({ accountId });
    return true;
  } catch {
    return false;
  }
}

async function balance(accountId: string): Promise<bigint> {
  const view = (await provider.viewAccount({ accountId })) as unknown as { amount: string | bigint };
  return BigInt(view.amount);
}

async function hasCode(accountId: string): Promise<boolean> {
  const view = (await provider.viewAccount({ accountId })) as unknown as { code_hash?: string; codeHash?: string };
  const hash = view.code_hash ?? view.codeHash ?? "11111111111111111111111111111111";
  return hash !== "11111111111111111111111111111111";
}

async function faucetAccount(accountId: string, keyPair: KeyPair): Promise<void> {
  const res = await fetch(HELPER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: keyPair.getPublicKey().toString() }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`faucet refused ${accountId}: HTTP ${res.status} ${text.slice(0, 200)}`);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await exists(accountId)) return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`faucet accepted ${accountId} but the account never appeared`);
}

function accountFor(accountId: string, keyPair: KeyPair): Account {
  return new Account(accountId, provider, new KeyPairSigner(keyPair));
}

async function call(signer: Account, contractId: string, methodName: string, args: object, deposit: bigint, gasTera = 100) {
  const outcome = await signer.callFunctionRaw({ contractId, methodName, args, deposit, gas: BigInt(gasTera) * TGAS, waitUntil: "FINAL" });
  const status = outcome.status as unknown as Record<string, unknown>;
  if (status && typeof status === "object" && "Failure" in status) {
    throw new Error(`${contractId}.${methodName} failed: ${JSON.stringify(status.Failure)}`);
  }
  // A receipt deeper in the tree can fail even when the transaction succeeds (e.g. ft_on_transfer).
  for (const receipt of (outcome as unknown as { receipts_outcome?: { outcome: { status: Record<string, unknown> } }[] }).receipts_outcome ?? []) {
    if ("Failure" in receipt.outcome.status) throw new Error(`${contractId}.${methodName} receipt failed: ${JSON.stringify(receipt.outcome.status.Failure)}`);
  }
  return outcome.transaction?.hash as string;
}

async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T | null> {
  try {
    return (await provider.callFunction({ contractId, method, args })) as T;
  } catch {
    return null;
  }
}

async function main() {
  const owner = process.argv[2] ?? `radiri-lend-${Math.random().toString(36).slice(2, 7)}.testnet`;
  if (!owner.endsWith(".testnet")) throw new Error(`Refusing ${owner}: testnet only`);
  const lending = `lending.${owner}`;
  const oracle = `oracle.${owner}`;

  // 1. Owner via faucet.
  let ownerKey = loadKey(owner);
  if (!(await exists(owner))) {
    ownerKey = KeyPair.fromRandom("ed25519");
    saveKey(owner, ownerKey);
    log(`creating ${owner} through the testnet faucet`);
    await faucetAccount(owner, ownerKey);
  }
  if (!ownerKey) throw new Error(`${owner} exists but no key in ${CREDENTIALS}`);
  const ownerAccount = accountFor(owner, ownerKey);

  // Top up from extra faucet accounts only before the first deploy; a resumed run needs no more NEAR.
  const need = BigInt(ASSETS.length) * milliNear(2200) + milliNear(4500) + milliNear(1500) + milliNear(1500);
  const firstRun = !(await exists(lending));
  for (let donorIndex = 0; firstRun && (await balance(owner)) < need && donorIndex < 4; donorIndex += 1) {
    const donor = `${owner.replace(/\.testnet$/, "")}-fund${donorIndex}.testnet`;
    let donorKey = loadKey(donor);
    if (!(await exists(donor))) {
      donorKey = KeyPair.fromRandom("ed25519");
      saveKey(donor, donorKey);
      log(`owner has ${(await balance(owner)) / NEAR} NEAR, needs ~${need / NEAR}; funding from faucet account ${donor}`);
      await faucetAccount(donor, donorKey);
    }
    if (!donorKey) continue;
    const spare = (await balance(donor)) - milliNear(50);
    if (spare > BigInt(0)) await accountFor(donor, donorKey).transfer({ receiverId: owner, amount: spare });
  }
  log(`owner ${owner} balance ${Number((await balance(owner)) / milliNear(1)) / 1000} NEAR`);

  // 2-3. Test tokens.
  for (const asset of ASSETS) {
    const symbol = String(asset.symbol);
    const token = `${symbol.toLowerCase()}.${owner}`;
    if (!(await exists(token))) {
      log(`creating ${token}`);
      await ownerAccount.createSubAccount({ accountOrPrefix: token, publicKey: ownerKey.getPublicKey(), nearToTransfer: milliNear(2100) });
    }
    const tokenAccount = accountFor(token, ownerKey);
    if (!(await hasCode(token))) {
      log(`deploying test token ${symbol}`);
      await tokenAccount.deployContract(TOKEN_WASM);
    }
    if (!(await view(token, "ft_metadata"))) {
      await call(tokenAccount, token, "new", { owner_id: owner, name: `Radiri Test ${symbol.slice(1)} (no value)`, symbol, decimals: asset.decimals }, BigInt(0));
    }
  }

  // Lending contract.
  if (!(await exists(lending))) {
    log(`creating ${lending}`);
    await ownerAccount.createSubAccount({ accountOrPrefix: lending, publicKey: ownerKey.getPublicKey(), nearToTransfer: milliNear(4500) });
  }
  const lendingAccount = accountFor(lending, ownerKey);
  if (!(await hasCode(lending))) {
    log("deploying lending contract");
    await lendingAccount.deployContract(LENDING_WASM);
  }
  if (!(await view(lending, "get_config"))) {
    await call(lendingAccount, lending, "new", { owner_id: owner, guardian_id: owner, oracle_reporters: [oracle] }, BigInt(0));
  }

  // Assets, registrations, seed liquidity.
  if (!(await view(lending, "storage_balance_of", { account_id: owner }))) {
    await call(ownerAccount, lending, "storage_deposit", { account_id: owner }, milliNear(100));
  }
  const registered = new Set(((await view<{ config: { token_id: string } }[]>(lending, "get_assets")) ?? []).map((item) => item.config.token_id));
  for (const asset of ASSETS) {
    const symbol = String(asset.symbol);
    const token = `${symbol.toLowerCase()}.${owner}`;
    if (!registered.has(token)) {
      log(`registering ${symbol} on the lending contract`);
      await call(ownerAccount, lending, "register_asset", { config: { ...asset, token_id: token } }, BigInt(1));
    }
    if (!(await view(token, "storage_balance_of", { account_id: lending }))) {
      await call(ownerAccount, token, "storage_deposit", { account_id: lending }, milliNear(10));
    }
    const pool = await view<{ cash: string }>(lending, "get_asset", { token_id: token });
    if (pool && BigInt(pool.cash) === BigInt(0)) {
      const seed = (BigInt(String(asset.collateral_cap)) / BigInt(100)).toString();
      log(`seeding the ${symbol} pool with ${seed} base units of test liquidity`);
      await call(ownerAccount, token, "mint", { account_id: owner, amount: seed }, milliNear(10));
      await call(ownerAccount, token, "ft_transfer_call", { receiver_id: lending, amount: seed, msg: JSON.stringify({ action: "supply" }) }, BigInt(1), 300);
    }
  }

  // 4. Oracle reporter with a report_prices-only key.
  if (!(await exists(oracle))) {
    log(`creating ${oracle}`);
    await ownerAccount.createSubAccount({ accountOrPrefix: oracle, publicKey: ownerKey.getPublicKey(), nearToTransfer: milliNear(1500) });
  }
  const envFile = ".env.local";
  const envText = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  if (!/RADIRI_ORACLE_PRIVATE_KEY=ed25519:/.test(envText)) {
    const reporterKey = KeyPair.fromRandom("ed25519");
    await accountFor(oracle, ownerKey).addFunctionCallAccessKey({
      publicKey: reporterKey.getPublicKey(),
      contractId: lending,
      methodNames: ["report_prices"],
      allowance: NEAR,
    });
    const lines = envText.split("\n").filter((line) => line && !/^(RADIRI_ORACLE_ACCOUNT|RADIRI_ORACLE_PRIVATE_KEY|NEXT_PUBLIC_LENDING_CONTRACT_ID|NEXT_PUBLIC_TEST_TOKEN_SUFFIX|NEXT_PUBLIC_NEAR_NETWORK)=/.test(line));
    lines.push(
      "NEXT_PUBLIC_NEAR_NETWORK=testnet",
      `NEXT_PUBLIC_LENDING_CONTRACT_ID=${lending}`,
      `NEXT_PUBLIC_TEST_TOKEN_SUFFIX=${owner}`,
      `RADIRI_ORACLE_ACCOUNT=${oracle}`,
      `RADIRI_ORACLE_PRIVATE_KEY=${reporterKey.toString()}`,
    );
    writeFileSync(envFile, `${lines.join("\n")}\n`, { mode: 0o600 });
    log(`oracle key (report_prices only, 1 NEAR allowance) written to ${envFile}`);
  }

  writeFileSync(
    "src/config/deployment.ts",
    `/** Public ids of the Radiri lending deployment on NEAR testnet (written by scripts/testnet-deploy.ts). */\n` +
      `export const TESTNET_DEPLOYMENT = {\n` +
      `  network: "testnet",\n` +
      `  owner: "${owner}",\n` +
      `  lendingContractId: "${lending}",\n` +
      `  tokenSuffix: "${owner}",\n` +
      `  oracleAccountId: "${oracle}",\n` +
      `  deployedAt: "${new Date().toISOString()}",\n` +
      `} as const;\n`,
  );
  log(`done: lending contract ${lending}, tokens under ${owner}`);
}

main().catch((error: unknown) => {
  console.error(`[deploy] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
