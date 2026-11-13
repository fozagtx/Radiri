# Radiri handoff

Written 2026-11-13 ~17:20 UTC. **Submission deadline: 2026-11-14T23:59:00Z.** Rules: `HACKATHON.md`. Design: `docs/ARCHITECTURE.md`.

## State: app and contract are complete, nothing is committed yet

`git status` still shows every path untracked. Nothing has been committed. That is the
first thing to do on resume.

Verified green at handoff:

```sh
pnpm exec tsc --noEmit   # clean
pnpm lint                # clean
pnpm build               # clean, 5 dynamic API routes
cd contract && cargo test --lib          # 17 passed
cd contract && cargo test --test sandbox # 1 passed
cd contract && cargo near build non-reproducible-wasm  # target/near/radiri_contract.wasm
```

## What exists now

| Path | What |
| --- | --- |
| `contract/` | Registry contract, tested. Interface and commands: `contract/README.md` |
| `src/lib/radiri/` | `catalog.ts` (1Click token cache), `adapters/oneclick.ts`, `adapters/rhea.ts`, `engine.ts`, `opportunities.ts`, `ai.ts`, `types.ts` (frozen contract) |
| `src/app/api/` | `stables`, `compare`, `matrix`, `analyst`, `snapshots` (all request-time dynamic via `connection()`) |
| `src/components/radiri/` | Dashboard: route form, gap hero, route cards, comparison table, matrix, opportunities, analyst, snapshot history |
| `scripts/monitor.ts` | Quotes 5 pairs, batches `record_snapshots` as the reporter. Exits with the missing var list rather than submitting. |
| `contract/README.md` | Written at handoff: interface, storage, events, deploy, reporter function-call key |
| `README.md` | Rewritten for judges: problem, do-X-see-Y, NEAR role, trust model, env table |

No mock data anywhere. Failing sources show their verbatim reason.

## Corrected fact: the liquidity gap is size-dependent

The earlier note "1Click has no liquidity for USDC/near to USDT/near" is only true above a
size threshold. Measured live on 2026-11-13:

| Size | 1Click | Rhea |
| --- | --- | --- |
| 10,000 | 10,004 USDT (-4.1 bps) | 9,988 USDT (11.9 bps), divergence ~16 bps |
| 100,000 | **"No liquidity available"** | 99,831 USDT (16.8 bps), fills the gap |
| 1,000,000 | "No liquidity available" | 456,333 USDT (5,436 bps), both fail at size |

The UI defaults to 100,000 so the gap is visible on load. `USDC:sol` to `USDT:sol` at 1M
returns no route from either source. The README documents all three sizes as reproducible
steps. Quotes move, so re-check before recording the demo.

## Fixed during this session

- `defaultMatrixPairs` grouped by symbol only, so the matrix never asked for
  same-chain, different-symbol pairs and Rhea never appeared. Now sweeps intra-chain
  pairs plus cross-chain same-symbol pairs: 32 cells in ~6 to 16 s depending on failures.
- The 1Click adapter appended the correlation id to the user-facing failure reason, which
  dominated the headline. It now logs it server-side and keeps the verbatim message.
- Snapshot panel and comparison table repeated the same error text twice.
- `contract/tests/sandbox.rs` was still guestbook code; rewritten for the registry
  (init, reporter-only writes, cheapest-`ok` selection, ring buffer, event, owner-only
  rotation).

## Remaining steps, in order

1. **Commit.** Nothing is committed. Per the user's rules, no AI co-author trailer.
2. **Deploy the contract to testnet.** Signs a transaction, so it needs an explicit OK.
   Commands are in `contract/README.md`. Then set `NEXT_PUBLIC_CONTRACT_ID`, add the
   reporter function-call key, and run `pnpm monitor` once so the snapshot panel has rows.
3. Optional: host on Vercel, keep it up through at least 2026-11-18.
4. **User** makes the GitHub repo public before 2026-11-14T23:59:00Z. Push only with their OK.
5. **User** records a demo and posts it on X with @NEARProtocol and #NEARHackathon.
   Draft text not yet written.
6. **Submit once** via `POST https://nearhackathon.com/api/applications`. Ask for every
   field, print the payload, send only after an explicit yes. Suggested tracks: `defi`,
   `realworld`.

## Env status

`.env.local` exists and is gitignored. `NEXT_PUBLIC_CONTRACT_ID` is **empty**, so the
snapshot panel currently shows the 503 reason instead of rows. `ONECLICK_JWT` and
`INTENTS_EXPLORER_JWT` keys are present but quotes work without them (0.2% fee).
`NEARAI_API_KEY`, `RADIRI_REPORTER_ACCOUNT` and `RADIRI_REPORTER_PRIVATE_KEY` are not set,
so the analyst and monitor both report what is missing instead of guessing.

## User preferences seen

- Flat repo: Next.js at root, `contract/` beside it, no `web/` folder.
- Uses shadcn, fine with subagents, wants short direct answers.
- No commits, no pushes and no signature-requiring steps without explicit approval.
