#!/usr/bin/env bash
# Deploys the Radiri lending markets to NEAR TESTNET with test tokens that have no value.
#
#   OWNER=<you>.testnet scripts/deploy-lending.sh
#
# Creates, funded by OWNER (about 30 testnet NEAR in total):
#   tpepe.$OWNER twif.$OWNER tshib.$OWNER tbrett.$OWNER taapl.$OWNER ttsla.$OWNER tnvda.$OWNER   test tokens
#   lending.$OWNER                                                                               lending contract
#   oracle.$OWNER                                                                                price reporter
# then registers every asset from contracts/lending/assets.testnet.json, seeds each pool with
# test liquidity supplied by OWNER, and adds a function-call key on oracle.$OWNER that can only
# call report_prices (allowance 1 NEAR). Every step signs a transaction with near-cli-rs keys
# from your keychain. Nothing here touches mainnet: the script refuses a non-testnet OWNER.
set -euo pipefail

OWNER="${OWNER:-radiri.testnet}"
case "$OWNER" in
  *.testnet) ;;
  *) echo "Refusing to run: OWNER must be a .testnet account (got $OWNER). This script is testnet only." >&2; exit 1 ;;
esac

LENDING="lending.$OWNER"
ORACLE="oracle.$OWNER"
NET="network-config testnet"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/contracts/lending/assets.testnet.json"
LENDING_WASM="$ROOT/contracts/target/near/radiri_lending/radiri_lending.wasm"
TOKEN_WASM="$ROOT/contracts/target/near/radiri_test_token/radiri_test_token.wasm"

command -v near >/dev/null || { echo "near-cli-rs is required: https://github.com/near/near-cli-rs" >&2; exit 1; }
command -v node >/dev/null || { echo "node is required to read $ASSETS" >&2; exit 1; }

echo "== build"
(cd "$ROOT/contracts/lending" && cargo near build non-reproducible-wasm --no-abi)
(cd "$ROOT/contracts/test-token" && cargo near build non-reproducible-wasm --no-abi)

create() { # account, deposit
  near account create-account fund-myself "$1" "$2" autogenerate-new-keypair save-to-keychain \
    sign-as "$OWNER" $NET sign-with-keychain send
}
call() { # contract, method, json, deposit, signer
  near contract call-function as-transaction "$1" "$2" json-args "$3" \
    prepaid-gas '300.0 Tgas' attached-deposit "$4" sign-as "$5" $NET sign-with-keychain send
}
asset_field() { # index, field
  node -e "const a=require('$ASSETS')[$1]; process.stdout.write(String(a['$2']))"
}
asset_json() { # index -> AssetConfig with token ids rewritten to this OWNER
  node -e "const a=require('$ASSETS')[$1]; a.token_id=a.symbol.toLowerCase()+'.$OWNER'; process.stdout.write(JSON.stringify({config:a}))"
}
COUNT=$(node -e "process.stdout.write(String(require('$ASSETS').length))")

echo "== test tokens"
for i in $(seq 0 $((COUNT - 1))); do
  SYMBOL=$(asset_field "$i" symbol)
  DECIMALS=$(asset_field "$i" decimals)
  TOKEN="$(echo "$SYMBOL" | tr '[:upper:]' '[:lower:]').$OWNER"
  create "$TOKEN" '3 NEAR'
  near contract deploy "$TOKEN" use-file "$TOKEN_WASM" with-init-call new \
    json-args "{\"owner_id\":\"$OWNER\",\"name\":\"Radiri Test ${SYMBOL#t} (no value)\",\"symbol\":\"$SYMBOL\",\"decimals\":$DECIMALS}" \
    prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' $NET sign-with-keychain send
done

echo "== lending contract"
create "$LENDING" '5 NEAR'
near contract deploy "$LENDING" use-file "$LENDING_WASM" with-init-call new \
  json-args "{\"owner_id\":\"$OWNER\",\"guardian_id\":\"$OWNER\",\"oracle_reporters\":[\"$ORACLE\"]}" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' $NET sign-with-keychain send

echo "== register assets, storage, seed liquidity"
call "$LENDING" storage_deposit "{\"account_id\":\"$OWNER\"}" '0.1 NEAR' "$OWNER"
for i in $(seq 0 $((COUNT - 1))); do
  SYMBOL=$(asset_field "$i" symbol)
  DECIMALS=$(asset_field "$i" decimals)
  TOKEN="$(echo "$SYMBOL" | tr '[:upper:]' '[:lower:]').$OWNER"
  call "$LENDING" register_asset "$(asset_json "$i")" '0 NEAR' "$OWNER"
  call "$TOKEN" storage_deposit "{\"account_id\":\"$LENDING\"}" '0.00125 NEAR' "$OWNER"
  # Pool liquidity: 1% of the collateral cap (test tokens only), minted to OWNER and supplied.
  SEED=$(node -e "const a=require('$ASSETS')[$i]; process.stdout.write((BigInt(a.collateral_cap)/100n).toString())")
  call "$TOKEN" mint "{\"account_id\":\"$OWNER\",\"amount\":\"$SEED\"}" '0.00125 NEAR' "$OWNER"
  call "$TOKEN" ft_transfer_call "{\"receiver_id\":\"$LENDING\",\"amount\":\"$SEED\",\"msg\":\"{\\\"action\\\":\\\"supply\\\"}\"}" '1 yoctoNEAR' "$OWNER"
done

echo "== oracle reporter (function-call key limited to report_prices)"
create "$ORACLE" '2 NEAR'
near account add-key "$ORACLE" grant-function-call-access \
  --allowance '1 NEAR' --contract-account-id "$LENDING" --function-names report_prices \
  autogenerate-new-keypair print-to-terminal $NET sign-with-keychain send

cat <<EOF

Done. Put this in .env.local (and the Vercel project), then push the first prices:
  NEXT_PUBLIC_NEAR_NETWORK=testnet
  NEXT_PUBLIC_LENDING_CONTRACT_ID=$LENDING
  NEXT_PUBLIC_TEST_TOKEN_SUFFIX=$OWNER
  RADIRI_ORACLE_ACCOUNT=$ORACLE
  RADIRI_ORACLE_PRIVATE_KEY=<the ed25519 key printed above>

  pnpm oracle:push    # reports live 1Click prices for every asset; repeat every minute
EOF
