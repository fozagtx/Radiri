# Radiri contract

On-chain registry for cross-chain stablecoin route snapshots. An off-chain monitor
(`scripts/monitor.ts` in the repo root) quotes stablecoin routes through NEAR Intents
1Click and the Rhea Smart Router, then records the results here. Anyone can read the
latest snapshot per pair and source plus a short rolling history, so a quoted cost can
be checked after the fact instead of trusted.

- Rust, `near-sdk` 5.30.1, crate `radiri-contract`, wasm target `wasm32-unknown-unknown`
- No tokens, no user funds, no upgrade path. The contract stores numbers and emits events.

## Interface

All amounts are integers. `pair_id` is `"<SYMBOL>:<chain>><SYMBOL>:<chain>"`, for example
`USDC:near>USDT:near`; it must be 1 to 64 bytes and must not contain `|`.

| Method | Access | Arguments (JSON) | Returns |
| --- | --- | --- | --- |
| `new(owner, reporter)` | init | `{"owner":"owner.testnet","reporter":"reporter.testnet"}` | state |
| `record_snapshots(snapshots)` | reporter only | `{"snapshots":[SnapshotInput, ...]}` | `u32` number recorded |
| `set_reporter(reporter)` | owner only | `{"reporter":"new-reporter.testnet"}` | - |
| `get_latest(pair_id, source?)` | view | `{"pair_id":"USDC:near>USDT:near","source":null}` | `Snapshot \| null` |
| `get_all_latest(from_index?, limit?)` | view | `{"from_index":0,"limit":100}` | `Snapshot[]` |
| `get_history(pair_id, source, limit?)` | view | `{"pair_id":"...","source":"rhea","limit":48}` | `Snapshot[]` |
| `get_latest_count()` | view | - | `u32` |
| `get_owner()` / `get_reporter()` | view | - | `AccountId` |

`SnapshotInput`:

```json
{
  "pair_id": "USDC:near>USDT:near",
  "source": "rhea",
  "amount_in_usd": 100000,
  "cost_bps": 17,
  "eta_s": null,
  "status": "ok"
}
```

- `source` is `"near-intents"` or `"rhea"`; any other value is rejected.
- `status` is `"ok"`, `"no_liquidity"` or `"error"`; any other value is rejected.
- `eta_s` is optional (`null` when the source reports no estimate).
- `cost_bps` is signed: negative means the user receives more than they sent.

`Snapshot` is the input plus the stamps the contract adds: `timestamp_ms` and
`block_height` from the block that recorded it.

`get_latest(pair_id, source?)` without `source` returns the cheapest `ok` snapshot across
both sources for that pair, falling back to the most recent snapshot of any status when
none is `ok`. With `source`, it returns that source's latest snapshot regardless of status.

`get_history(pair_id, source, limit?)` returns the newest `limit` entries oldest-first.
`limit` defaults to 48 and is capped at 48.

## Limits and access control

| Rule | Value |
| --- | --- |
| Snapshots per `record_snapshots` call | 1 to 50 |
| History kept per `pair_id|source` | 48 (oldest dropped) |
| `get_all_latest` page size | default 100, capped at 100 |
| `pair_id` length | 1 to 64 bytes |

Only `reporter` may call `record_snapshots`; only `owner` may call `set_reporter`. The
whole batch is validated before anything is written, so one invalid entry rejects the
call and leaves storage untouched.

## Storage

| Key | Value |
| --- | --- |
| `latest` (`IterableMap`) | `"{pair_id}|{source}"` -> `Snapshot` |
| `history` (`LookupMap`) | `"{pair_id}|{source}"` -> `Vec<Point>` (oldest first, capped at 48) |

`Point` drops `pair_id` and `source` because they are already in the storage key.
`get_owner`, `get_reporter` and `get_latest_count` read plain fields.

## Events

Every accepted call emits one NEP-297 style log line, where `data` holds the snapshots
recorded by that call:

```text
EVENT_JSON:{"standard":"radiri","version":"1.0.0","event":"snapshot","data":[Snapshot, ...]}
```

## Build and test

```sh
cargo test --lib                          # unit tests, no sandbox needed
cargo near build non-reproducible-wasm    # -> target/near/radiri_contract.wasm (163.9 KB)
cargo test --test sandbox                 # integration test on a local sandbox
```

The sandbox test compiles and deploys the contract locally, then checks init, reporter-only
writes, the cheapest-`ok` selection, the ring buffer, the event log and owner-only
reporter rotation. It needs network access once to fetch the `neard` sandbox binary.

## Deploy to testnet

Create the account first if needed (free testnet NEAR from the faucet):

```sh
near account create-account sponsor-by-faucet-service <name>.testnet \
  autogenerate-new-keypair save-to-keychain \
  network-config testnet create
```

Deploy and initialize. `owner` controls the reporter, `reporter` is the account the
monitor signs with:

```sh
cargo near deploy build-non-reproducible-wasm <name>.testnet \
  with-init-call new json-args \
  '{"owner":"<name>.testnet","reporter":"<reporter>.testnet"}' \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-keychain send
```

## Reporter key

The monitor only needs permission to call `record_snapshots`. Add a function-call key
for the reporter account, capped by an allowance, and print it so it can go into
`.env.local` (never commit it):

```sh
near account add-key <reporter>.testnet grant-function-call-access \
  --allowance '1 NEAR' \
  --contract-account-id <name>.testnet \
  --function-names record_snapshots \
  autogenerate-new-keypair print-to-terminal \
  network-config testnet sign-with-keychain send
```

Then in the repo root `.env.local`:

```sh
NEXT_PUBLIC_CONTRACT_ID=<name>.testnet
RADIRI_REPORTER_ACCOUNT=<reporter>.testnet
RADIRI_REPORTER_PRIVATE_KEY=ed25519:...
```

and run `pnpm monitor` to write one round of snapshots. Alice's function-call key cannot
call `set_reporter` or anything else on the contract.

## Reading snapshots

```sh
near contract call-function as-read-only <name>.testnet get_latest \
  json-args '{"pair_id":"USDC:near>USDT:near","source":null}' \
  network-config testnet now
```

or `GET /api/snapshots` on the web app.
