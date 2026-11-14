<div align="center">

# Radiri

**Borrow tokenized stocks against meme coins. Borrow meme coins against tokenized stocks. Swap one for the other across chains.**

Meme coins on one side, tokenized stocks on the other, one lending contract on NEAR. Lock PEPE and borrow AAPLon; lock NVDAon and borrow PEPE; send PEPE on Ethereum and receive AAPLon on BNB Chain through NEAR Intents.

[Live app](https://radiri.vercel.app) · [Borrow](https://radiri.vercel.app/borrow) · [Markets](https://radiri.vercel.app/markets) · [How the risk works](#risk-model) · [Architecture](./docs/ARCHITECTURE.md)

`NEAR testnet` · `NEAR Intents 1Click` · `MIT`

</div>

---

## Deployment

| | |
| --- | --- |
| **Live app** | https://radiri.vercel.app |
| **Networks** | Lending on **NEAR testnet**; swaps on **NEAR Intents mainnet** (NEAR Intents has no testnet) |
| **Lending contract** | [`lending.radiri-markets.testnet`](https://testnet.nearblocks.io/address/lending.radiri-markets.testnet) |
| **Test tokens (no value)** | `tpepe`, `twif`, `tshib`, `tbrett`, `taapl`, `ttsla`, `tnvda` under `.radiri-markets.testnet` |
| **Price oracle** | `oracle.radiri-markets.testnet`, pushing live 1Click prices (PEPE, $WIF, SHIB, BRETT, AAPLon, TSLAon, NVDAon) |
| **Hosting** | Vercel (Next.js 16) · optional Postgres index |

Journeys A and B were run as real testnet transactions from a fresh account (`pnpm journeys:testnet`): 2B tPEPE deposited and 1 tAAPL borrowed
([tx](https://testnet.nearblocks.io/txns/5VDjp8nVJUdqFqNLwRkruaJzFy5sVTZYm9aCQDZQ352s)); 25 tNVDA deposited and 10M tPEPE borrowed
([tx](https://testnet.nearblocks.io/txns/Fb1eFo4pqsHCd38soyBm7qUkjK8VVfFuR2GSpsXEng82)); health factor 15.1, interest accruing.

Journey C quotes live: 1B PEPE (Ethereum) → ~11.9 AAPLon (BNB Chain), ~63 s; 1 NVDAon → ~80M PEPE.

---

## Contents

1. [The problem](#1-the-problem)
2. [What Radiri does](#2-what-radiri-does)
3. [Who it is for](#3-who-it-is-for)
4. [How it uses NEAR](#4-how-it-uses-near)
5. [How a borrow is verified](#5-how-a-borrow-is-verified)
6. [Trust model](#6-trust-model)
7. [Screens](#7-screens)
8. [Architecture](#8-architecture)
9. [Tooling](#9-tooling)
10. [Risk model](#10-risk-model)
11. [Run it locally](#11-run-it-locally)
12. [Try it on testnet](#12-try-it-on-testnet)
13. [Project structure](#13-project-structure)
14. [Tests](#14-tests)
15. [Limitations and roadmap](#15-limitations-and-roadmap)

---

## 1. The problem

Meme coins and tokenized stocks live in separate worlds. A PEPE holder who wants Apple exposure has to sell. A tokenized-stock holder who wants liquidity has no meme-coin venue. And no NEAR market lists either side: RHEA Lending's 26 reserves are stables, NEAR/LSTs, BTC/ETH variants and RHEA tokens, with no meme coin and no tokenized stock.

The usual workaround is a centralized desk that holds both sides, which means custody, opaque pricing and an operator deciding whether a position is healthy. Radiri does the opposite: one contract prices both categories, holds the collateral, and checks every borrow, withdrawal and liquidation against its own oracle.

## 2. What Radiri does

| Step | Who | What happens |
| --- | --- | --- |
| 1 | User | Mints test tokens from the in-app faucet (or brings assets on mainnet) |
| 2 | User | Deposits collateral; the contract values it with a fresh oracle price |
| 3 | User | Borrows from the other category, capped by the collateral's LTV and the pool's cash |
| 4 | Contract | Accrues interest by utilization on every touch; health factor decides whether a position can be withdrawn or liquidated |
| 5 | User | Repays, withdraws, or swaps the borrowed asset across chains through NEAR Intents |

Two directions, one contract: meme coin collateral → tokenized stock debt, and tokenized stock collateral → meme coin debt.

## 3. Who it is for

- **Meme-coin holders** who want stock exposure without selling the coin.
- **Tokenized-stock holders** who want liquidity in meme coins without leaving the venue.
- **Anyone testing on NEAR testnet**: the faucet mints labelled test tokens, so a full deposit → borrow → repay journey costs nothing real.

## 4. How it uses NEAR

| NEAR piece | Use |
| --- | --- |
| Rust contract (near-sdk 5.30) | `contracts/lending`: collateral, debt, interest, oracle, liquidation; on-chain state is the source of truth |
| NEAR Intents 1Click (official TS SDK) | Token catalog including Ondo tokenized stocks, quotes, deposit addresses, execution status |
| NEAR Connect | NEAR wallet that signs every lending action |
| RHEA | RHEA Lending read live as the reference market |
| FastNEAR RPC | Contract views and transaction submission |

**Why its own lending contract:** RHEA Lending lists no meme coin and no tokenized stock, so there is nothing to plug into. **Why a pushed oracle:** Pyth on NEAR has no equity feeds and the OutLayer oracle has no stocks, so a reporter whose key can only call `report_prices` pushes 1Click prices, and the contract rejects stale prices and outsized moves. The app refreshes stale prices itself through `POST /api/oracle/refresh`.

## 5. How a borrow is verified

The contract runs every check before it moves a token:

| # | Check | Rule |
| --- | --- | --- |
| 1 | Asset registered and eligible | `can_collateralize` / `can_borrow`, and neither the asset nor the contract is paused |
| 2 | Prices fresh | younger than `max_price_age_sec` of every asset the account touches; a stale price authorises nothing |
| 3 | Oracle move bounded | a single report moving more than `max_price_change_bps` (50% meme, 20% stock) is rejected |
| 4 | Liquidity and caps | pool `cash` covers the borrow and the asset's `borrow_cap` is respected |
| 5 | Health | `debt_wad_after <= borrow_limit_wad`, recomputed from the oracle, not from the UI |
| 6 | Transfer safety | state is written before `ft_transfer`; the callback rolls it back if the transfer fails |

The TypeScript copy of the same maths (`src/lib/risk`) runs before signing, so the preview and the contract agree. Shared vectors keep them identical (`pnpm gen:lending`).

## 6. Trust model

| Question | Answer |
| --- | --- |
| Who holds the money? | The contract. The app never custodies keys, collateral or debt. |
| Who can move a position? | Only its owner, signed in their NEAR wallet. Every action is an ordinary testnet transaction. |
| Who can change risk parameters? | The owner (`radiri-markets.testnet` on testnet), with every bound validated on chain; the guardian can pause, only the owner can unpause. |
| Who can report prices? | Only registered reporters, with a function-call key limited to `report_prices`, and outlier/stale reports are rejected. |
| Can the app fake a balance? | No. Every number shown is read from a contract view or an RPC call; the database is only an optional index. |

## 7. Screens

| Screen | Route | Notes |
| --- | --- | --- |
| Overview | `/overview` | Net position, collateral, debt, borrowing power, health-factor gauge, positions, activity |
| Borrow | `/borrow` | Two markets side by side; faucet, deposit, borrow capacity, health preview, liquidation price, oracle freshness |
| Swap | `/swap` | Pay/receive card, live quotes every 20 s, recipient and refund addresses, deposit address with countdown |
| Portfolio | `/portfolio` | Positions with accrued interest and liquidation prices |
| Markets | `/markets` | Every lending market with live price and utilization, plus the 1Click catalog |
| Activity | `/activity` | Unified lending and swap history |
| Landing | `/` | The pitch, with a live price ticker across the app |

## 8. Architecture

```
Next.js 16 app (React 19, Chakra UI 3, App Router)
 ├── Pages ............ /  /overview  /borrow  /swap  /portfolio  /markets  /activity
 └── API routes
      ├── GET  /api/lending/markets       config + every asset view
      ├── GET  /api/lending/account       account view + activity
      ├── POST /api/oracle/refresh        push fresh 1Click prices (stale only)
      ├── POST /api/faucet/account        fund a new implicit testnet account
      ├── GET  /api/assets                classified 1Click catalog + lending eligibility
      ├── GET  /api/pricing               price observations with source and age
      ├── POST /api/swaps/quote|submit    live 1Click quotes and deposits
      ├── GET  /api/swaps/status          settlement status
      ├── GET  /api/rhea/lending          RHEA Lending reserves (reference)
      └── GET  /api/transactions          optional Prisma index
           │
           ├── NEAR testnet ............ lending.radiri-markets.testnet
           ├── NEAR Intents 1Click ..... quotes, deposit addresses, status (mainnet)
           ├── FastNEAR RPC ............ contract views
           └── Postgres (optional) ..... swap history, never balances
```

## 9. Tooling

| Tool | What it does here |
| --- | --- |
| Next.js 16 (App Router, Turbopack) + React 19 + Chakra UI 3 | the app and its route handlers |
| near-sdk 5.30 (Rust) | `contracts/lending` and `contracts/test-token` |
| near-api-js 7.5 | `scripts/testnet-deploy.ts`, `scripts/oracle-push.ts`, the oracle reporter and the sponsor faucet |
| NEAR Connect (`@hot-labs/near-connect`) | wallet signature for every lending action |
| 1Click SDK (`@defuse-protocol/one-click-sdk-typescript`) | swap catalog, quotes, deposit addresses, status |
| FastNEAR RPC | contract views and transaction submission |
| NEAR testnet helper faucet (`helper.testnet.near.org`) | creates the deploy owner and its sub-accounts |
| Sponsor faucet (`POST /api/faucet/account`) | sends 1 test NEAR to a wallet-generated implicit account so a first-time user can mint without leaving the app |
| wagmi + viem, `@solana/wallet-adapter-react` | EVM and Solana wallets for swap deposits |
| Prisma + PostgreSQL (optional) | swap-history index; never a source of truth |
| Vitest, `cargo test` | financial math and contract tests |

## 10. Risk model

| Category | LTV | Liquidation at | Bonus | Max price age |
| --- | --- | --- | --- | --- |
| Meme coins | 25% | 40% | 15% | 300 s |
| Tokenized stocks | 50% | 65% | 8% | 900 s |

Health factor = Σ(collateral × liquidation threshold) / debt; below 1.00 a position can be liquidated (50% close factor, bonus paid in collateral). Formulas and JSON shapes are in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). These are testnet starting points, not production values.

## 11. Run it locally

**Requirements:** Node 22+, pnpm. The app talks to the deployed testnet contract out of the box.

```bash
git clone https://github.com/fozagtx/Radiri.git
cd Radiri
pnpm install
pnpm dev                 # http://localhost:3000
```

These two keys keep the app fully live. Without the reporter key, borrowing pauses whenever on-chain prices go stale, exactly as the contract enforces. Without the sponsor key, users must connect an account that already exists.

| Variable | Required | Purpose |
| --- | --- | --- |
| `RADIRI_ORACLE_ACCOUNT` | for fresh prices | reporter account (`report_prices` only) |
| `RADIRI_ORACLE_PRIVATE_KEY` | for fresh prices | its function-call key |
| `RADIRI_FAUCET_ACCOUNT` | for first-time accounts | sponsor account |
| `RADIRI_FAUCET_PRIVATE_KEY` | for first-time accounts | its full-access key (keep the balance small) |
| `NEXT_PUBLIC_LENDING_CONTRACT_ID` | no | override the committed testnet deployment |
| `NEXT_PUBLIC_TEST_TOKEN_SUFFIX` | no | account the test tokens live under |
| `NEXT_PUBLIC_NEAR_NETWORK` | no | `testnet` (default) |
| `ONECLICK_JWT` | no | 1Click partner key (removes the 0.2% fee) |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | no | enables WalletConnect |
| `DATABASE_URL` | no | optional Postgres index |

```bash
pnpm oracle:push                      # push live prices now
pnpm deploy:testnet my-name.testnet   # your own copy: faucet account, tokens, lending, oracle key
pnpm journeys:testnet                 # replay journeys A and B as real testnet transactions
```

## 12. Try it on testnet

1. Open https://radiri.vercel.app/borrow.
2. Connect a NEAR wallet (NEAR Connect). A brand-new implicit account is funded with 1 test NEAR automatically before its first mint.
3. Click **Mint 2,000,000,000 tPEPE**.
4. Deposit tPEPE, pick a stock (tAAPL, tTSLA or tNVDA) and borrow.
5. Repay or withdraw from **Manage this position**.

No terminal is needed for any of it. The test tokens carry no value and are priced at their real references.

## 13. Project structure

```
src/app/(app)/   overview, borrow, swap, portfolio, markets, activity
src/app/api/     assets, pricing, swaps/{quote,status,submit}, lending/{markets,account},
                 oracle/refresh, faucet/account, rhea/lending, transactions
src/lib/         intents (1Click), lending (contract client), risk (contract math mirror),
                 oracle (prices, push), faucet (sponsor), rhea, near, wallets (NEAR, EVM, Solana)
src/config/      deployment.ts (testnet ids), lending-assets.ts (risk parameters), assets.ts
contracts/       lending, test-token (cargo workspace)
scripts/         testnet-deploy.ts, testnet-journeys.ts, oracle-push.ts, gen-lending-artifacts.ts
docs/            ARCHITECTURE.md (contract interface, formulas, JSON shapes)
```

## 14. Tests

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm build
cd contracts && cargo test --workspace --lib
```

`pnpm test` covers value and health maths, interest accrual, liquidation, previews, transaction planning and display formatting. `cargo test` covers the same maths on chain plus the token's mint cap, registration and storage rules, and checks the contract against the TypeScript vectors.

## 15. Limitations and roadmap

| Today | Next |
| --- | --- |
| Lending runs on testnet with no-value test tokens priced at real references | Mainnet deployment with real Ondo stocks and meme coins |
| One reporter pushes prices | Multi-reporter quorum with a median |
| Swaps are mainnet while lending is testnet | One network once NEAR Intents supports testnet |
| Testnet risk parameters, not audited | External audit before production values |
| English only | Localised UI |

---

MIT, see [LICENSE](./LICENSE).
