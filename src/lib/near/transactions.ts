/**
 * Transaction builders for the lending contract, in NEAR Connect's ConnectorAction format
 * ({ type: "FunctionCall", params: { methodName, args, gas, deposit } }). Pure functions: the
 * caller looks up registration state first and signs the result with the wallet.
 */

import type { LendingAction, U128 } from "@/types/protocol";
import { NEAR_TO_YOCTO, TGAS } from "./rpc";

export interface FunctionCallAction {
  type: "FunctionCall";
  params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string };
}

export interface NearTransaction {
  receiverId: string;
  actions: FunctionCallAction[];
}

export const ONE_YOCTO = "1";
/** Gas for ft_transfer_call and for borrow / withdraw_* (ft_transfer + resolve callback). */
export const LENDING_CALL_GAS = TGAS(300);
export const STORAGE_DEPOSIT_GAS = TGAS(30);
export const MINT_GAS = TGAS(30);
/** NEP-145 fixed STORAGE_DEPOSIT of the lending contract: 0.1 NEAR. */
export const LENDING_STORAGE_DEPOSIT = NEAR_TO_YOCTO("0.1");
/** Typical NEP-141 storage_balance_bounds.min, used when a token's bounds cannot be read. */
export const DEFAULT_TOKEN_STORAGE_DEPOSIT = NEAR_TO_YOCTO("0.00125");

export type FtTransferCallMsg =
  | { action: "deposit_collateral" }
  | { action: "supply" }
  | { action: "repay" }
  | { action: "liquidate"; borrower_id: string; collateral_token_id: string };

function functionCall(methodName: string, args: Record<string, unknown>, gas: string, deposit: string): FunctionCallAction {
  return { type: "FunctionCall", params: { methodName, args, gas, deposit } };
}

/** NEP-145 storage_deposit for `accountId` on `contractId`. */
export function storageDepositTx(contractId: string, accountId: string, deposit: string, registrationOnly = true): NearTransaction {
  return {
    receiverId: contractId,
    actions: [
      functionCall("storage_deposit", { account_id: accountId, registration_only: registrationOnly }, STORAGE_DEPOSIT_GAS, deposit),
    ],
  };
}

/** NEP-141 ft_transfer_call to the lending contract with a section 4 msg. */
export function ftTransferCallTx(tokenId: string, receiverId: string, amount: U128, msg: FtTransferCallMsg): NearTransaction {
  return {
    receiverId: tokenId,
    actions: [
      functionCall(
        "ft_transfer_call",
        { receiver_id: receiverId, amount, msg: JSON.stringify(msg) },
        LENDING_CALL_GAS,
        ONE_YOCTO,
      ),
    ],
  };
}

/** borrow / withdraw_collateral / withdraw_supply: 1 yocto, 300 TGas. */
export function lendingMethodTx(
  contractId: string,
  method: "borrow" | "withdraw_collateral" | "withdraw_supply",
  tokenId: string,
  amount: U128,
): NearTransaction {
  return {
    receiverId: contractId,
    actions: [functionCall(method, { token_id: tokenId, amount }, LENDING_CALL_GAS, ONE_YOCTO)],
  };
}

/**
 * Testnet faucet: the Radiri test token's mint(account_id, amount). Test tokens have no value.
 * `mint` registers an unregistered account itself when at least the storage minimum is attached,
 * so passing it as the deposit keeps the faucet to one transaction instead of a
 * storage_deposit + mint batch.
 */
export function testTokenMintTx(tokenId: string, accountId: string, amount: U128, deposit = "0"): NearTransaction {
  return {
    receiverId: tokenId,
    actions: [functionCall("mint", { account_id: accountId, amount }, MINT_GAS, deposit)],
  };
}

export interface LendingTxPlanInput {
  contractId: string;
  accountId: string;
  action: LendingAction;
  /** storage_balance_of(lending contract, account) is not null. */
  lendingRegistered: boolean;
  /** storage_balance_of(token, account) is not null. Only matters when the user receives tokens. */
  tokenRegistered: boolean;
  /** storage_balance_bounds().min of the token, yoctoNEAR. */
  tokenStorageDeposit?: string;
}

export interface LendingTxPlan {
  transactions: NearTransaction[];
  /** Human-readable steps, same order as `transactions`. */
  steps: string[];
}

/**
 * Every transaction an action needs, in order: register on the lending contract (0.1 NEAR) if the
 * account is new, register on the token before receiving it (borrow / withdrawals), then the action.
 */
export function planLendingAction(input: LendingTxPlanInput): LendingTxPlan {
  const { contractId, accountId, action } = input;
  const transactions: NearTransaction[] = [];
  const steps: string[] = [];

  if (!input.lendingRegistered) {
    transactions.push(storageDepositTx(contractId, accountId, LENDING_STORAGE_DEPOSIT));
    steps.push("Register with the lending contract (0.1 NEAR storage deposit)");
  }

  const receivesTokens = action.kind === "borrow" || action.kind === "withdraw_collateral" || action.kind === "withdraw_supply";
  if (receivesTokens && !input.tokenRegistered) {
    transactions.push(storageDepositTx(action.tokenId, accountId, input.tokenStorageDeposit ?? DEFAULT_TOKEN_STORAGE_DEPOSIT));
    steps.push("Register your account on the token so it can receive it");
  }

  switch (action.kind) {
    case "deposit_collateral":
      transactions.push(ftTransferCallTx(action.tokenId, contractId, action.amount, { action: "deposit_collateral" }));
      steps.push("Transfer the tokens to the lending contract as collateral");
      break;
    case "supply":
      transactions.push(ftTransferCallTx(action.tokenId, contractId, action.amount, { action: "supply" }));
      steps.push("Transfer the tokens to the lending pool as supply");
      break;
    case "repay":
      transactions.push(ftTransferCallTx(action.tokenId, contractId, action.amount, { action: "repay" }));
      steps.push("Transfer the tokens to repay debt (any excess is refunded)");
      break;
    case "borrow":
    case "withdraw_collateral":
    case "withdraw_supply":
      transactions.push(lendingMethodTx(contractId, action.kind, action.tokenId, action.amount));
      steps.push(
        action.kind === "borrow"
          ? "Borrow from the pool"
          : action.kind === "withdraw_collateral"
            ? "Withdraw collateral"
            : "Withdraw supplied tokens",
      );
      break;
  }

  return { transactions, steps };
}

/* ------------------------------------------------------------------ */
/* Outcome parsing                                                      */
/* ------------------------------------------------------------------ */

interface OutcomeLike {
  status?: unknown;
  transaction?: { hash?: unknown };
  transaction_outcome?: { id?: unknown };
  receipts_outcome?: { id?: unknown; outcome?: { status?: unknown; logs?: unknown } }[];
}

/** Transaction hash of a FinalExecutionOutcome returned by the wallet. */
export function outcomeHash(outcome: unknown): string | null {
  const value = outcome as OutcomeLike | null;
  if (!value || typeof value !== "object") return null;
  if (typeof value.transaction?.hash === "string") return value.transaction.hash;
  if (typeof value.transaction_outcome?.id === "string") return value.transaction_outcome.id;
  return null;
}

function failureText(status: unknown): string | null {
  if (!status || typeof status !== "object") return null;
  if (!("Failure" in status)) return null;
  const failure = (status as { Failure: unknown }).Failure;
  try {
    return JSON.stringify(failure);
  } catch {
    return "transaction failed";
  }
}

/** Top-level failure of the transaction, or of any receipt it spawned. */
export function outcomeFailures(outcome: unknown): string[] {
  const value = outcome as OutcomeLike | null;
  if (!value || typeof value !== "object") return [];
  const failures: string[] = [];
  const top = failureText(value.status);
  if (top) failures.push(top);
  for (const receipt of value.receipts_outcome ?? []) {
    const text = failureText(receipt.outcome?.status);
    if (text && !failures.includes(text)) failures.push(text);
  }
  return failures;
}

/** Decoded SuccessValue (base64 JSON) of the transaction, e.g. ft_transfer_call's used amount. */
export function outcomeSuccessValue(outcome: unknown): unknown {
  const value = outcome as OutcomeLike | null;
  const status = value?.status as { SuccessValue?: unknown } | undefined;
  if (!status || typeof status.SuccessValue !== "string" || status.SuccessValue === "") return undefined;
  try {
    const binary = atob(status.SuccessValue);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}
