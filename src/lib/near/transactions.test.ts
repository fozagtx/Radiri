import { describe, expect, it } from "vitest";
import { isValidAccountId, NEAR_TO_YOCTO } from "./rpc";
import {
  DEFAULT_TOKEN_STORAGE_DEPOSIT,
  LENDING_CALL_GAS,
  LENDING_STORAGE_DEPOSIT,
  outcomeFailures,
  outcomeHash,
  outcomeSuccessValue,
  planLendingAction,
  testTokenMintTx,
} from "./transactions";

const base = { contractId: "lending.radiri.testnet", accountId: "alice.testnet", lendingRegistered: true, tokenRegistered: true };

describe("planLendingAction", () => {
  it("deposits collateral with ft_transfer_call, 1 yocto, the section 4 msg", () => {
    const plan = planLendingAction({ ...base, action: { kind: "deposit_collateral", tokenId: "tpepe.radiri.testnet", amount: "1000" } });
    expect(plan.transactions).toEqual([
      {
        receiverId: "tpepe.radiri.testnet",
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "ft_transfer_call",
              args: { receiver_id: "lending.radiri.testnet", amount: "1000", msg: '{"action":"deposit_collateral"}' },
              gas: LENDING_CALL_GAS,
              deposit: "1",
            },
          },
        ],
      },
    ]);
    expect(LENDING_CALL_GAS).toBe("300000000000000");
  });

  it("registers a new account on the lending contract first (0.1 NEAR)", () => {
    const plan = planLendingAction({ ...base, lendingRegistered: false, action: { kind: "repay", tokenId: "taapl.radiri.testnet", amount: "5" } });
    expect(plan.transactions).toHaveLength(2);
    expect(plan.transactions[0].receiverId).toBe("lending.radiri.testnet");
    expect(plan.transactions[0].actions[0].params).toMatchObject({
      methodName: "storage_deposit",
      args: { account_id: "alice.testnet", registration_only: true },
      deposit: "100000000000000000000000",
    });
    expect(LENDING_STORAGE_DEPOSIT).toBe(NEAR_TO_YOCTO("0.1"));
    expect(JSON.parse(plan.transactions[1].actions[0].params.args.msg as string)).toEqual({ action: "repay" });
  });

  it("registers the user on the token before a borrow sends it", () => {
    const plan = planLendingAction({
      ...base,
      tokenRegistered: false,
      action: { kind: "borrow", tokenId: "taapl.radiri.testnet", amount: "100000000" },
    });
    expect(plan.transactions.map((tx) => tx.receiverId)).toEqual(["taapl.radiri.testnet", "lending.radiri.testnet"]);
    expect(plan.transactions[0].actions[0].params.deposit).toBe(DEFAULT_TOKEN_STORAGE_DEPOSIT);
    expect(plan.transactions[1].actions[0].params).toEqual({
      methodName: "borrow",
      args: { token_id: "taapl.radiri.testnet", amount: "100000000" },
      gas: "300000000000000",
      deposit: "1",
    });
    expect(plan.steps).toHaveLength(2);
  });

  it("does not register on the token for deposits, and uses the token's own bound when known", () => {
    const deposit = planLendingAction({ ...base, tokenRegistered: false, action: { kind: "supply", tokenId: "t.testnet", amount: "1" } });
    expect(deposit.transactions).toHaveLength(1);
    const withdraw = planLendingAction({
      ...base,
      tokenRegistered: false,
      tokenStorageDeposit: "2350000000000000000000",
      action: { kind: "withdraw_collateral", tokenId: "t.testnet", amount: "1" },
    });
    expect(withdraw.transactions[0].actions[0].params.deposit).toBe("2350000000000000000000");
    expect(withdraw.transactions[1].actions[0].params.methodName).toBe("withdraw_collateral");
  });

  it("builds the testnet faucet mint call", () => {
    expect(testTokenMintTx("tpepe.radiri.testnet", "alice.testnet", "7").actions[0].params).toMatchObject({
      methodName: "mint",
      args: { account_id: "alice.testnet", amount: "7" },
    });
  });
});

describe("outcome parsing", () => {
  const encode = (value: unknown) => btoa(JSON.stringify(value));

  it("reads hashes, failures and success values", () => {
    const ok = { status: { SuccessValue: encode("1000") }, transaction: { hash: "AbC" }, receipts_outcome: [] };
    expect(outcomeHash(ok)).toBe("AbC");
    expect(outcomeFailures(ok)).toEqual([]);
    expect(outcomeSuccessValue(ok)).toBe("1000");

    const failed = {
      status: { SuccessValue: "" },
      transaction_outcome: { id: "XyZ" },
      receipts_outcome: [{ id: "r1", outcome: { status: { Failure: { ActionError: { kind: "x" } } } } }],
    };
    expect(outcomeHash(failed)).toBe("XyZ");
    expect(outcomeFailures(failed)).toHaveLength(1);
    expect(outcomeSuccessValue(failed)).toBeUndefined();
    expect(outcomeHash(null)).toBeNull();
  });
});

describe("isValidAccountId", () => {
  it("accepts NEAR account ids and rejects the rest", () => {
    expect(isValidAccountId("alice.testnet")).toBe(true);
    expect(isValidAccountId("a".repeat(64))).toBe(true);
    expect(isValidAccountId("Alice.testnet")).toBe(false);
    expect(isValidAccountId("a")).toBe(false);
    expect(isValidAccountId("bad..dots")).toBe(false);
    expect(isValidAccountId("x".repeat(65))).toBe(false);
  });
});
