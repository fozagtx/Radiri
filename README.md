# Radiri

Borrow tokenized stocks against your meme coins, borrow meme coins against tokenized stocks, and
swap one for the other across chains. Settled on NEAR.
Built at [NEAR HACKATHON](https://nearhackathon.com) (2026-11-01 to 2026-11-14).

- **Borrow stocks with meme coins.** Deposit PEPE, keep your exposure, borrow tokenized Apple.
- **Borrow meme coins with stocks.** Deposit tokenized NVIDIA, borrow PEPE.
- **Swap meme coins for stocks across chains.** PEPE on Ethereum to tokenized Apple (AAPLon) on BNB
  Chain in one NEAR Intents swap, and back.

## Status

| Piece | State |
| --- | --- |
| Cross-chain meme coin <-> tokenized stock swaps | **Live on mainnet** through NEAR Intents 1Click: real quotes, deposit address, wallet send (EVM, Solana) or manual send, settlement tracked from 1Click |
| Lending contract (`contracts/lending`) | Built and tested (52 unit tests, wasm 317 KB). Deploys to **testnet** with `scripts/deploy-lending.sh`; not deployed from this environment because deploying signs with your testnet keys |
| Lending UI (Borrow, Portfolio, Overview, Activity) | Works against the contract when `NEXT_PUBLIC_LENDING_CONTRACT_ID` is set. Without it, a **labelled simulation** runs the same risk engine on live prices; nothing is signed and the banner says so on every page |
| Prices | Live from 1Click: meme coins by symbol, stocks by their Ondo token (AAPLon, TSLAon, NVDAon) |
| Markets | Radiri markets, the live 1Click meme/stock catalog, and RHEA Lending's live mainnet reserves as a reference |
| Route monitor (pre-pivot feature) | Stablecoin route comparison, kept at `/routes` |

Tokenized stocks are Ondo Global Markets tokens listed by 1Click. Their availability depends on
your region and on NEAR Intents. Lending uses testnet test tokens that have **no value**; their
oracle prices mirror the real assets so positions behave like the real market.

## Three journeys

**A. Meme coin collateral, borrow a stock** (`/borrow`, tab "Borrow stocks with meme coins")
Connect NEAR wallet -> deposit tPEPE (`ft_transfer_call` with `{"action":"deposit_collateral"}`) ->
borrowing power = collateral value x 25% LTV -> pick tAAPL -> review health factor, LTV,
liquidation price, oracle freshness -> `borrow` -> position on Portfolio.

**B. Stock collateral, borrow a meme coin** (`/borrow`, tab "Borrow meme coins with stocks")
Same flow with tAAPL / tTSLA / tNVDA as collateral (50% LTV) and a meme coin as the loan.

**C. Meme coin to stock, cross-chain** (`/swap`)
Pick PEPE on Ethereum and AAPLon on BNB Chain -> live dry quote (estimated output, minimum output,
fees, ETA) -> recipient and refund addresses -> executable quote with a deposit address and
deadline -> send from your EVM or Solana wallet (or any wallet manually) -> 1Click status until
`SUCCESS`, `REFUNDED` or `FAILED`.

Checked on 2026-11-14: 1B PEPE (eth) quoted 12.27 AAPLon (bsc) with a 63 s ETA; 1 NVDAon quoted
80.25M PEPE; PEPE to `nZHIPU` returned the verbatim `No liquidity available`. Live numbers move.

## How NEAR fits in

| NEAR piece | Use |
| --- | --- |
| NEAR smart contract (Rust, near-sdk 5.30) | `contracts/lending`: collateral custody, debt, interest, oracle, liquidation; on-chain state is the source of truth |
| NEAR Intents 1Click (official TypeScript SDK) | Token catalog with tokenized stocks, quotes, deposit addresses, deposit submission, execution status |
| NEAR Connect (`@hot-labs/near-connect`) | NEAR wallet for lending transactions |
| RHEA | Smart Router quotes on the route monitor; RHEA Lending reserves read live as the reference market |
| FastNEAR RPC | Contract views |

### Why a custom lending contract instead of RHEA Lending

RHEA Lending (`contract.main.burrow.near`) was checked live: its 26 reserves are stables, NEAR and
liquid staking tokens, BTC/ETH variants, ZEC, QTC and RHEA tokens. None is a meme coin or a
tokenized stock, so it cannot hold PEPE as collateral or lend AAPL. Radiri ships its own contract
for these markets and shows RHEA's reserves on the Markets page for reference.

### Why a reporter-pushed oracle

No on-chain NEAR oracle prices both meme coins and stocks today: Pyth on NEAR has no equity feeds
(and its BTC price was ~80 days old), the OutLayer Price Oracle holds ~18 crypto assets with no
stocks. The contract therefore accepts prices from an authorised reporter, timestamps them, rejects
any single move above the asset's limit, and refuses to borrow or liquidate on a stale price.
`pnpm oracle:push` reports live 1Click prices with a key that can only call `report_prices`.

## Risk model

Per-asset LTV, liquidation threshold, liquidation bonus, reserve factor, collateral and borrow
caps, kinked interest model, max price age and max price move. Health factor =
Σ(collateral x liquidation threshold) / debt; below 1.00 a position can be liquidated (50% close
factor, bonus paid in collateral). The full formulas are in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). The TypeScript copy in `src/lib/risk` is checked
against the Rust contract with shared vectors (`pnpm gen:lending`).

| Category | LTV | Liquidation at | Bonus | Max price age |
| --- | --- | --- | --- | --- |
| Meme coins | 25% | 40% | 15% | 300 s |
| Tokenized stocks | 50% | 65% | 8% | 900 s |

These are conservative testnet starting points, not production values.

## Run it

Requires Node 20+ and pnpm.

```sh
pnpm install
pnpm dev            # http://localhost:3000 -> Open the app
```

No key is needed: swaps quote live, and lending runs the labelled simulation until a contract is
configured.

## Deploy the lending contract (testnet)

```sh
OWNER=<you>.testnet scripts/deploy-lending.sh   # tokens, lending contract, assets, liquidity, oracle key
pnpm oracle:push                                # report live prices (repeat every minute)
```

Details in [`contracts/lending/README.md`](./contracts/lending/README.md).

## Architecture

One Next.js 16 app (App Router, route handlers, server-only modules for every secret); no separate
backend.

```text
src/app/(app)/   overview, borrow, swap, portfolio, markets, activity, routes
src/app/api/     assets, pricing, swaps/{quote,status,submit}, lending/{markets,account},
                 rhea/lending, transactions, plus the route-monitor endpoints
src/lib/         intents (1Click SDK), lending (near + simulated clients), risk (contract math mirror),
                 oracle (1Click prices, staleness), rhea, near (RPC, transactions), wallets (NEAR, EVM, Solana)
src/config/      assets.ts (classification + eligibility), lending-assets.ts (risk parameters)
contracts/       lending, test-token, snapshot-registry (cargo workspace)
prisma/          optional PostgreSQL index for swap history
scripts/         deploy-lending.sh, oracle-push.ts, gen-lending-artifacts.ts, monitor.ts
```

Every asset carries an explicit, independent classification: **swap** eligible (live in 1Click),
**collateral** eligible and **borrow** eligible (registered on the lending contract). One never
implies another. The database is optional and only indexes swaps; balances and debt are always read
from the contract.

## Environment

See [`.env.example`](./.env.example). Everything is optional for local use.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_LENDING_CONTRACT_ID` | Lending contract; unset = labelled simulation |
| `NEXT_PUBLIC_TEST_TOKEN_SUFFIX` | Account the test tokens live under |
| `RADIRI_ORACLE_ACCOUNT` / `RADIRI_ORACLE_PRIVATE_KEY` | Oracle reporter, function-call key limited to `report_prices` |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | Enables WalletConnect; injected EVM wallets work without it |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Solana RPC for SPL deposits |
| `ONECLICK_JWT` | 1Click partner key, removes the 0.2% unauthenticated fee |
| `DATABASE_URL` | Optional swap-history index |

## Verification

```sh
pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm build
cd contracts && cargo test --workspace --lib
```

On the committed tree: 102 TypeScript tests, 78 contract tests (52 lending, 9 test token,
17 snapshot registry), typecheck, lint and production build all pass.

## Hackathon disclosure

Radiri existed before the pivot as a stablecoin route monitor with a snapshot registry contract
(commits up to `6424ae9`). The lending contract, test token, swap execution flow, tokenized stock
catalog, risk engine, oracle reporter and the Overview / Borrow / Swap / Portfolio / Markets /
Activity app were built during the hackathon on branch `ccr-80a3be39-dxl70y`.

## Built with

near-sdk 5.30, near-contract-standards, cargo-near, Next.js 16, React 19, Tailwind CSS 4,
shadcn/ui on `@base-ui/react`, `@defuse-protocol/one-click-sdk-typescript`, `@hot-labs/near-connect`,
wagmi + viem, `@solana/wallet-adapter-react`, Prisma 7, zod, vitest. Parts of the code were written
with AI assistance and reviewed.

## License

MIT, see [LICENSE](./LICENSE).
