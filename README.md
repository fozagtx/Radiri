# Radiri

Cross-chain stablecoin liquidity monitor and route aggregator on NEAR.
Built at [NEAR HACKATHON](https://nearhackathon.com) (2026-11-01 to 2026-11-14).

Ask one question: what does it actually cost to move 100,000 USDC from one chain or issuer
to another right now, and who can fill that size?

Radiri aggregates every route (NEAR Intents 1Click across chains, Rhea Smart Router on
NEAR), normalizes each quote to basis points, flags the routes that cannot fill the size,
has a NEAR AI Cloud model explain the result, and records each round on a NEAR contract so
a quote can be checked after the fact.

## Status

| Piece | State |
| --- | --- |
| Live demo | https://radiri.vercel.app |
| Live quoting (1Click + Rhea), aggregation, matrix, opportunities | Working, no keys needed |
| AI analyst | Working with `NEARAI_API_KEY`, otherwise reports the missing key |
| Snapshot contract | Deployed on testnet at `radiri.testnet`, 10 snapshot rows written by the monitor |
| Monitor script | Working, writes batches with a reporter key limited to `record_snapshots` |
| MCP endpoint | `POST /api/mcp`, exposes `compare_routes`, `liquidity_matrix`, `list_stablecoins` |

No mock data anywhere. Every number on screen comes from a live source, and every failure
is shown with its verbatim reason.

## Contents

- [The problem](#the-problem)
- [What it does](#what-it-does)
- [Try it: do X, see Y](#try-it-do-x-see-y)
- [How NEAR fits in](#how-near-fits-in)
- [Trust and safety model](#trust-and-safety-model)
- [Architecture](#architecture)
- [Contract](#contract)
- [Monitor](#monitor)
- [Environment](#environment)
- [Verification](#verification)
- [Built with](#built-with)
- [License](#license)

## The problem

Stablecoin treasury movement is priced by feel. Two sources for the same pair can differ by
tens of basis points, and some routes quietly stop quoting above a certain size. A team
moving a 10,000 or a 100,000 transfer has no single place showing the cost, the worst
case at the quoted slippage, and which source actually has liquidity at that size.

## What it does

- Quotes NEAR Intents 1Click and the Rhea Smart Router in parallel for one pair and size,
  server side, always as a dry run.
- Shows amount received, cost in basis points against a 1:1 peg (negative means the user
  receives more than they sent), worst case at the quoted slippage, reported fees and ETA.
- Flags four kinds of finding from real quote data: `liquidity-gap` (one source has no route
  at this size and another fills it), `expensive-route`, `cross-chain-spread` (the same
  stable pair is cheaper from another chain) and `source-divergence` (the two sources
  disagree on the same pair).
- Sweeps a 32-cell matrix of stablecoin pairs at the chosen size in one request.
- Sends the quote set to a NEAR AI Cloud model for a plain-language read, including the TEE
  signature endpoint when the reply is signed.
- Records snapshots on a NEAR contract through a reporter account, so history is on chain.

## Try it: do X, see Y

Requires Node 20+ and pnpm. No wallet, key or account is needed for the quotes; they are
public dry runs.

```sh
pnpm install
pnpm dev
```

Open http://localhost:3000. It loads `USDC on near` to `USDT on near` at 100,000.

1. **See a liquidity gap at 100,000.** The hero shows NEAR Intents returning
   `No liquidity available` verbatim while Rhea fills the same pair at 99,831 USDT (about
   16.8 bps). The opportunities panel flags both NEAR directions as `liquidity-gap` and adds
   a `cross-chain-spread` for USDC to USDT on eth versus near.
2. **Lower the amount to 10,000.** Both sources quote now: NEAR Intents returns 10,004 USDT
   (-4.1 bps), Rhea 9,988 USDT (11.9 bps). The `liquidity-gap` flags disappear and
   `source-divergence` appears, about 16 bps on the same pair.
3. **Raise the amount to 1,000,000.** NEAR Intents still has no route and Rhea fills only
   456,333 USDT, a cost of 5,436.7 bps, so both sources fail at that size. Change the target
   to `USDT on sol` at the same size and neither source returns a route.
4. **Click Recheck** to requote, and use the swap toggle to see the reverse pair.
5. **Open the liquidity matrix panel.** It quotes 32 pairs at the current size and lists
   every gap it finds. At 100,000 both NEAR directions show up.
6. **Ask the AI analyst.** With `NEARAI_API_KEY` set it reads the exact quote payload and
   explains which route to take. Without a key the panel says so instead of guessing.
7. **Read the on-chain snapshots panel.** With a deployed contract and a monitor run it
   lists the rows the contract holds. Without a contract id the endpoint returns the reason,
   not empty data.

The numbers above were observed on 2026-11-13 and are used only as demo sizes, not as
expected values. Live quotes move, and every figure on screen is fetched at render time.

## How NEAR fits in

| NEAR piece | What Radiri uses it for |
| --- | --- |
| NEAR Intents (1Click) | Cross-chain route source. Quotes via `POST /v0/quote` with `dry: true`, so nothing is deposited or swapped. |
| Rhea Smart Router | NEAR-native AMM route source via `swapMultiDexPath`, the source that fills pairs 1Click will not quote. |
| NEAR contract (`contract/`) | Snapshot registry. Reporter-only writes, latest snapshot per pair and source, 48-entry ring buffer, NEP-297 event, view methods. |
| NEAR AI Cloud | The analyst: OpenAI-compatible chat completions in a TEE, plus `GET /v1/signature/{chat_id}` for the reply signature and signing address. |
| NEAR wallet and JSON-RPC | `@hot-labs/near-connect` for the wallet header, FastNEAR public RPC for read-only contract views. The app sends no transaction. |

Quotes come from mainnet liquidity because NEAR Intents has no testnet. The registry
contract deploys to testnet with free testnet NEAR.

## Trust and safety model

- **Read-only quoting.** Every quote is `dry: true`. The app never signs, deposits or swaps.
  The Execute affordance is a link to https://intents.near.org, where the user acts in their
  own wallet.
- **Least-privilege writer.** The monitor signs with a function-call access key limited to
  `record_snapshots`, with an allowance cap. That key cannot rotate the reporter or change
  ownership. Owner and reporter are separate accounts.
- **No client-side secrets.** `ONECLICK_JWT`, `NEARAI_API_KEY` and the reporter key are
  server-only. Nothing secret uses the `NEXT_PUBLIC_` prefix, and `.env.local` is gitignored.
- **Verifiable inference.** When NEAR AI Cloud signs a reply, the analyst panel exposes the
  signature lookup so the answer can be checked.
- **No fabricated data.** A failing source is shown with its reason verbatim, and the
  contract records `no_liquidity` or `error` rather than a guessed number.

## Architecture

```text
browser
  |  /api/stables    1Click token catalog, cached 5 min
  |  /api/compare    1Click + Rhea in parallel, ranked, opportunities derived
  |  /api/matrix     32 pairs at one size, gaps across the sweep
  |  /api/analyst    NEAR AI Cloud chat completions + signature lookup
  |  /api/snapshots  contract views over NEAR JSON-RPC
  v
src/lib/radiri: catalog -> adapters(oneclick, rhea) -> engine -> opportunities -> ai
  |                |                |                |
  |                |                |                +-- NEAR AI Cloud (server key)
  |                |                +-- Rhea Smart Router
  |                +-- 1Click /v0/quote (dry run)
  +-- NEAR RPC (read-only)

scripts/monitor.ts -> record_snapshots -> contract/ (reporter function-call key)
```

| Path | What |
| --- | --- |
| `contract/` | Rust registry contract, near-sdk 5.30.1. See [`contract/README.md`](./contract/README.md). |
| `src/app/api/` | Route handlers listed above, all request-time dynamic. |
| `src/lib/radiri/` | Catalog cache, adapters, engine, opportunity derivation, analyst, shared types (`types.ts` is the API/UI contract). |
| `src/components/radiri/` | Dashboard: route form, gap hero, route cards, source table, matrix, opportunities, analyst, snapshot history. |
| `src/components/wallet-provider.tsx` | NEAR wallet connection via `@hot-labs/near-connect`. |
| `scripts/monitor.ts` | Quotes a fixed set of pairs, then records them on the contract. |

## Contract

```sh
cd contract
cargo test --lib                        # 17 unit tests
cargo test --test sandbox               # local sandbox: init, access control, ring buffer, event
cargo near build non-reproducible-wasm  # -> target/near/radiri_contract.wasm (163.9 KB)
```

Deploying needs a testnet account and signs a transaction, so it is a deliberate manual
step. Full commands, the interface, storage layout and the reporter function-call key setup
are in [`contract/README.md`](./contract/README.md).

## Monitor

```sh
pnpm monitor   # needs NEXT_PUBLIC_CONTRACT_ID, RADIRI_REPORTER_ACCOUNT, RADIRI_REPORTER_PRIVATE_KEY
```

It quotes the configured pairs, batches `record_snapshots` calls, and prints the transaction
hash and explorer link for each. With any of those variables missing it exits with the list
of what is missing and submits nothing.

Current deployment: contract `radiri.testnet`, reporter `radiri-reporter.testnet` signing with
a function-call key capped at 1 NEAR and restricted to `record_snapshots`.

## Agent access over MCP

`POST /api/mcp` is a JSON-RPC 2.0 MCP endpoint over the same engine the UI uses. Tools:
`compare_routes`, `liquidity_matrix`, `list_stablecoins`.

```sh
curl -s https://radiri.vercel.app/api/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"compare_routes",
       "arguments":{"from":{"symbol":"USDC","chain":"near"},
                    "to":{"symbol":"USDT","chain":"near"},"amount":10000}}}'
```

## Environment

Copy `.env.example` to `.env.local`. Only `NEXT_PUBLIC_CONTRACT_ID` matters for the snapshot
panel; everything else degrades with a visible reason when unset.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_NEAR_NETWORK` | client, server | `testnet` (default) or `mainnet` |
| `NEXT_PUBLIC_CONTRACT_ID` | client, server | Registry contract account |
| `NEXT_PUBLIC_NEAR_RPC_URL` | client, server | Optional RPC override, defaults to FastNEAR |
| `ONECLICK_JWT` | server | Optional 1Click partner JWT, lowers fees and raises limits |
| `INTENTS_EXPLORER_JWT` | server | Optional Intents Explorer JWT |
| `NEARAI_API_KEY` | server | Analyst key from https://cloud.near.ai or the NEAR Builders dashboard |
| `NEARAI_MODEL` | server | Optional model override, defaults to `google/gemini-2.5-flash` |
| `RADIRI_REPORTER_ACCOUNT` | monitor | Reporter account id |
| `RADIRI_REPORTER_PRIVATE_KEY` | monitor | Function-call key limited to `record_snapshots` |

Deploying on Vercel: set the `NEXT_PUBLIC_*` values in the project environment before the
build, since they are inlined at build time. Nothing else in the app is origin-specific.

## Verification

```sh
pnpm exec tsc --noEmit
pnpm lint
pnpm build
cd contract && cargo test --lib && cargo test --test sandbox
```

All commands above pass on the committed tree. The contract has 17 unit tests and one
sandbox integration test that exercises init, reporter-only writes, cheapest-`ok` selection,
the ring buffer, the event log and owner-only reporter rotation.

## Built with

`near-sdk` 5.30, `cargo-near`, `near-workspaces`, `near-cli-rs`, `near-api-js`, Next.js 16
(App Router, Turbopack), React 19, Tailwind CSS 4, shadcn/ui components on `@base-ui/react`,
`lucide-react`, `sonner`, `next-themes`, `@hot-labs/near-connect` 0.12. The shadcn/ui
component files and parts of the application code were written with AI assistance and
reviewed by hand; all libraries are public and listed above.

## License

MIT, see [LICENSE](./LICENSE).
