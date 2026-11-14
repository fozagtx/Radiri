# radiri-lending

NEAR lending contract (near-sdk 5.30.1) for two markets on one contract: deposit meme coins and
borrow tokenized stocks, or deposit tokenized stocks and borrow meme coins. Collateral, debt,
liquidity and prices live in one contract so every health check and the balance change it
authorises happen in the same transaction (NEAR cross-contract calls are asynchronous).

The full interface (units, formulas, JSON views, messages) is in
[`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md#4-lending-contract-interface-contractslending).

## Modules

| File | Responsibility |
| --- | --- |
| `registry.rs` | Asset registry, `register_asset` / `update_asset`, config validation (LT > LTV, caps, bounds) |
| `oracle.rs` | Reporter-pushed prices, `max_price_age_sec` staleness, `max_price_change_bps` deviation guard, owner `force_price` |
| `vault.rs` | Per-account collateral and scaled debt accounting |
| `pool.rs` | Supply shares, cash, reserves, `withdraw_supply` |
| `interest.rs` | Kinked utilization rate model, borrow index accrual |
| `borrow.rs` | `borrow`, repay, `withdraw_collateral`, callbacks that restore state if the outgoing transfer fails |
| `liquidation.rs` | Close factor 50%, per-asset bonus, seize capped by collateral with proportional repay, refunds |
| `config.rs` | Owner, guardian, reporters, global pause |
| `storage.rs` | NEP-145, fixed 0.1 NEAR per account |
| `events.rs` | NEP-297 events, `standard: "radiri-lending"` |
| `math.rs` | Checked arithmetic, 256-bit `mul_div` (amount x price overflows u128 for meme coins) |

## Safety rules the code enforces

- Unregistered tokens cannot be deposited; `ft_on_transfer` only accepts registered token contracts.
- A stale or missing price never authorises a borrow, a withdrawal with open debt, or a liquidation.
- A withdrawal cannot push the debt above the borrow limit.
- A borrow cannot exceed pool cash, the asset's `borrow_cap`, or the account's borrow limit.
- Deposits beyond an asset's `collateral_cap` (protocol-wide concentration limit) are rejected.
- Global pause (guardian or owner) stops deposits, supply, borrows and withdrawals; repay and
  liquidation stay open. Only the owner unpauses.
- State is updated before every outgoing `ft_transfer`; the callback rolls it back if the
  transfer fails.

## Tests

```sh
cd contracts
cargo test --workspace --lib    # 52 lending + 9 test-token unit tests
```

`src/vector_tests.rs` checks the contract math against `tests/vectors/lending-math.json`, which is
generated from the TypeScript mirror in `src/lib/risk` (`pnpm gen:lending`). The UI's previews and
the contract's checks therefore produce the same numbers for value, health factor, utilization,
interest rates, index accrual and liquidation.

The near-workspaces sandbox test was not added: the sandbox needs to download a `neard` binary,
which this build environment cannot reach.

## Build

```sh
cd contracts/lending && cargo near build non-reproducible-wasm --no-abi
# -> contracts/target/near/radiri_lending/radiri_lending.wasm (about 317 KB)
```

## Deployed on testnet

| Account | Role |
| --- | --- |
| `lending.radiri-markets.testnet` | lending contract |
| `tpepe`, `twif`, `tshib`, `tbrett`, `taapl`, `ttsla`, `tnvda` `.radiri-markets.testnet` | test tokens (no value) |
| `oracle.radiri-markets.testnet` | price reporter; its app key can only call `report_prices` (1 NEAR allowance) |
| `radiri-markets.testnet` | owner and guardian |

`scripts/testnet-deploy.ts` (`pnpm deploy:testnet [owner.testnet]`) did all of it with near-api-js: owner
account from the NEAR testnet faucet, sub-accounts, both wasm files, every `register_asset`, token
registrations, seed liquidity, and the reporter key. It refuses non-testnet accounts and resumes if
interrupted. Keys stay outside the repository (`~/.near-credentials/testnet/`, `.env.local`).

`scripts/testnet-journeys.ts` (`pnpm journeys:testnet`) replays journeys A and B as real transactions
from a fresh faucet account: mint tPEPE, deposit, borrow tAAPL; mint tNVDA, deposit, borrow tPEPE.

Prices: `pnpm oracle:push`, or automatically through `POST /api/oracle/refresh` whenever the app sees
a stale price.

## Risk parameters

Testnet starting points, not production values (rationale in `src/config/lending-assets.ts`):

| Category | LTV | Liquidation threshold | Bonus | Max price age | Max single move |
| --- | --- | --- | --- | --- | --- |
| Meme coins | 25% | 40% | 15% | 300 s | 50% |
| Tokenized stocks | 50% | 65% | 8% | 900 s | 20% |
