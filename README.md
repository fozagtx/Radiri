# Radiri

Borrow tokenized stocks against your meme coins, borrow meme coins against tokenized stocks, and
swap one for the other across chains. Built on NEAR at [NEAR HACKATHON](https://nearhackathon.com)
(2026-11-01 to 2026-11-14).

- **Borrow stocks with meme coins.** Lock PEPE, keep your exposure, borrow tokenized Apple.
- **Borrow meme coins with stocks.** Lock tokenized NVIDIA, borrow PEPE.
- **Swap across chains.** PEPE on Ethereum to tokenized Apple (AAPLon) on BNB Chain in one NEAR
  Intents swap, and back.

## Live

| Piece | Where |
| --- | --- |
| Lending contract | [`lending.radiri-markets.testnet`](https://testnet.nearblocks.io/address/lending.radiri-markets.testnet) on **NEAR testnet** |
| Test tokens (no value) | `tpepe`, `twif`, `tshib`, `tbrett`, `taapl`, `ttsla`, `tnvda` `.radiri-markets.testnet` |
| Price oracle | `oracle.radiri-markets.testnet`, pushing live 1Click prices (PEPE, WIF, SHIB, BRETT, AAPLon, TSLAon, NVDAon) |
| Swaps | NEAR Intents 1Click on **mainnet** (NEAR Intents has no testnet) |

Journeys A and B were run as real testnet transactions from a fresh account
(`pnpm journeys:testnet`): 2B tPEPE deposited, 1 tAAPL borrowed
([tx](https://testnet.nearblocks.io/txns/5VDjp8nVJUdqFqNLwRkruaJzFy5sVTZYm9aCQDZQ352s)); 25 tNVDA
deposited, 10M tPEPE borrowed ([tx](https://testnet.nearblocks.io/txns/Fb1eFo4pqsHCd38soyBm7qUkjK8VVfFuR2GSpsXEng82));
health factor 15.1, interest accruing.

Journey C quotes live: 1B PEPE (Ethereum) → ~11.9 AAPLon (BNB Chain), ~63 s; 1 NVDAon → ~80M PEPE.

## The app

- **Overview:** net position, collateral, debt, borrowing power, a health-factor gauge, positions
  and activity.
- **Borrow:** two markets side by side. Pick collateral, mint test tokens from the testnet faucet,
  deposit, see borrowing capacity, pick what to borrow, review health factor, LTV, liquidation price
  and oracle freshness, sign with your NEAR wallet.
- **Swap:** pay / receive card with real coin, stock and chain logos, live quotes refreshed every
  20 s, recipient and refund addresses, a deposit address with countdown, one-click send from an EVM
  or Solana wallet, settlement tracked from NEAR Intents.
- **Portfolio, Markets, Activity:** positions with accrued interest and liquidation prices, every
  lending market with live price and utilization, the swap catalog, and a unified history.
- A live price ticker runs across the top.

**Logo credits:** coin and chain logos from the [Trust Wallet assets](https://github.com/trustwallet/assets)
repository, NEAR meme coin logos from each token's on-chain NEP-148 metadata
(`scripts/fetch-logos.mjs`); company logos from the Iconify `logos` set (CC0) and
[simple-icons](https://simpleicons.org) (CC0), and the Amazon mark from
[Font Awesome](https://fontawesome.com) (CC BY 4.0) (`scripts/gen-brand-logos.mjs`). All marks belong
to their owners and are used only to identify the assets.

## How NEAR fits in

| NEAR piece | Use |
| --- | --- |
| Rust contract (near-sdk 5.30) | `contracts/lending`: collateral, debt, interest, oracle, liquidation; on-chain state is the source of truth |
| NEAR Intents 1Click (official TS SDK) | Token catalog incl. Ondo tokenized stocks, quotes, deposit addresses, execution status |
| NEAR Connect | NEAR wallet that signs every lending action |
| RHEA | RHEA Lending read live as the reference market (it lists no meme coins or stocks) |
| FastNEAR RPC | Contract views |

**Why its own lending contract:** RHEA Lending's 26 mainnet reserves include no meme coin and no
tokenized stock. **Why a pushed oracle:** Pyth on NEAR has no equity feeds and the OutLayer oracle
has no stocks, so a reporter whose key can only call `report_prices` pushes 1Click prices, and the
contract rejects stale prices and outsized moves. The app refreshes stale prices itself through
`POST /api/oracle/refresh`.

## Risk model

| Category | LTV | Liquidation at | Bonus | Max price age |
| --- | --- | --- | --- | --- |
| Meme coins | 25% | 40% | 15% | 300 s |
| Tokenized stocks | 50% | 65% | 8% | 900 s |

Health factor = Σ(collateral × liquidation threshold) / debt; below 1.00 a position can be
liquidated (50% close factor, bonus paid in collateral). Formulas in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). The TypeScript copy in `src/lib/risk` is checked
against the contract with shared vectors (`pnpm gen:lending`). Testnet starting points, not
production values.

## Run it

```sh
pnpm install
pnpm dev                 # http://localhost:3000 -> Open the app
```

It talks to the deployed testnet contract out of the box. To keep prices fresh, put the reporter
key in `.env.local` / Vercel (`RADIRI_ORACLE_ACCOUNT`, `RADIRI_ORACLE_PRIVATE_KEY`); without it
borrowing pauses whenever prices go stale, exactly as the contract enforces.

```sh
pnpm deploy:testnet my-name.testnet   # your own copy: faucet account, tokens, lending, oracle key
pnpm oracle:push                      # push live prices now
pnpm journeys:testnet                 # replay journeys A and B as real testnet transactions
```

## Layout

```text
src/app/(app)/   overview, borrow, swap, portfolio, markets, activity
src/app/api/     assets, pricing, swaps/{quote,status,submit}, lending/{markets,account},
                 oracle/refresh, rhea/lending, transactions
src/lib/         intents (1Click), lending (contract client), risk (contract math mirror),
                 oracle (prices, push), rhea, near, wallets (NEAR, EVM, Solana)
src/config/      deployment.ts (testnet ids), lending-assets.ts (risk parameters), assets.ts
contracts/       lending, test-token (cargo workspace)
scripts/         testnet-deploy.ts, testnet-journeys.ts, oracle-push.ts, gen-lending-artifacts.ts
```

## Verification

```sh
pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm build
cd contracts && cargo test --workspace --lib
```

## Hackathon disclosure

Radiri existed before the hackathon as a stablecoin route monitor (commits up to `6424ae9`). This
branch replaces it: the lending contract, test tokens, testnet deployment, swap flow, tokenized
stock catalog, risk engine, oracle and the whole app were built during the hackathon, and the
stablecoin features were removed.

## License

MIT, see [LICENSE](./LICENSE).
