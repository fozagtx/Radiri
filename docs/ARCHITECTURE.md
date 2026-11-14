# Radiri architecture: cross-chain lending, borrowing and swaps

This document is the shared contract between the NEAR lending contract (`contracts/lending`),
the Next.js data layer (`src/lib`, `src/app/api`) and the UI. Change it only by agreement, and
keep the Rust math and the TypeScript mirror (`src/lib/risk`) identical.

## 1. Audit of the pre-pivot codebase (2026-11-13)

Radiri started as a cross-chain **stablecoin** route monitor: dry-run quotes from NEAR Intents
1Click and the RHEA Smart Router, ranked in basis points, with an on-chain snapshot registry.

| Area | Before | Decision |
| --- | --- | --- |
| Next.js 16.4.6 App Router, React 19, Tailwind 4, shadcn/ui on `@base-ui/react` | single full-stack app, no separate backend | **KEEP** |
| Branding: name "Radiri", `RadiriMark`, aurora hero, cream/ink palette, Instrument Serif display | landing + dashboard | **KEEP** (do not rename) |
| `src/lib/radiri/adapters/oneclick.ts` 1Click `/v0/quote` (dry) | stable pairs only | **MODIFY**: generalise to any 1Click asset, add live (non-dry) quotes, status, deposit submit |
| `src/lib/radiri/catalog.ts` 1Click `/v0/tokens` cache | filtered to stablecoins | **MODIFY**: classify every token (meme / stock / stable / major / rwa / other) |
| `src/lib/radiri/adapters/rhea.ts` RHEA Smart Router | NEAR-chain quotes | **KEEP** as a NEAR-side route source |
| Stablecoin route compare engine, matrix, opportunities, AI analyst, MCP endpoint | stable monitor | **REMOVED**: stablecoins are not part of this product |
| `contract/` stablecoin snapshot registry and `scripts/monitor.ts` | on-chain quote history | **REMOVED** with the route monitor |
| `@near-wallet-selector` + MyNearWallet | read-only sign-in | **REPLACE** with NEAR Connect (`@hot-labs/near-connect`) |
| No EVM/Solana wallets | — | **BUILD**: wagmi/viem (injected + Reown WalletConnect when a project id is set), Solana wallet adapter |
| No lending, risk, oracle, liquidation, portfolio, activity | — | **BUILD** |
| No database | — | **BUILD** optional Prisma/PostgreSQL index (app works without `DATABASE_URL`) |
| No TS tests | — | **BUILD** vitest suite for every financial calculation |

## 2. Verified facts that shape the design

Checked live on 2026-11-13 from this repository's environment.

1. **1Click supports meme coins cross-chain.** `/v0/tokens` lists PEPE, SHIB, TURBO, SPX, MOG (eth),
   $WIF, BOME, TRUMP, PENGU, MELANIA (sol), BRETT (base), DOGE, BLACKDRAGON, SHITZU (near) and more.
   A dry quote `$WIF (sol) -> PEPE (eth)` returned a route with a 29 s ETA.
2. **1Click lists real tokenized stocks, but only with `ondoTokens=true`.** `/v0/tokens?ondoTokens=true`
   adds Ondo Global Markets stocks on BNB Chain with live prices: AAPLon, TSLAon, NVDAon, MSFTon,
   AMZNon, GOOGLon, METAon, SPYon, QQQon and more. Live dry quotes work both ways:
   1B `PEPE (eth) -> 12.27 AAPLon (bsc)` in ~63 s, `$WIF (sol) -> TSLAon (bsc)`,
   `NVDAon (bsc) -> PEPE (eth)`. NEAR-native `tMU` ("MU Test Stock") and `nZHIPU` have no price, and
   `PEPE -> nZHIPU` returns the verbatim `No liquidity available`. Without the flag no stock appears.
3. **RHEA Lending (`contract.main.burrow.near`, mainnet) cannot serve this product.** Its 26 assets
   are stables, NEAR/LSTs, BTC/ETH variants, ZEC, QTC and RHEA tokens; none is a meme coin or a
   tokenized stock. It prices through Pyth (`aggregate-oracle.near`, 60 s validity, 90 s staleness).
   Consequence: Radiri ships its own lending contract and shows RHEA Lending's live reserves on the
   Markets page, read-only, as the reference market.
4. **No on-chain NEAR oracle prices meme coins and stocks.** `pyth-oracle.near` reports
   `price_feed_exists = false` for the AAPL/TSLA/NVDA ids tried and its BTC price was ~80 days old
   (pull oracle). The OutLayer Price Oracle (`price-oracle.near`, listed in the NEAR docs) holds
   about 18 crypto assets, DOGE the only meme coin, no stocks, last updated ~6.5 days earlier.
   Pyth Hermes now requires an API key. Consequence: the lending contract uses a reporter-pushed
   oracle with staleness and deviation guards, and the reporter takes every price from 1Click
   `/v0/tokens` (meme coins by symbol, stocks by their Ondo token, each with `priceUpdatedAt`).
5. **NEAR Intents has no testnet.** Swaps run on mainnet with the user's own wallet. The lending
   contract deploys to testnet with clearly labelled test tokens.

## 3. Architecture decisions

- **One Next.js app.** Route handlers and server-only modules hold every secret (`ONECLICK_JWT`,
  oracle reporter key, `DATABASE_URL`). No Express/Nest/Fastify.
- **One lending contract, modular source.** NEAR cross-contract calls are asynchronous, so a
  health check in one contract and a balance change in another can interleave. Collateral, debt,
  liquidity and prices live in one contract (`contracts/lending`) split into modules: `registry`,
  `oracle`, `vault`, `pool`, `interest`, `borrow`, `liquidation`, `config`, `events`.
- **On-chain state is authoritative.** The UI reads positions from contract views. The database
  only indexes swaps and observations; it never stands in for a balance or a debt.
- **Eligibility is explicit and independent.** Swap eligibility = present in the live 1Click
  catalog. Collateral and borrow eligibility = registered on the lending contract with
  `can_collateralize` / `can_borrow`. One never implies the other.
- **Lending is live on NEAR testnet.** `src/config/deployment.ts` pins the deployed contract
  (`lending.radiri-markets.testnet`, test tokens under `radiri-markets.testnet`); every position is
  read from it and every action is a transaction the user signs. There is no simulation.
- **Prices stay fresh on demand.** When the app sees a stale on-chain price it calls
  `POST /api/oracle/refresh`, which pushes live 1Click prices with the reporter's function-call key
  (it can only call `report_prices`). `pnpm oracle:push` does the same from a terminal.

## 4. Lending contract interface (`contracts/lending`)

### Units

- Token amounts: `U128` JSON strings in the token's base units.
- Prices: `price_wad: U128` = USD per **whole** token x 1e18. PEPE at $0.0000044 -> `"4400000000000"`.
- USD values in views: `U128` strings, 18-decimal fixed point ("wad").
- Basis points: `u16` integers, 10_000 = 100 %.
- Products like `amount * price` exceed u128 (1e27 PEPE base units x 4.4e12). All `mul_div` goes
  through a 256-bit intermediate and checked arithmetic. Rounding: collateral value and debt repay
  round **down**, debt value and seized amounts round **in the protocol's favour**.

### Formulas (mirror exactly in `src/lib/risk`)

```
value_wad(amount, price_wad, decimals) = amount * price_wad / 10^decimals

borrow_limit_wad      = Σ_collateral value_wad * ltv_bps / 10_000
liq_threshold_wad     = Σ_collateral value_wad * liquidation_threshold_bps / 10_000
debt_wad              = Σ_debt value_wad(debt_amount)
health_factor_wad     = liq_threshold_wad * 1e18 / debt_wad        (null when debt_wad == 0)

can_borrow            : debt_wad_after <= borrow_limit_wad
can_withdraw          : debt_wad <= borrow_limit_wad_after
liquidatable          : debt_wad > liq_threshold_wad              (health factor < 1)

utilization_bps       = borrowed * 10_000 / (cash + borrowed)      (0 when both are 0)
borrow_apr_bps        = U <= U_opt ? base + slope1 * U / U_opt
                                   : base + slope1 + slope2 * (U - U_opt) / (10_000 - U_opt)
supply_apr_bps        = borrow_apr_bps * U / 10_000 * (10_000 - reserve_factor_bps) / 10_000
borrow_index_new      = borrow_index * (1e18 + borrow_apr_bps * 1e18 / 10_000 * dt_sec / 31_536_000) / 1e18
debt(account)         = scaled_debt * borrow_index / 1e18          (scaled_debt = principal * 1e18 / index at borrow)
interest              = total_borrowed_new - total_borrowed_old
reserves             += interest * reserve_factor_bps / 10_000     (rest accrues to suppliers)

liquidation (borrower liquidatable, prices fresh):
  max_repay           = debt(borrower, debt_token) * close_factor_bps / 10_000   (close_factor_bps = 5_000)
  repay               = min(transferred_amount, max_repay)
  seize_value_wad     = value_wad(repay, debt_price) * (10_000 + liquidation_bonus_bps(collateral)) / 10_000
  seize_amount        = seize_value_wad * 10^collateral_decimals / collateral_price   (rounded down)
  if seize_amount > borrower collateral: seize all, scale repay down proportionally (rounded up)
  refund              = transferred_amount - repay
```

A price is **fresh** when it exists, is > 0 and `now - timestamp <= max_price_age_sec` of that asset.
`borrow` needs fresh prices for every collateral and debt asset of the account plus the borrowed
asset. `withdraw_collateral` needs fresh prices whenever the account has debt. Liquidation needs
fresh prices for every asset of the borrower. Stale prices never authorise borrow or liquidation.

### Types (JSON)

```jsonc
// AssetConfig — argument of register_asset / update_asset
{
  "token_id": "tpepe.radiri.testnet",
  "symbol": "tPEPE",
  "decimals": 18,
  "category": "meme",              // "meme" | "stock" | "stable" | "major"
  "can_collateralize": true,
  "can_borrow": true,
  "ltv_bps": 2500,
  "liquidation_threshold_bps": 4000,  // must be > ltv_bps and < 10_000
  "liquidation_bonus_bps": 1500,
  "reserve_factor_bps": 2000,
  "collateral_cap": "0",           // total collateral allowed protocol-wide, base units, "0" = no cap
  "borrow_cap": "0",               // total debt allowed, base units, "0" = no cap
  "interest": { "base_bps": 200, "slope1_bps": 1500, "slope2_bps": 30000, "optimal_utilization_bps": 7000 },
  "max_price_age_sec": 300,
  "max_price_change_bps": 5000,    // a single report moving the price more than this is rejected
  "paused": false
}

// AssetView — get_assets() / get_asset(token_id)
{
  "config": AssetConfig,
  "cash": "…", "total_borrowed": "…", "reserves": "…", "total_collateral": "…",
  "total_supply_shares": "…",
  "borrow_index": "1000000000000000000",
  "utilization_bps": 0, "borrow_apr_bps": 200, "supply_apr_bps": 0,
  "price": { "price_wad": "…", "timestamp_ms": 0 } | null,
  "price_fresh": true,
  "last_accrual_ms": 0
}

// AccountView — get_account(account_id) -> AccountView | null
{
  "account_id": "alice.testnet",
  "collateral": [{ "token_id": "…", "amount": "…", "value_wad": "…" }],
  "supplied":   [{ "token_id": "…", "shares": "…", "amount": "…" }],
  "borrowed":   [{ "token_id": "…", "amount": "…", "value_wad": "…" }],
  "collateral_value_wad": "…",
  "borrow_limit_wad": "…",
  "liquidation_threshold_wad": "…",
  "debt_value_wad": "…",
  "health_factor_wad": "…" | null,
  "prices_fresh": true,
  "liquidatable": false
}

// ActivityEntry — get_account_activity(account_id, from_index, limit), newest first, last 32 kept
{ "kind": "deposit_collateral" | "withdraw_collateral" | "supply" | "withdraw_supply" | "borrow"
          | "repay" | "liquidated" | "liquidate",
  "token_id": "…", "amount": "…", "counterparty": "bob.testnet" | null,
  "timestamp_ms": 0, "block_height": 0 }
```

### Methods

| Method | Caller | Notes |
| --- | --- | --- |
| `new(owner_id, guardian_id, oracle_reporters: Vec<AccountId>)` | init | |
| `register_asset(config)` / `update_asset(config)` | owner | validates every bound in the config |
| `set_oracle_reporters(reporters)` / `set_guardian(guardian_id)` | owner | |
| `pause()` | owner or guardian | global pause |
| `unpause()` | owner | |
| `report_prices(prices: Vec<{ token_id, price_wad }>)` | reporter | timestamp = block time; rejects > `max_price_change_bps` move vs a fresh previous price |
| `force_price(token_id, price_wad)` | owner | bypasses the deviation guard, still timestamped |
| `storage_deposit(account_id?, registration_only?)` / `storage_balance_of` / `storage_unregister` | user | NEP-145, fixed `STORAGE_DEPOSIT` = 0.1 NEAR |
| `ft_on_transfer(sender_id, amount, msg)` | token contract | `msg` is one of below; unused amount returned |
| `borrow(token_id, amount)` | user, 1 yocto | accrue, eligibility, liquidity, cap, fresh prices, health; `ft_transfer` + callback that restores state on failure |
| `withdraw_collateral(token_id, amount)` | user, 1 yocto | health check after withdrawal; callback restores on failure |
| `withdraw_supply(token_id, amount)` | user, 1 yocto | amount of underlying (burns shares, rounded up); cash check |
| views: `get_config`, `get_assets`, `get_asset`, `get_price`, `get_account`, `get_account_activity`, `get_accounts_paged(from_index, limit)`, `is_liquidatable(account_id)` | anyone | |

`ft_on_transfer` messages (JSON string):

```jsonc
{ "action": "deposit_collateral" }
{ "action": "supply" }
{ "action": "repay" }                                   // any excess is refunded
{ "action": "liquidate", "borrower_id": "…", "collateral_token_id": "…" }
```

Global pause blocks deposit, supply, borrow and both withdrawals. Repay and liquidation stay open.
Per-asset `paused` blocks new collateral, supply and borrow of that asset.

Events: NEP-297, `standard: "radiri-lending"`, `version: "1.0.0"`, one event per activity kind plus
`price_report`, `asset_registered`, `asset_updated`, `paused`, `unpaused`.

### Test tokens (`contracts/test-token`)

A NEP-141 token with `mint(account_id, amount)` capped at 10 billion whole tokens per call, used
only on testnet. Names carry "Radiri Test … (no value)". The set: `tPEPE`, `tWIF`, `tSHIB`, `tBRETT`
(meme) and `tAAPL`, `tTSLA`, `tNVDA` (stock). Each test token's oracle price mirrors a named real
reference from 1Click (PEPE, $WIF, SHIB, BRETT; AAPLon, TSLAon, NVDAon). The UI always shows the
"test token" label.

## 5. Next.js layout and ownership

```
src/app/(site)/page.tsx               landing (brand kept)
src/app/(app)/layout.tsx              app shell: sidebar + mobile nav
src/app/(app)/{overview,borrow,swap,portfolio,markets,activity}/page.tsx
src/app/api/assets                    classified 1Click catalog + lending eligibility
src/app/api/swaps/{quote,status,submit}
src/app/api/pricing                   price observations with source + age
src/app/api/lending/{markets,account} lending contract views (server-side RPC)
src/app/api/oracle/refresh         pushes live 1Click prices when on-chain prices are stale
src/app/api/rhea/lending              RHEA Lending reserves, read-only
src/app/api/transactions              optional Prisma index
src/lib/intents   1Click client (official SDK)        src/lib/rhea     Smart Router + Lending reader
src/lib/near      RPC, lending client, tx builders     src/lib/oracle   price sources, staleness, push
src/lib/risk      TS mirror of the contract math       src/lib/lending  LendingClient for the testnet contract
src/lib/wallets   near.tsx, evm.tsx, solana.tsx        src/config       assets, networks, risk params
src/types/protocol.ts shared types                     prisma/          optional index schema
contracts/{lending,test-token}
```

## 6. Environment

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_NEAR_NETWORK` | both | `testnet` (default) for lending |
| `NEXT_PUBLIC_LENDING_CONTRACT_ID` | both | overrides the committed testnet deployment |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | client | enables WalletConnect via Reown; injected EVM wallets work without it |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | client | Solana RPC for SPL deposits, defaults to public mainnet RPC |
| `NEXT_PUBLIC_TEST_TOKEN_SUFFIX` | both | account the test tokens live under, defaults to `radiri.testnet` |
| `ONECLICK_JWT` | server | 1Click partner JWT (optional, removes the 0.2% unauthenticated fee) |
| `RADIRI_ORACLE_ACCOUNT` / `RADIRI_ORACLE_PRIVATE_KEY` | script | function-call key limited to `report_prices` |
| `DATABASE_URL` | server | optional PostgreSQL index |
