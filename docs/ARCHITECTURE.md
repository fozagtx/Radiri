# Radiri architecture

Radiri is a cross-chain stablecoin liquidity monitor and route aggregator on NEAR.

```
                        ┌───────────────────────────── Next.js (repo root) ─────────────────────────────┐
 browser ── UI pages ──▶│ /api/stables  /api/compare  /api/matrix  /api/analyst  /api/snapshots           │
                        │        │             │             │              │              │              │
                        │        ▼             ▼             ▼              ▼              ▼              │
                        │   src/lib/radiri: catalog ─ adapters(1click, rhea) ─ engine ─ opportunities ─ ai │
                        └────────┬─────────────┬───────────────────────────────┬──────────────┬──────────┘
                                 │             │                               │              │
                       1Click API (quotes,   Rhea Smart Router         NEAR AI Cloud     NEAR RPC (view)
                       tokens; JWT optional) (NEAR-native pools)       (TEE inference)        │
                                                                                              ▼
 scripts/monitor.ts ── quotes matrix ── record_snapshots (function-call key) ──▶ contract/ (Radiri registry)
 Execution: UI hands best route to the NEAR Intents swap widget; user signs in own wallet. Dry-run default.
```

## Ownership (parallel build)

| Area | Paths | Owner |
| --- | --- | --- |
| Shared types | `src/lib/radiri/types.ts` | lead (change by agreement) |
| Contract | `contract/**` | contract agent |
| Data layer + API + monitor | `src/lib/radiri/**` (except types.ts), `src/app/api/**`, `scripts/**` | data agent |
| UI | `src/app/**` (not `api/`), `src/components/radiri/**`, `src/components/ui/**` | UI agent |

## Contract interface (Rust, `contract/src/lib.rs`)

- `new(owner: AccountId, reporter: AccountId)`
- `set_reporter(reporter: AccountId)` — owner only
- `record_snapshots(snapshots: Vec<SnapshotInput>)` — reporter only. `SnapshotInput { pair_id, source, amount_in_usd: u32, cost_bps: i32, eta_s: Option<u32>, status }`. Contract stamps `timestamp_ms`, `block_height`, emits NEP-297 event `radiri/snapshot`.
- `get_latest(pair_id) -> Option<Snapshot>`, `get_all_latest(from_index, limit) -> Vec<Snapshot>`, `get_history(pair_id, limit) -> Vec<Snapshot>` (ring buffer, 48 per pair+source), `get_reporter()`, `get_owner()`.
- Latest is keyed by `pair_id + "|" + source`.

## Env

| Var | Used by | Notes |
| --- | --- | --- |
| `ONECLICK_JWT` | server | optional; lowers fees, raises limits |
| `INTENTS_EXPLORER_JWT` | server | optional |
| `NEARAI_API_KEY` | server | AI analyst |
| `NEXT_PUBLIC_NEAR_NETWORK`, `NEXT_PUBLIC_CONTRACT_ID` | client+server | |
| `RADIRI_REPORTER_ACCOUNT`, `RADIRI_REPORTER_PRIVATE_KEY` | monitor script | function-call key limited to `record_snapshots` |

## Rules

- No mock or invented data. If a source fails, show the failure verbatim.
- Secrets never use `NEXT_PUBLIC_`, never committed.
- Quotes are always `dry: true` server-side; real execution only happens in the user's wallet.
