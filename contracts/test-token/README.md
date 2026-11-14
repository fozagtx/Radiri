# radiri-test-token

**Testnet only. No value.** A NEP-141 / NEP-145 / NEP-148 token (near-contract-standards 5.30.1)
used to stand in for meme coins and tokenized stocks on NEAR testnet, where the real assets do
not exist.

- `new(owner_id, name, symbol, decimals)` refuses to initialise unless the account ends in
  `.testnet` (or `.test.near` in a sandbox), and the name must contain `(no value)`.
- `mint(account_id, amount)` is a public faucet, at most 10,000,000,000 whole tokens per call.
  An unregistered account needs 0.00125 NEAR attached to be registered; any excess is refunded.
- `max_mint()` returns the per-call cap in base units.

The Radiri UI labels every one of these tokens "test token", and the lending oracle prices each
one at its real reference asset (tPEPE at PEPE, tAAPL at AAPLon, ...) so positions behave like
the real market.

```sh
cargo test --lib                                   # 9 unit tests
cargo near build non-reproducible-wasm --no-abi    # -> ../target/near/radiri_test_token/radiri_test_token.wasm
```
