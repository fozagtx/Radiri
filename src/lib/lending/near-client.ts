/**
 * NearLendingClient: reads the Radiri lending contract through this app's route handlers
 * (`/api/lending/markets`, `/api/lending/account`, server-side RPC) and executes actions as real
 * NEAR transactions signed in the user's wallet (NEAR Connect). On-chain state is authoritative:
 * after every action the UI re-reads the contract instead of trusting local state.
 */

import { EXPLORER_URL } from "@/lib/config";
import {
  ftBalanceOf,
  outcomeFailures,
  outcomeHash,
  outcomeSuccessValue,
  planLendingAction,
  storageBalanceBounds,
  storageBalanceOf,
  testTokenMintTx,
  DEFAULT_TOKEN_STORAGE_DEPOSIT,
  type NearTransaction,
} from "@/lib/near";
import { u128, ZERO } from "@/lib/risk";
import type {
  AccountView,
  ActivityEntry,
  AssetView,
  LendingAction,
  LendingConfigView,
} from "@/types/protocol";
import {
  type ExecutionResult,
  type FaucetResult,
  LendingActionError,
  type LendingClientExt,
  type NearTransactionSigner,
  type WalletBalance,
} from "./types";

export interface MarketsResponse {
  mode: "near";
  contractId: string;
  config: LendingConfigView;
  assets: AssetView[];
}

export interface AccountResponse {
  mode: "near";
  account: AccountView | null;
  activity: ActivityEntry[];
}

export interface NearClientOptions {
  contractId: string;
  signer?: NearTransactionSigner | null;
}

export function txExplorerUrl(hash: string): string {
  return `${EXPLORER_URL}/txns/${hash}`;
}

async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (error) {
    throw new Error(`${url} unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

export class NearLendingClient implements LendingClientExt {
  readonly mode = "near" as const;
  readonly contractId: string;
  private readonly signer: NearTransactionSigner | null;
  private marketsPromise: Promise<MarketsResponse> | null = null;
  private marketsAt = 0;
  private accountPromises = new Map<string, { at: number; promise: Promise<AccountResponse> }>();

  constructor(options: NearClientOptions) {
    this.contractId = options.contractId;
    this.signer = options.signer ?? null;
  }

  /* ---------------------------- views ---------------------------- */

  private markets(): Promise<MarketsResponse> {
    const now = Date.now();
    if (this.marketsPromise && now - this.marketsAt < 2_000) return this.marketsPromise;
    this.marketsAt = now;
    this.marketsPromise = getJson<MarketsResponse>("/api/lending/markets").catch((error) => {
      this.marketsPromise = null;
      throw error;
    });
    return this.marketsPromise;
  }

  private account(accountId: string): Promise<AccountResponse> {
    const now = Date.now();
    const cached = this.accountPromises.get(accountId);
    if (cached && now - cached.at < 2_000) return cached.promise;
    const promise = getJson<AccountResponse>(`/api/lending/account?accountId=${encodeURIComponent(accountId)}`).catch((error) => {
      this.accountPromises.delete(accountId);
      throw error;
    });
    this.accountPromises.set(accountId, { at: now, promise });
    return promise;
  }

  /** Drop short-lived view caches (call after a transaction). */
  invalidate(): void {
    this.marketsPromise = null;
    this.accountPromises.clear();
  }

  async getConfig(): Promise<LendingConfigView> {
    return (await this.markets()).config;
  }

  async getAssets(): Promise<AssetView[]> {
    return (await this.markets()).assets;
  }

  async getAccount(accountId: string): Promise<AccountView | null> {
    return (await this.account(accountId)).account;
  }

  async getActivity(accountId: string, limit = 32): Promise<ActivityEntry[]> {
    return (await this.account(accountId)).activity.slice(0, Math.max(0, limit));
  }

  async getWalletBalance(tokenId: string, accountId: string): Promise<WalletBalance | null> {
    try {
      return { amount: u128(await ftBalanceOf(tokenId, accountId)), source: "chain" };
    } catch {
      return null;
    }
  }

  /* ---------------------------- signing ---------------------------- */

  private requireSigner(): NearTransactionSigner {
    if (!this.signer) throw new LendingActionError("Connect a NEAR wallet to sign this transaction");
    return this.signer;
  }

  private async send(transactions: NearTransaction[]): Promise<{ outcomes: unknown[]; txHashes: string[]; explorerUrls: string[] }> {
    const signer = this.requireSigner();
    const outcomes = await signer.signAndSendTransactions(transactions);
    const txHashes = outcomes.map(outcomeHash).filter((hash): hash is string => typeof hash === "string");
    const explorerUrls = txHashes.map(txExplorerUrl);
    this.invalidate();
    const failures = outcomes.flatMap(outcomeFailures);
    if (failures.length > 0) {
      throw new LendingActionError(`Transaction failed on chain: ${failures.join("; ")}`, { txHashes, explorerUrls });
    }
    return { outcomes, txHashes, explorerUrls };
  }

  private async tokenStorage(tokenId: string, accountId: string): Promise<{ registered: boolean; deposit: string }> {
    const [balance, bounds] = await Promise.all([
      storageBalanceOf(tokenId, accountId),
      storageBalanceBounds(tokenId).catch(() => null),
    ]);
    return { registered: balance !== null, deposit: bounds?.min ?? DEFAULT_TOKEN_STORAGE_DEPOSIT };
  }

  async execute(accountId: string, action: LendingAction): Promise<ExecutionResult> {
    const amount = u128(action.amount, "amount");
    if (amount === ZERO) throw new LendingActionError("Enter an amount above zero");
    this.requireSigner();

    const receives = action.kind === "borrow" || action.kind === "withdraw_collateral" || action.kind === "withdraw_supply";
    const [lendingStorage, token] = await Promise.all([
      storageBalanceOf(this.contractId, accountId),
      receives ? this.tokenStorage(action.tokenId, accountId) : Promise.resolve({ registered: true, deposit: DEFAULT_TOKEN_STORAGE_DEPOSIT }),
    ]);

    const plan = planLendingAction({
      contractId: this.contractId,
      accountId,
      action,
      lendingRegistered: lendingStorage !== null,
      tokenRegistered: token.registered,
      tokenStorageDeposit: token.deposit,
    });

    const { outcomes, txHashes, explorerUrls } = await this.send(plan.transactions);
    const notes: string[] = [];

    if (action.kind === "deposit_collateral" || action.kind === "supply" || action.kind === "repay") {
      // ft_transfer_call resolves to the amount the receiver kept; the rest was refunded.
      const used = outcomeSuccessValue(outcomes[outcomes.length - 1]);
      if (typeof used === "string" && /^\d+$/.test(used)) {
        const kept = BigInt(used);
        if (kept === ZERO) {
          throw new LendingActionError(
            "The lending contract refunded the whole transfer (the action was rejected on chain). Check pause state, caps and eligibility.",
            { txHashes, explorerUrls },
          );
        }
        if (kept < amount) notes.push(`The contract kept ${kept} of ${amount} base units and refunded the rest.`);
      }
    }

    return { mode: "near", txHashes, explorerUrls, notes };
  }

  /** Testnet faucet: mint Radiri test tokens (no value) to the user. Registers on the token first. */
  async faucet(accountId: string, tokenId: string, amount: string): Promise<FaucetResult> {
    this.requireSigner();
    const value = u128(amount, "amount");
    if (value === ZERO) throw new LendingActionError("Faucet amount must be above zero");
    const token = await this.tokenStorage(tokenId, accountId);
    // mint auto-registers when the storage deposit is attached, so this is always one transaction.
    const transactions: NearTransaction[] = [
      testTokenMintTx(tokenId, accountId, amount, token.registered ? "0" : token.deposit),
    ];
    const { txHashes, explorerUrls } = await this.send(transactions);
    return { mode: "near", txHashes, explorerUrls, tokenId, amount };
  }
}
