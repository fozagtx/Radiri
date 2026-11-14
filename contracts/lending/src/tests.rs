//! Unit tests for the lending contract (mocked blockchain). Numbers are exact: every scenario runs
//! at fixed timestamps so interest is either zero or a known one-year accrual.
use super::*;
use crate::interest::InterestModel;
use crate::liquidation::{liquidation_quote, LiquidationInput};
use crate::math::WAD;
use crate::oracle::PriceInput;
use crate::registry::{AssetCategory, AssetConfig, MAX_ASSETS};
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::storage_management::StorageManagement;
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, AccountId, Gas, NearToken, PromiseOrValue, PromiseResult};

const T0: u64 = 1_700_000_000_000;
const YEAR_MS: u64 = 31_536_000_000;

const PEPE_PRICE: u128 = 4_400_000_000_000; // $0.0000044
const WIF_PRICE: u128 = 2 * WAD; // $2
const AAPL_PRICE: u128 = 200 * WAD; // $200
const WIF: u128 = 1_000_000; // 1 whole tWIF (6 decimals)
const AAPL: u128 = 100_000_000; // 1 whole tAAPL (8 decimals)
const PEPE: u128 = WAD; // 1 whole tPEPE (18 decimals)

fn id(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn lending() -> AccountId {
    id("lending.radiri.testnet")
}
fn owner() -> AccountId {
    id("radiri.testnet")
}
fn guardian() -> AccountId {
    id("guardian.radiri.testnet")
}
fn reporter() -> AccountId {
    id("oracle.radiri.testnet")
}
fn alice() -> AccountId {
    id("alice.testnet")
}
fn bob() -> AccountId {
    id("bob.testnet")
}
fn carol() -> AccountId {
    id("carol.testnet")
}
fn stranger() -> AccountId {
    id("mallory.testnet")
}
fn pepe() -> AccountId {
    id("tpepe.radiri.testnet")
}
fn wif() -> AccountId {
    id("twif.radiri.testnet")
}
fn aapl() -> AccountId {
    id("taapl.radiri.testnet")
}

fn ctx_full(predecessor: AccountId, deposit: u128, ts_ms: u64, gas_tgas: u64, results: Vec<PromiseResult>) {
    let c = VMContextBuilder::new()
        .current_account_id(lending())
        .predecessor_account_id(predecessor.clone())
        .signer_account_id(predecessor)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(ts_ms * 1_000_000)
        .block_height(ts_ms / 1000)
        .prepaid_gas(Gas::from_tgas(gas_tgas))
        .build();
    testing_env!(c, near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), results);
}

fn ctx(predecessor: AccountId, deposit: u128, ts_ms: u64) {
    ctx_full(predecessor, deposit, ts_ms, 300, vec![]);
}

fn callback_ctx(ok: bool, ts_ms: u64) {
    let r = if ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed };
    ctx_full(lending(), 0, ts_ms, 300, vec![r]);
}

fn meme_cfg(token: AccountId, symbol: &str, decimals: u8) -> AssetConfig {
    AssetConfig {
        token_id: token,
        symbol: symbol.into(),
        decimals,
        category: AssetCategory::Meme,
        can_collateralize: true,
        can_borrow: true,
        ltv_bps: 2500,
        liquidation_threshold_bps: 4000,
        liquidation_bonus_bps: 1500,
        reserve_factor_bps: 2000,
        collateral_cap: U128(0),
        borrow_cap: U128(0),
        interest: InterestModel { base_bps: 200, slope1_bps: 1200, slope2_bps: 30000, optimal_utilization_bps: 6000 },
        max_price_age_sec: 300,
        max_price_change_bps: 5000,
        paused: false,
    }
}

fn stock_cfg(token: AccountId, symbol: &str) -> AssetConfig {
    AssetConfig {
        token_id: token,
        symbol: symbol.into(),
        decimals: 8,
        category: AssetCategory::Stock,
        can_collateralize: true,
        can_borrow: true,
        ltv_bps: 5000,
        liquidation_threshold_bps: 6500,
        liquidation_bonus_bps: 800,
        reserve_factor_bps: 1500,
        collateral_cap: U128(0),
        borrow_cap: U128(0),
        interest: InterestModel { base_bps: 100, slope1_bps: 800, slope2_bps: 20000, optimal_utilization_bps: 7000 },
        max_price_age_sec: 900,
        max_price_change_bps: 2000,
        paused: false,
    }
}

fn report(c: &mut Contract, ts: u64, prices: &[(AccountId, u128)]) -> u32 {
    ctx(reporter(), 0, ts);
    c.report_prices(prices.iter().map(|(t, p)| PriceInput { token_id: t.clone(), price_wad: U128(*p) }).collect())
}

fn report_all(c: &mut Contract, ts: u64) {
    assert_eq!(report(c, ts, &[(pepe(), PEPE_PRICE), (wif(), WIF_PRICE), (aapl(), AAPL_PRICE)]), 3);
}

fn register(c: &mut Contract, who: AccountId, ts: u64) {
    ctx(who, STORAGE_DEPOSIT.as_yoctonear(), ts);
    c.storage_deposit(None, None);
}

fn setup() -> Contract {
    ctx(owner(), 0, T0);
    let mut c = Contract::new(owner(), guardian(), vec![reporter()]);
    ctx(owner(), 1, T0);
    c.register_asset(meme_cfg(pepe(), "tPEPE", 18));
    c.register_asset(meme_cfg(wif(), "tWIF", 6));
    c.register_asset(stock_cfg(aapl(), "tAAPL"));
    report_all(&mut c, T0);
    for who in [alice(), bob(), carol()] {
        register(&mut c, who, T0);
    }
    c
}

fn ft_in(c: &mut Contract, token: AccountId, sender: AccountId, amount: u128, msg: Value, ts: u64) -> u128 {
    ctx(token, 0, ts);
    match c.ft_on_transfer(sender, U128(amount), msg.to_string()) {
        PromiseOrValue::Value(v) => v.0,
        PromiseOrValue::Promise(_) => panic!("ft_on_transfer must return a value"),
    }
}

fn deposit(c: &mut Contract, who: AccountId, token: AccountId, amount: u128, ts: u64) {
    assert_eq!(ft_in(c, token, who, amount, json!({ "action": "deposit_collateral" }), ts), 0);
}

fn supply(c: &mut Contract, who: AccountId, token: AccountId, amount: u128, ts: u64) {
    assert_eq!(ft_in(c, token, who, amount, json!({ "action": "supply" }), ts), 0);
}

fn repay(c: &mut Contract, who: AccountId, token: AccountId, amount: u128, ts: u64) -> u128 {
    ft_in(c, token, who, amount, json!({ "action": "repay" }), ts)
}

fn liquidate(
    c: &mut Contract,
    liquidator: AccountId,
    debt_token: AccountId,
    amount: u128,
    borrower: AccountId,
    collateral_token: AccountId,
    ts: u64,
) -> u128 {
    let msg = json!({ "action": "liquidate", "borrower_id": borrower, "collateral_token_id": collateral_token });
    ft_in(c, debt_token, liquidator, amount, msg, ts)
}

/// Borrow and confirm the transfer (callback success).
fn borrow_ok(c: &mut Contract, who: AccountId, token: AccountId, amount: u128, ts: u64) {
    ctx(who.clone(), 1, ts);
    c.borrow(token.clone(), U128(amount)).detach();
    callback_ctx(true, ts);
    let scaled = crate::interest::scaled_for_borrow(amount, c.asset_state(&token).borrow_index);
    assert!(c.on_borrow_transfer(who, token, U128(amount), U128(scaled)));
}

fn expect_panic<F: FnOnce()>(f: F, msg: &str) {
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
    let err = r.err().unwrap_or_else(|| panic!("expected a panic containing {msg:?}"));
    let s = err
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| err.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap_or_default();
    assert!(s.contains(msg), "panic {s:?} does not contain {msg:?}");
}

fn events(name: &str) -> Vec<Value> {
    get_logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .map(|s| serde_json::from_str::<Value>(s).unwrap())
        .filter(|e| e["event"] == name)
        .collect()
}

fn acct(c: &Contract, who: AccountId) -> AccountView {
    c.get_account(who).expect("registered")
}

fn asset(c: &Contract, token: AccountId) -> AssetView {
    c.get_asset(token).expect("registered")
}

fn debt_of(c: &Contract, who: AccountId, token: &AccountId) -> u128 {
    acct(c, who).borrowed.iter().find(|b| &b.token_id == token).map(|b| b.amount.0).unwrap_or(0)
}

fn collateral_of(c: &Contract, who: AccountId, token: &AccountId) -> u128 {
    acct(c, who).collateral.iter().find(|b| &b.token_id == token).map(|b| b.amount.0).unwrap_or(0)
}

/// carol supplies 1000 tWIF; alice posts 10 tAAPL ($2000, limit $1000, threshold $1300).
fn stock_backed(c: &mut Contract) {
    supply(c, carol(), wif(), 1000 * WIF, T0);
    deposit(c, alice(), aapl(), 10 * AAPL, T0);
}

// ---------------------------------------------------------------- init, JSON shapes

#[test]
fn init_and_config_view() {
    let c = setup();
    let cfg = c.get_config();
    assert_eq!(cfg.owner_id, owner());
    assert_eq!(cfg.guardian_id, guardian());
    assert_eq!(cfg.oracle_reporters, vec![reporter()]);
    assert!(!cfg.paused);
    assert_eq!(cfg.close_factor_bps, 5000);
    assert_eq!(
        serde_json::to_value(&cfg).unwrap(),
        json!({
            "owner_id": "radiri.testnet",
            "guardian_id": "guardian.radiri.testnet",
            "oracle_reporters": ["oracle.radiri.testnet"],
            "paused": false,
            "close_factor_bps": 5000
        })
    );
    assert_eq!(c.get_assets().len(), 3);
    assert_eq!(c.get_assets()[0].config.token_id, pepe());
}

#[test]
fn asset_config_json_round_trips_the_ts_shape() {
    let ts = json!({
        "token_id": "tpepe.radiri.testnet",
        "symbol": "tPEPE",
        "decimals": 18,
        "category": "meme",
        "can_collateralize": true,
        "can_borrow": true,
        "ltv_bps": 2500,
        "liquidation_threshold_bps": 4000,
        "liquidation_bonus_bps": 1500,
        "reserve_factor_bps": 2000,
        "collateral_cap": "500000000000000000000000000000",
        "borrow_cap": "0",
        "interest": { "base_bps": 200, "slope1_bps": 1500, "slope2_bps": 30000, "optimal_utilization_bps": 7000 },
        "max_price_age_sec": 300,
        "max_price_change_bps": 5000,
        "paused": false
    });
    let cfg: AssetConfig = serde_json::from_value(ts.clone()).unwrap();
    assert_eq!(cfg.collateral_cap.0, 500_000_000_000u128 * WAD);
    assert_eq!(serde_json::to_value(&cfg).unwrap(), ts);
    for cat in ["meme", "stock", "stable", "major"] {
        let v: AssetCategory = serde_json::from_value(json!(cat)).unwrap();
        assert_eq!(serde_json::to_value(v).unwrap(), json!(cat));
    }
    assert!(serde_json::from_value::<AssetCategory>(json!("rwa")).is_err());
}

#[test]
fn view_json_shapes_match_ts_types() {
    let mut c = setup();
    stock_backed(&mut c);
    borrow_ok(&mut c, alice(), wif(), 400 * WIF, T0);

    let av = serde_json::to_value(asset(&c, wif())).unwrap();
    let keys: Vec<&str> = av.as_object().unwrap().keys().map(|k| k.as_str()).collect();
    let mut expected = vec![
        "config", "cash", "total_borrowed", "reserves", "total_collateral", "total_supply_shares", "borrow_index",
        "utilization_bps", "borrow_apr_bps", "supply_apr_bps", "price", "price_fresh", "last_accrual_ms",
    ];
    let mut keys_sorted = keys.clone();
    keys_sorted.sort();
    expected.sort();
    assert_eq!(keys_sorted, expected);
    assert_eq!(av["cash"], json!("600000000"));
    assert_eq!(av["total_borrowed"], json!("400000000"));
    assert_eq!(av["borrow_index"], json!("1000000000000000000"));
    assert!(av["utilization_bps"].is_u64());
    assert_eq!(av["price"], json!({ "price_wad": "2000000000000000000", "timestamp_ms": T0 }));
    assert_eq!(av["last_accrual_ms"], json!(T0));

    // Never-priced asset: price is null, price_fresh false.
    ctx(owner(), 1, T0);
    c.register_asset(meme_cfg(id("tshib.radiri.testnet"), "tSHIB", 18));
    let shib = serde_json::to_value(asset(&c, id("tshib.radiri.testnet"))).unwrap();
    assert_eq!(shib["price"], Value::Null);
    assert_eq!(shib["price_fresh"], json!(false));

    let acv = serde_json::to_value(acct(&c, alice())).unwrap();
    let mut keys: Vec<&str> = acv.as_object().unwrap().keys().map(|k| k.as_str()).collect();
    keys.sort();
    let mut expected = vec![
        "account_id", "collateral", "supplied", "borrowed", "collateral_value_wad", "borrow_limit_wad",
        "liquidation_threshold_wad", "debt_value_wad", "health_factor_wad", "prices_fresh", "liquidatable",
    ];
    expected.sort();
    assert_eq!(keys, expected);
    assert_eq!(acv["collateral"], json!([{ "token_id": "taapl.radiri.testnet", "amount": "1000000000", "value_wad": "2000000000000000000000" }]));
    assert_eq!(acv["borrowed"], json!([{ "token_id": "twif.radiri.testnet", "amount": "400000000", "value_wad": "800000000000000000000" }]));
    assert_eq!(acv["health_factor_wad"], json!("1625000000000000000"));
    let carol_v = serde_json::to_value(acct(&c, carol())).unwrap();
    assert_eq!(carol_v["supplied"], json!([{ "token_id": "twif.radiri.testnet", "shares": "1000000000", "amount": "1000000000" }]));
    assert_eq!(carol_v["health_factor_wad"], Value::Null);
    assert_eq!(c.get_account(stranger()), None);

    let act = serde_json::to_value(c.get_account_activity(alice(), None, None)).unwrap();
    assert_eq!(
        act[0],
        json!({ "kind": "borrow", "token_id": "twif.radiri.testnet", "amount": "400000000", "counterparty": null, "timestamp_ms": T0, "block_height": T0 / 1000 })
    );
    assert_eq!(act[1]["kind"], json!("deposit_collateral"));
}

// ---------------------------------------------------------------- access control

#[test]
fn admin_methods_are_owner_only() {
    let mut c = setup();
    let cfg = meme_cfg(id("tshib.radiri.testnet"), "tSHIB", 18);
    ctx(stranger(), 1, T0);
    expect_panic(|| c.register_asset(cfg.clone()), "Only the owner can call register_asset");
    expect_panic(|| c.update_asset(meme_cfg(pepe(), "tPEPE", 18)), "Only the owner can call update_asset");
    expect_panic(|| c.set_oracle_reporters(vec![stranger()]), "Only the owner can call set_oracle_reporters");
    expect_panic(|| c.set_guardian(stranger()), "Only the owner can call set_guardian");
    expect_panic(|| c.force_price(pepe(), U128(1)), "Only the owner can call force_price");
    expect_panic(|| c.unpause(), "Only the owner can call unpause");
    ctx(stranger(), 0, T0);
    expect_panic(|| c.pause(), "Only the owner or the guardian can call pause");
    expect_panic(
        || {
            c.report_prices(vec![PriceInput { token_id: pepe(), price_wad: U128(1) }]);
        },
        "Only an oracle reporter can call report_prices",
    );
    // The owner is not a reporter.
    ctx(owner(), 0, T0);
    expect_panic(
        || {
            c.report_prices(vec![PriceInput { token_id: pepe(), price_wad: U128(1) }]);
        },
        "Only an oracle reporter can call report_prices",
    );
    // Owner methods need exactly 1 yoctoNEAR (full-access key).
    ctx(owner(), 0, T0);
    expect_panic(|| c.register_asset(cfg.clone()), "Requires attached deposit of exactly 1 yoctoNEAR");
    expect_panic(|| c.unpause(), "Requires attached deposit of exactly 1 yoctoNEAR");
    // The guardian can pause but not unpause or administer.
    ctx(guardian(), 0, T0);
    c.pause();
    assert!(c.get_config().paused);
    ctx(guardian(), 1, T0);
    expect_panic(|| c.unpause(), "Only the owner can call unpause");
    expect_panic(|| c.set_guardian(guardian()), "Only the owner can call set_guardian");
    // Owner rotates reporters and guardian.
    ctx(owner(), 1, T0);
    c.unpause();
    c.set_oracle_reporters(vec![bob()]);
    c.set_guardian(carol());
    assert_eq!(c.get_config().oracle_reporters, vec![bob()]);
    assert_eq!(c.get_config().guardian_id, carol());
    ctx(reporter(), 0, T0);
    expect_panic(
        || {
            c.report_prices(vec![PriceInput { token_id: pepe(), price_wad: U128(PEPE_PRICE) }]);
        },
        "Only an oracle reporter",
    );
    ctx(bob(), 0, T0);
    assert_eq!(c.report_prices(vec![PriceInput { token_id: pepe(), price_wad: U128(PEPE_PRICE) }]), 1);
    ctx(owner(), 1, T0);
    expect_panic(|| c.set_oracle_reporters(vec![bob(), bob()]), "Duplicate oracle reporter");
}

// `#[private]` on the callbacks is enforced by the generated wasm entry point, not by the Rust
// method, so it is covered by the sandbox test (tests/sandbox.rs), not here.

// ---------------------------------------------------------------- config validation

#[test]
fn config_validation_bounds() {
    let mut c = setup();
    ctx(owner(), 1, T0);
    let base = meme_cfg(id("tshib.radiri.testnet"), "tSHIB", 18);
    let cases: Vec<(Box<dyn Fn(&mut AssetConfig)>, &str)> = vec![
        (Box::new(|c| c.liquidation_threshold_bps = c.ltv_bps), "liquidation_threshold_bps must be > ltv_bps"),
        (Box::new(|c| c.ltv_bps = 4500), "liquidation_threshold_bps must be > ltv_bps"),
        (
            Box::new(|c| {
                c.ltv_bps = 9000;
                c.liquidation_threshold_bps = 10_000;
            }),
            "liquidation_threshold_bps must be < 10000",
        ),
        (Box::new(|c| c.liquidation_bonus_bps = 5001), "liquidation_bonus_bps must be at most 5000"),
        (
            Box::new(|c| {
                c.ltv_bps = 8000;
                c.liquidation_threshold_bps = 9000;
                c.liquidation_bonus_bps = 1200;
            }),
            "liquidation_threshold_bps * (10000 + liquidation_bonus_bps) must be < 10000^2",
        ),
        (Box::new(|c| c.reserve_factor_bps = 10_000), "reserve_factor_bps must be < 10000"),
        (Box::new(|c| c.interest.optimal_utilization_bps = 0), "optimal_utilization_bps must be between 1 and 9999"),
        (Box::new(|c| c.interest.optimal_utilization_bps = 10_000), "optimal_utilization_bps must be between 1 and 9999"),
        (
            Box::new(|c| {
                c.interest.slope2_bps = 65_000;
            }),
            "base_bps + slope1_bps + slope2_bps must be at most 65535",
        ),
        (Box::new(|c| c.max_price_age_sec = 0), "max_price_age_sec must be between 1 and 86400"),
        (Box::new(|c| c.max_price_age_sec = 86_401), "max_price_age_sec must be between 1 and 86400"),
        (Box::new(|c| c.max_price_change_bps = 0), "max_price_change_bps must be > 0"),
        (Box::new(|c| c.decimals = 25), "decimals must be at most 24"),
        (Box::new(|c| c.symbol = String::new()), "symbol must be 1 to 16 bytes"),
        (Box::new(|c| c.symbol = "X".repeat(17)), "symbol must be 1 to 16 bytes"),
    ];
    for (mutate, msg) in cases {
        let mut cfg = base.clone();
        mutate(&mut cfg);
        expect_panic(|| c.register_asset(cfg), msg);
    }
    // The boundary values themselves are fine.
    let mut ok = base.clone();
    ok.ltv_bps = 0;
    ok.liquidation_threshold_bps = 1;
    ok.liquidation_bonus_bps = 0;
    c.register_asset(ok);
    expect_panic(|| c.register_asset(base.clone()), "Asset is already registered");
    // update_asset: must exist, decimals fixed.
    expect_panic(|| c.update_asset(meme_cfg(id("nope.testnet"), "X", 18)), "Asset is not registered");
    expect_panic(|| c.update_asset(meme_cfg(pepe(), "tPEPE", 8)), "decimals cannot change");
    let mut upd = meme_cfg(pepe(), "tPEPE", 18);
    upd.ltv_bps = 3000;
    c.update_asset(upd);
    assert_eq!(asset(&c, pepe()).config.ltv_bps, 3000);
    assert_eq!(events("asset_updated").len(), 1);
}

#[test]
fn registry_is_capped() {
    ctx(owner(), 0, T0);
    let mut c = Contract::new(owner(), guardian(), vec![]);
    ctx(owner(), 1, T0);
    for i in 0..MAX_ASSETS {
        c.register_asset(meme_cfg(id(&format!("t{i}.radiri.testnet")), "T", 18));
    }
    expect_panic(|| c.register_asset(meme_cfg(id("t99.radiri.testnet"), "T", 18)), "Asset registry is full");
}

// ---------------------------------------------------------------- oracle

#[test]
fn deviation_guard_rejects_and_force_price_overrides() {
    let mut c = setup();
    // Exactly +50 % on a fresh price is accepted.
    assert_eq!(report(&mut c, T0 + 1_000, &[(pepe(), 6_600_000_000_000)]), 1);
    assert_eq!(c.get_price(pepe()).unwrap().price_wad.0, 6_600_000_000_000);
    assert_eq!(events("price_report")[0]["data"][0]["forced"], json!(false));
    // One wei above +50 % is rejected; the rest of the batch still applies.
    let n = report(&mut c, T0 + 2_000, &[(pepe(), 9_900_000_000_001), (wif(), WIF_PRICE)]);
    assert_eq!(n, 1);
    assert_eq!(c.get_price(pepe()).unwrap(), OraclePrice { price_wad: U128(6_600_000_000_000), timestamp_ms: T0 + 1_000 });
    assert_eq!(c.get_price(wif()).unwrap().timestamp_ms, T0 + 2_000);
    let rej = events("price_rejected");
    assert_eq!(rej[0]["data"][0]["token_id"], json!("tpepe.radiri.testnet"));
    assert_eq!(rej[0]["data"][0]["previous_price_wad"], json!("6600000000000"));
    // -50 % - 1 wei is rejected too.
    assert_eq!(report(&mut c, T0 + 3_000, &[(pepe(), 3_299_999_999_999)]), 0);
    // Once the previous price is stale, any move is accepted.
    let stale = T0 + 1_000 + 301_000;
    assert_eq!(report(&mut c, stale, &[(pepe(), 20_000_000_000_000)]), 1);
    // The owner can force past the guard.
    ctx(owner(), 1, stale);
    c.force_price(pepe(), U128(1_000_000_000_000));
    assert_eq!(c.get_price(pepe()).unwrap(), OraclePrice { price_wad: U128(1_000_000_000_000), timestamp_ms: stale });
    assert_eq!(events("price_report")[0]["data"][0]["forced"], json!(true));
    expect_panic(|| c.force_price(pepe(), U128(0)), "price_wad must be > 0");
    expect_panic(|| c.force_price(id("nope.testnet"), U128(1)), "Asset is not registered");
}

#[test]
fn report_prices_validates_the_batch() {
    let mut c = setup();
    ctx(reporter(), 0, T0);
    let p = |t: AccountId, v: u128| PriceInput { token_id: t, price_wad: U128(v) };
    expect_panic(
        || {
            c.report_prices(vec![p(pepe(), 1), p(pepe(), 1)]);
        },
        "Duplicate token in batch",
    );
    expect_panic(
        || {
            c.report_prices(vec![p(id("nope.testnet"), 1)]);
        },
        "Asset is not registered",
    );
    expect_panic(
        || {
            c.report_prices(vec![p(pepe(), 0)]);
        },
        "price_wad must be > 0",
    );
    expect_panic(
        || {
            c.report_prices(vec![]);
        },
        "prices must not be empty",
    );
    // A bad entry rejects the whole batch before any write.
    let before = c.get_price(wif()).unwrap();
    ctx(reporter(), 0, T0 + 5);
    expect_panic(
        || {
            c.report_prices(vec![p(wif(), WIF_PRICE), p(pepe(), 0)]);
        },
        "price_wad must be > 0",
    );
    assert_eq!(c.get_price(wif()).unwrap(), before);
}

#[test]
fn price_freshness_window() {
    let c = setup();
    let a = c.asset_state(&aapl());
    assert!(a.price_is_fresh(T0 + 900_000));
    assert!(!a.price_is_fresh(T0 + 900_001));
    let p = c.asset_state(&pepe());
    assert!(p.price_is_fresh(T0 + 300_000));
    assert!(!p.price_is_fresh(T0 + 300_001));
}

// ---------------------------------------------------------------- deposits and caps

#[test]
fn ft_on_transfer_guards() {
    let mut c = setup();
    // Predecessor must be a registered token.
    expect_panic(
        || {
            ft_in(&mut c, id("fake.testnet"), alice(), 1, json!({ "action": "deposit_collateral" }), T0);
        },
        "Token is not a registered asset: fake.testnet",
    );
    // Sender must be registered.
    expect_panic(
        || {
            ft_in(&mut c, aapl(), stranger(), 1, json!({ "action": "deposit_collateral" }), T0);
        },
        "is not registered; call storage_deposit first",
    );
    expect_panic(
        || {
            ft_in(&mut c, aapl(), alice(), 1, json!({ "action": "steal" }), T0);
        },
        "Invalid msg",
    );
    ctx(aapl(), 0, T0);
    expect_panic(
        || {
            let _ = c.ft_on_transfer(alice(), U128(1), "not json".into());
        },
        "Invalid msg",
    );
    // Repay without debt is refused (full refund by the token contract).
    expect_panic(
        || {
            repay(&mut c, alice(), wif(), 1, T0);
        },
        "No debt to repay in this token",
    );
    // can_collateralize = false.
    let mut cfg = meme_cfg(pepe(), "tPEPE", 18);
    cfg.can_collateralize = false;
    ctx(owner(), 1, T0);
    c.update_asset(cfg);
    expect_panic(|| deposit(&mut c, alice(), pepe(), PEPE, T0), "Asset cannot be used as collateral");
    // Supply and collateral of a normal asset work and are tracked.
    deposit(&mut c, alice(), aapl(), 3 * AAPL, T0);
    supply(&mut c, alice(), wif(), 5 * WIF, T0);
    assert_eq!(asset(&c, aapl()).total_collateral.0, 3 * AAPL);
    assert_eq!(asset(&c, wif()).cash.0, 5 * WIF);
    assert_eq!(events("supply")[0]["data"][0]["shares"], json!("5000000"));
}

#[test]
fn collateral_cap_is_enforced() {
    let mut c = setup();
    let mut cfg = stock_cfg(aapl(), "tAAPL");
    cfg.collateral_cap = U128(10 * AAPL);
    ctx(owner(), 1, T0);
    c.update_asset(cfg);
    deposit(&mut c, alice(), aapl(), 6 * AAPL, T0);
    deposit(&mut c, bob(), aapl(), 4 * AAPL, T0);
    expect_panic(|| deposit(&mut c, carol(), aapl(), 1, T0), "Collateral cap exceeded");
    assert_eq!(asset(&c, aapl()).total_collateral.0, 10 * AAPL);
}

#[test]
fn huge_pepe_collateral_values_without_overflow() {
    let mut c = setup();
    // 500 billion whole tPEPE = 5e29 base units at $0.0000044 = $2.2M.
    deposit(&mut c, alice(), pepe(), 500_000_000_000 * PEPE, T0);
    let v = acct(&c, alice());
    assert_eq!(v.collateral_value_wad.0, 2_200_000 * WAD);
    assert_eq!(v.borrow_limit_wad.0, 550_000 * WAD);
    assert_eq!(v.liquidation_threshold_wad.0, 880_000 * WAD);
}

// ---------------------------------------------------------------- borrow

#[test]
fn borrow_limit_boundary() {
    let mut c = setup();
    supply(&mut c, carol(), wif(), 10_000 * WIF, T0);
    deposit(&mut c, alice(), aapl(), 10 * AAPL, T0);
    assert_eq!(acct(&c, alice()).borrow_limit_wad.0, 1000 * WAD);
    ctx(alice(), 1, T0);
    expect_panic(|| c.borrow(wif(), U128(500 * WIF + 1)).detach(), "Borrow would exceed the borrow limit");
    borrow_ok(&mut c, alice(), wif(), 500 * WIF, T0);
    let v = acct(&c, alice());
    assert_eq!(v.debt_value_wad.0, 1000 * WAD);
    assert_eq!(v.health_factor_wad, Some(U128(1_300_000_000_000_000_000)));
    assert!(!v.liquidatable);
    ctx(alice(), 1, T0);
    expect_panic(|| c.borrow(wif(), U128(1)).detach(), "Borrow would exceed the borrow limit");
    // Cross-asset: the same limit is shared by every debt.
    ctx(alice(), 1, T0);
    expect_panic(|| c.borrow(pepe(), U128(1)).detach(), "Not enough liquidity");
}

#[test]
fn borrow_requires_liquidity_cap_flags_and_gas() {
    let mut c = setup();
    supply(&mut c, carol(), wif(), 100 * WIF, T0);
    deposit(&mut c, alice(), aapl(), 10 * AAPL, T0);
    ctx(alice(), 1, T0);
    expect_panic(|| c.borrow(wif(), U128(100 * WIF + 1)).detach(), "Not enough liquidity");
    expect_panic(|| c.borrow(wif(), U128(0)).detach(), "amount must be > 0");
    expect_panic(|| c.borrow(id("nope.testnet"), U128(1)).detach(), "Asset is not registered");
    ctx(alice(), 0, T0);
    expect_panic(|| c.borrow(wif(), U128(1)).detach(), "Requires attached deposit of exactly 1 yoctoNEAR");
    ctx_full(alice(), 1, T0, 50, vec![]);
    expect_panic(|| c.borrow(wif(), U128(1)).detach(), "Attach at least 60 Tgas");
    ctx(stranger(), 1, T0);
    expect_panic(|| c.borrow(wif(), U128(1)).detach(), "is not registered");

    // borrow_cap
    let mut cfg = meme_cfg(wif(), "tWIF", 6);
    cfg.borrow_cap = U128(50 * WIF);
    ctx(owner(), 1, T0);
    c.update_asset(cfg.clone());
    borrow_ok(&mut c, alice(), wif(), 50 * WIF, T0);
    ctx(alice(), 1, T0);
    expect_panic(|| c.borrow(wif(), U128(1)).detach(), "Borrow cap exceeded");

    // can_borrow = false
    cfg.borrow_cap = U128(0);
    cfg.can_borrow = false;
    ctx(owner(), 1, T0);
    c.update_asset(cfg);
    ctx(alice(), 1, T0);
    expect_panic(|| c.borrow(wif(), U128(1)).detach(), "Asset cannot be borrowed");
}

#[test]
fn reserves_are_not_borrowable() {
    let mut c = setup();
    stock_backed(&mut c);
    borrow_ok(&mut c, alice(), wif(), 450 * WIF, T0);
    let t1 = T0 + YEAR_MS;
    report_all(&mut c, t1);
    let a = asset(&c, wif());
    // liquidity 550 tWIF, reserves 9.9 tWIF -> cash 540.1 tWIF.
    assert_eq!(a.reserves.0, 9_900_000);
    assert_eq!(a.cash.0, 540_100_000);
    // Plenty of headroom on collateral, so only cash limits the borrow.
    deposit(&mut c, alice(), aapl(), 100 * AAPL, t1);
    ctx(alice(), 1, t1);
    expect_panic(|| c.borrow(wif(), U128(540_100_001)).detach(), "Not enough liquidity");
    borrow_ok(&mut c, alice(), wif(), 540_100_000, t1);
    assert_eq!(asset(&c, wif()).cash.0, 0);
}

// ---------------------------------------------------------------- interest

#[test]
fn interest_accrues_into_debt_supply_and_reserves() {
    let mut c = setup();
    stock_backed(&mut c);
    borrow_ok(&mut c, alice(), wif(), 450 * WIF, T0);
    let a = asset(&c, wif());
    // U = 450 / (550 + 450) = 45 %: below the 60 % kink.
    assert_eq!(a.utilization_bps, 4500);
    assert_eq!(a.borrow_apr_bps, 1100); // 200 + 1200 * 4500 / 6000
    assert_eq!(a.supply_apr_bps, 396); // 1100 * 4500 / 10000 = 495; 495 * 8000 / 10000
    assert_eq!(a.cash.0, 550 * WIF);

    let t1 = T0 + YEAR_MS;
    ctx(alice(), 0, t1);
    let a = asset(&c, wif());
    assert_eq!(a.borrow_index.0, 1_110_000_000_000_000_000);
    assert_eq!(a.total_borrowed.0, 499_500_000);
    assert_eq!(a.reserves.0, 9_900_000); // 20 % of 49.5 tWIF interest
    assert_eq!(a.cash.0, 540_100_000);
    assert_eq!(a.utilization_bps, 4804);
    assert_eq!(a.last_accrual_ms, t1);
    assert_eq!(debt_of(&c, alice(), &wif()), 499_500_000);
    assert_eq!(acct(&c, carol()).supplied[0].amount.0, 1_039_600_000);

    // Repay everything with excess; the excess is refunded.
    assert_eq!(repay(&mut c, alice(), wif(), 600 * WIF, t1), 100_500_000);
    assert!(acct(&c, alice()).borrowed.is_empty());
    let a = asset(&c, wif());
    assert_eq!(a.total_borrowed.0, 0);
    assert_eq!(a.cash.0, 1_039_600_000);
    let ev = &events("repay")[0]["data"][0];
    assert_eq!(ev["amount"], json!("499500000"));
    assert_eq!(ev["refund"], json!("100500000"));
    assert_eq!(ev["remaining_debt"], json!("0"));

    // carol withdraws everything she is owed; reserves stay in the pool.
    ctx(carol(), 1, t1);
    c.withdraw_supply(wif(), U128(1_039_600_000)).detach();
    let a = asset(&c, wif());
    assert_eq!(a.total_supply_shares.0, 0);
    assert_eq!(a.cash.0, 0);
    assert_eq!(a.reserves.0, 9_900_000);
}

#[test]
fn accrual_keeps_sub_second_remainder() {
    let mut c = setup();
    stock_backed(&mut c);
    borrow_ok(&mut c, alice(), wif(), 450 * WIF, T0);
    // A state change 1.5 s later accrues 1 s and keeps 0.5 s for the next accrual.
    supply(&mut c, bob(), wif(), WIF, T0 + 1_500);
    assert_eq!(c.asset_state(&wif()).last_accrual_ms, T0 + 1_000);
    let index_1s = c.asset_state(&wif()).borrow_index;
    assert_eq!(index_1s, crate::interest::accrue_index(WAD, 1100, 1));
    // Under a second since the last accrual: nothing changes.
    supply(&mut c, bob(), wif(), WIF, T0 + 1_999);
    assert_eq!(c.asset_state(&wif()).last_accrual_ms, T0 + 1_000);
    supply(&mut c, bob(), wif(), WIF, T0 + 2_000);
    assert_eq!(c.asset_state(&wif()).last_accrual_ms, T0 + 2_000);
}

#[test]
fn update_asset_accrues_under_old_parameters() {
    let mut c = setup();
    stock_backed(&mut c);
    borrow_ok(&mut c, alice(), wif(), 450 * WIF, T0);
    let t1 = T0 + YEAR_MS;
    let mut cfg = meme_cfg(wif(), "tWIF", 6);
    cfg.interest = InterestModel { base_bps: 0, slope1_bps: 0, slope2_bps: 0, optimal_utilization_bps: 5000 };
    ctx(owner(), 1, t1);
    c.update_asset(cfg);
    assert_eq!(c.asset_state(&wif()).borrow_index, 1_110_000_000_000_000_000);
    ctx(owner(), 0, t1 + YEAR_MS);
    assert_eq!(asset(&c, wif()).borrow_index.0, 1_110_000_000_000_000_000);
}

#[test]
fn partial_repay_and_supply_share_pricing() {
    let mut c = setup();
    stock_backed(&mut c);
    borrow_ok(&mut c, alice(), wif(), 400 * WIF, T0);
    assert_eq!(repay(&mut c, alice(), wif(), 100 * WIF, T0), 0);
    assert_eq!(debt_of(&c, alice(), &wif()), 300 * WIF);
    // After a year at U = 30 %: APR = 200 + 1200 * 3000 / 6000 = 800 bps.
    let t1 = T0 + YEAR_MS;
    supply(&mut c, bob(), wif(), 100 * WIF, t1);
    // debt 324 tWIF, interest 24, reserves 4.8, pool 700 + 324 - 4.8 = 1019.2 for 1e9 shares.
    // bob's shares: floor(100e6 * 1e9 / 1_019_200_000) = 98_116_169.
    let bob_v = acct(&c, bob());
    assert_eq!(bob_v.supplied[0].shares.0, 98_116_169);
    assert_eq!(bob_v.supplied[0].amount.0, 99_999_999); // rounded down
    assert_eq!(acct(&c, carol()).supplied[0].amount.0, 1_019_200_000);
    // Withdrawing burns shares rounded up.
    ctx(bob(), 1, t1);
    expect_panic(|| c.withdraw_supply(wif(), U128(100 * WIF)).detach(), "Not enough supply shares");
    c.withdraw_supply(wif(), U128(99_999_999)).detach();
    assert!(acct(&c, bob()).supplied.is_empty());
}

// ---------------------------------------------------------------- withdraw

#[test]
fn withdraw_collateral_respects_borrow_limit() {
    let mut c = setup();
    stock_backed(&mut c);
    borrow_ok(&mut c, alice(), wif(), 400 * WIF, T0);
    // Debt $800 needs $1600 of tAAPL at 50 % LTV = 8 tAAPL.
    ctx(alice(), 1, T0);
    c.withdraw_collateral(aapl(), U128(2 * AAPL)).detach();
    assert_eq!(collateral_of(&c, alice(), &aapl()), 8 * AAPL);
    assert_eq!(acct(&c, alice()).borrow_limit_wad.0, 800 * WAD);
    ctx(alice(), 1, T0);
    expect_panic(|| c.withdraw_collateral(aapl(), U128(1)).detach(), "Withdrawal would exceed the borrow limit");
    expect_panic(|| c.withdraw_collateral(aapl(), U128(9 * AAPL)).detach(), "Not enough collateral");
    expect_panic(|| c.withdraw_collateral(pepe(), U128(1)).detach(), "Not enough collateral");
    // Without debt, everything can go.
    deposit(&mut c, bob(), aapl(), AAPL, T0);
    ctx(bob(), 1, T0);
    c.withdraw_collateral(aapl(), U128(AAPL)).detach();
    assert!(acct(&c, bob()).collateral.is_empty());
    assert_eq!(asset(&c, aapl()).total_collateral.0, 8 * AAPL);
}

#[test]
fn withdraw_supply_is_limited_by_cash() {
    let mut c = setup();
    stock_backed(&mut c);
    borrow_ok(&mut c, alice(), wif(), 400 * WIF, T0);
    ctx(carol(), 1, T0);
    expect_panic(|| c.withdraw_supply(wif(), U128(600 * WIF + 1)).detach(), "Not enough cash in the pool");
    c.withdraw_supply(wif(), U128(600 * WIF)).detach();
    assert_eq!(asset(&c, wif()).cash.0, 0);
    assert_eq!(acct(&c, carol()).supplied[0].shares.0, 400 * WIF);
}

// ---------------------------------------------------------------- stale prices

#[test]
fn stale_prices_block_borrow() {
    let mut c = setup();
    stock_backed(&mut c);
    let t = T0 + 901_000; // tAAPL (900 s) is stale, tWIF re-reported
    assert_eq!(report(&mut c, t, &[(wif(), WIF_PRICE)]), 1);
    ctx(alice(), 1, t);
    expect_panic(|| c.borrow(wif(), U128(WIF)).detach(), "Borrow requires fresh prices for every asset of the account");
    assert!(!acct(&c, alice()).prices_fresh);
    // The borrowed asset itself must be fresh too.
    let t2 = t + 301_000; // tWIF stale, tAAPL re-reported
    assert_eq!(report(&mut c, t2, &[(aapl(), AAPL_PRICE)]), 1);
    ctx(alice(), 1, t2);
    expect_panic(|| c.borrow(wif(), U128(WIF)).detach(), "Borrow requires fresh prices");
    report_all(&mut c, t2);
    borrow_ok(&mut c, alice(), wif(), WIF, t2);
}

#[test]
fn stale_prices_block_withdrawal_only_with_debt() {
    let mut c = setup();
    stock_backed(&mut c);
    borrow_ok(&mut c, alice(), wif(), 100 * WIF, T0);
    deposit(&mut c, bob(), aapl(), AAPL, T0);
    let t = T0 + 901_000;
    report(&mut c, t, &[(wif(), WIF_PRICE)]);
    ctx(alice(), 1, t);
    expect_panic(
        || c.withdraw_collateral(aapl(), U128(AAPL)).detach(),
        "Withdrawal with debt requires fresh prices for every asset of the account",
    );
    ctx(bob(), 1, t);
    c.withdraw_collateral(aapl(), U128(AAPL)).detach();
}

#[test]
fn stale_prices_block_liquidation() {
    let mut c = setup();
    stock_backed(&mut c);
    borrow_ok(&mut c, alice(), wif(), 400 * WIF, T0);
    ctx(owner(), 1, T0);
    c.force_price(aapl(), U128(100 * WAD));
    assert!(c.is_liquidatable(alice()));
    let t = T0 + 301_000; // tWIF (300 s) stale
    ctx(bob(), 0, t);
    assert!(!c.is_liquidatable(alice()));
    let v = acct(&c, alice());
    assert!(!v.prices_fresh);
    assert!(!v.liquidatable);
    expect_panic(
        || {
            liquidate(&mut c, bob(), wif(), 100 * WIF, alice(), aapl(), t);
        },
        "Liquidation requires fresh prices for every asset of the borrower",
    );
}

// ---------------------------------------------------------------- pause

#[test]
fn global_pause_blocks_entries_and_exits_but_not_repay_or_liquidation() {
    let mut c = setup();
    stock_backed(&mut c);
    borrow_ok(&mut c, alice(), wif(), 400 * WIF, T0);
    ctx(owner(), 1, T0);
    c.force_price(aapl(), U128(100 * WAD));
    ctx(guardian(), 0, T0);
    c.pause();
    assert_eq!(events("paused").len(), 1);

    expect_panic(|| deposit(&mut c, bob(), aapl(), AAPL, T0), "Protocol is paused");
    expect_panic(|| supply(&mut c, bob(), wif(), WIF, T0), "Protocol is paused");
    ctx(carol(), 1, T0);
    expect_panic(|| c.withdraw_supply(wif(), U128(WIF)).detach(), "Protocol is paused");
    ctx(alice(), 1, T0);
    expect_panic(|| c.borrow(wif(), U128(1)).detach(), "Protocol is paused");
    expect_panic(|| c.withdraw_collateral(aapl(), U128(1)).detach(), "Protocol is paused");

    assert_eq!(repay(&mut c, alice(), wif(), 10 * WIF, T0), 0);
    assert_eq!(debt_of(&c, alice(), &wif()), 390 * WIF);
    let refund = liquidate(&mut c, bob(), wif(), 50 * WIF, alice(), aapl(), T0);
    assert_eq!(refund, 0);
    // Prices keep flowing while paused.
    assert_eq!(report(&mut c, T0 + 1, &[(pepe(), PEPE_PRICE)]), 1);

    ctx(owner(), 1, T0);
    c.unpause();
    assert_eq!(events("unpaused").len(), 1);
    deposit(&mut c, bob(), aapl(), AAPL, T0);
}

#[test]
fn asset_pause_blocks_new_positions_in_that_asset_only() {
    let mut c = setup();
    stock_backed(&mut c);
    supply(&mut c, carol(), aapl(), 5 * AAPL, T0);
    borrow_ok(&mut c, alice(), wif(), 100 * WIF, T0);
    let mut cfg = stock_cfg(aapl(), "tAAPL");
    cfg.paused = true;
    ctx(owner(), 1, T0);
    c.update_asset(cfg);
    let mut wcfg = meme_cfg(wif(), "tWIF", 6);
    wcfg.paused = true;
    c.update_asset(wcfg);

    expect_panic(|| deposit(&mut c, alice(), aapl(), AAPL, T0), "Asset is paused");
    expect_panic(|| supply(&mut c, bob(), aapl(), AAPL, T0), "Asset is paused");
    ctx(alice(), 1, T0);
    expect_panic(|| c.borrow(aapl(), U128(1)).detach(), "Asset is paused");
    expect_panic(|| c.borrow(wif(), U128(1)).detach(), "Asset is paused");
    // Exits and repay of a paused asset stay open.
    c.withdraw_collateral(aapl(), U128(AAPL)).detach();
    ctx(carol(), 1, T0);
    c.withdraw_supply(aapl(), U128(AAPL)).detach();
    assert_eq!(repay(&mut c, alice(), wif(), 100 * WIF, T0), 0);
    // Other assets are unaffected.
    deposit(&mut c, alice(), pepe(), PEPE, T0);
}

// ---------------------------------------------------------------- liquidation

#[test]
fn liquidation_quote_math() {
    // Normal: close factor caps repay at 50 % of 400 tWIF.
    let q = liquidation_quote(&LiquidationInput {
        debt_amount: 400 * WIF,
        transferred_amount: 300 * WIF,
        debt_price_wad: WIF_PRICE,
        debt_decimals: 6,
        collateral_price_wad: 100 * WAD,
        collateral_decimals: 8,
        liquidation_bonus_bps: 800,
        borrower_collateral: 10 * AAPL,
        close_factor_bps: 5000,
    });
    assert_eq!(q.max_repay, 200 * WIF);
    assert_eq!(q.repay, 200 * WIF);
    assert_eq!(q.seize_value_wad, 432 * WAD);
    assert_eq!(q.seize_amount, 432_000_000);
    assert_eq!(q.refund, 100 * WIF);
    assert!(!q.capped);
    // Transfer below max repay: everything is used.
    let q2 = liquidation_quote(&LiquidationInput { transferred_amount: 50 * WIF, ..LiquidationInput {
        debt_amount: 400 * WIF,
        transferred_amount: 0,
        debt_price_wad: WIF_PRICE,
        debt_decimals: 6,
        collateral_price_wad: 100 * WAD,
        collateral_decimals: 8,
        liquidation_bonus_bps: 800,
        borrower_collateral: 10 * AAPL,
        close_factor_bps: 5000,
    } });
    assert_eq!((q2.repay, q2.refund, q2.seize_amount), (50 * WIF, 0, 108_000_000));
    // Capped: seize would be 10.8 tAAPL but only 10 exist.
    let q3 = liquidation_quote(&LiquidationInput {
        debt_amount: 400 * WIF,
        transferred_amount: 300 * WIF,
        debt_price_wad: WIF_PRICE,
        debt_decimals: 6,
        collateral_price_wad: 40 * WAD,
        collateral_decimals: 8,
        liquidation_bonus_bps: 800,
        borrower_collateral: 10 * AAPL,
        close_factor_bps: 5000,
    });
    assert!(q3.capped);
    assert_eq!(q3.seize_amount, 10 * AAPL);
    assert_eq!(q3.repay, 185_185_186); // ceil(200e6 * 1e9 / 1.08e9)
    assert_eq!(q3.refund, 114_814_814);
}

#[test]
fn liquidation_normal_path() {
    let mut c = setup();
    stock_backed(&mut c);
    borrow_ok(&mut c, alice(), wif(), 400 * WIF, T0);
    expect_panic(
        || {
            liquidate(&mut c, bob(), wif(), 300 * WIF, alice(), aapl(), T0);
        },
        "Borrower is not liquidatable",
    );
    ctx(owner(), 1, T0);
    c.force_price(aapl(), U128(100 * WAD)); // collateral $1000, threshold $650 < debt $800
    let v = acct(&c, alice());
    assert!(v.liquidatable);
    assert_eq!(v.health_factor_wad, Some(U128(812_500_000_000_000_000)));

    expect_panic(
        || {
            liquidate(&mut c, alice(), wif(), 300 * WIF, alice(), aapl(), T0);
        },
        "Self-liquidation is not allowed",
    );
    expect_panic(
        || {
            liquidate(&mut c, stranger(), wif(), 300 * WIF, alice(), aapl(), T0);
        },
        "is not registered",
    );
    expect_panic(
        || {
            liquidate(&mut c, bob(), wif(), 300 * WIF, alice(), pepe(), T0);
        },
        "Borrower has no collateral in this token",
    );
    expect_panic(
        || {
            liquidate(&mut c, bob(), pepe(), 300 * PEPE, alice(), aapl(), T0);
        },
        "Borrower has no debt in this token",
    );

    let refund = liquidate(&mut c, bob(), wif(), 300 * WIF, alice(), aapl(), T0);
    assert_eq!(refund, 100 * WIF);
    let ev = &events("liquidate")[0]["data"][0];
    assert_eq!(ev["repaid"], json!("200000000"));
    assert_eq!(ev["seized"], json!("432000000"));
    assert_eq!(ev["refund"], json!("100000000"));
    assert_eq!(ev["seize_capped"], json!(false));
    assert_eq!(ev["remaining_debt"], json!("200000000"));
    assert_eq!(ev["bad_debt"], json!(false));
    assert_eq!(debt_of(&c, alice(), &wif()), 200 * WIF);
    assert_eq!(collateral_of(&c, alice(), &aapl()), 568_000_000);
    assert_eq!(asset(&c, wif()).cash.0, 800 * WIF);
    assert_eq!(asset(&c, aapl()).total_collateral.0, 568_000_000);
    assert_eq!(c.accounts.get(&bob()).unwrap().pending_transfers, 1);

    let a_act = c.get_account_activity(alice(), None, Some(1));
    assert_eq!(a_act[0].kind, ActivityKind::Liquidated);
    assert_eq!(a_act[0].token_id, aapl());
    assert_eq!(a_act[0].amount.0, 432_000_000);
    assert_eq!(a_act[0].counterparty, Some(bob()));
    let b_act = c.get_account_activity(bob(), None, Some(1));
    assert_eq!(b_act[0].kind, ActivityKind::Liquidate);
    assert_eq!(b_act[0].token_id, wif());
    assert_eq!(b_act[0].amount.0, 200 * WIF);
    assert_eq!(b_act[0].counterparty, Some(alice()));

    // Seized collateral arrives: pending cleared.
    callback_ctx(true, T0);
    assert!(c.on_seize_transfer(bob(), aapl(), U128(432_000_000)));
    assert_eq!(c.accounts.get(&bob()).unwrap().pending_transfers, 0);
    assert!(acct(&c, bob()).collateral.is_empty());
}

#[test]
fn liquidation_seize_capped_keeps_bad_debt_recorded() {
    let mut c = setup();
    stock_backed(&mut c);
    borrow_ok(&mut c, alice(), wif(), 400 * WIF, T0);
    ctx(owner(), 1, T0);
    c.force_price(aapl(), U128(40 * WAD)); // collateral $400 < debt $800
    let refund = liquidate(&mut c, bob(), wif(), 300 * WIF, alice(), aapl(), T0);
    assert_eq!(refund, 114_814_814);
    let ev = &events("liquidate")[0]["data"][0];
    assert_eq!(ev["seize_capped"], json!(true));
    assert_eq!(ev["repaid"], json!("185185186"));
    assert_eq!(ev["seized"], json!("1000000000"));
    assert_eq!(ev["collateral_exhausted"], json!(true));
    assert_eq!(ev["bad_debt"], json!(true));
    assert_eq!(ev["remaining_debt"], json!("214814814"));
    assert_eq!(ev["bad_debt_amounts"], json!([{ "token_id": "twif.radiri.testnet", "amount": "214814814" }]));
    // The debt is still on the books.
    let v = acct(&c, alice());
    assert!(v.collateral.is_empty());
    assert_eq!(debt_of(&c, alice(), &wif()), 214_814_814);
    assert_eq!(asset(&c, wif()).total_borrowed.0, 214_814_814);
    assert_eq!(asset(&c, aapl()).total_collateral.0, 0);
    // The account cannot be unregistered while debt remains.
    ctx(alice(), 1, T0);
    expect_panic(|| { c.storage_unregister(Some(true)); }, "Cannot unregister");
}

#[test]
fn failed_seize_transfer_credits_the_liquidator() {
    let mut c = setup();
    stock_backed(&mut c);
    borrow_ok(&mut c, alice(), wif(), 400 * WIF, T0);
    ctx(owner(), 1, T0);
    c.force_price(aapl(), U128(100 * WAD));
    liquidate(&mut c, bob(), wif(), 300 * WIF, alice(), aapl(), T0);
    callback_ctx(false, T0);
    assert!(!c.on_seize_transfer(bob(), aapl(), U128(432_000_000)));
    assert_eq!(collateral_of(&c, bob(), &aapl()), 432_000_000);
    assert_eq!(asset(&c, aapl()).total_collateral.0, 10 * AAPL);
    assert_eq!(c.accounts.get(&bob()).unwrap().pending_transfers, 0);
    assert_eq!(events("transfer_failed")[0]["data"][0]["action"], json!("liquidation_seize"));
    // The borrower's side is unchanged by the failed delivery.
    assert_eq!(debt_of(&c, alice(), &wif()), 200 * WIF);
    assert_eq!(collateral_of(&c, alice(), &aapl()), 568_000_000);
}

// ---------------------------------------------------------------- callbacks

#[test]
fn failed_borrow_transfer_restores_the_position() {
    let mut c = setup();
    stock_backed(&mut c);
    ctx(alice(), 1, T0);
    c.borrow(wif(), U128(400 * WIF)).detach();
    assert_eq!(debt_of(&c, alice(), &wif()), 400 * WIF);
    assert_eq!(asset(&c, wif()).cash.0, 600 * WIF);
    assert_eq!(c.accounts.get(&alice()).unwrap().pending_transfers, 1);
    // No activity until the transfer is confirmed.
    assert_eq!(c.get_account_activity(alice(), None, None).len(), 1);

    callback_ctx(false, T0);
    assert!(!c.on_borrow_transfer(alice(), wif(), U128(400 * WIF), U128(400 * WIF)));
    assert!(acct(&c, alice()).borrowed.is_empty());
    let a = asset(&c, wif());
    assert_eq!(a.cash.0, 1000 * WIF);
    assert_eq!(a.total_borrowed.0, 0);
    assert_eq!(c.accounts.get(&alice()).unwrap().pending_transfers, 0);
    assert_eq!(c.get_account_activity(alice(), None, None).len(), 1);
    let ev = &events("transfer_failed")[0]["data"][0];
    assert_eq!(ev["action"], json!("borrow"));
    assert_eq!(ev["restored"], json!(true));
}

#[test]
fn failed_withdraw_collateral_transfer_restores_collateral() {
    let mut c = setup();
    stock_backed(&mut c);
    ctx(alice(), 1, T0);
    c.withdraw_collateral(aapl(), U128(4 * AAPL)).detach();
    assert_eq!(collateral_of(&c, alice(), &aapl()), 6 * AAPL);
    callback_ctx(false, T0);
    assert!(!c.on_withdraw_collateral_transfer(alice(), aapl(), U128(4 * AAPL)));
    assert_eq!(collateral_of(&c, alice(), &aapl()), 10 * AAPL);
    assert_eq!(asset(&c, aapl()).total_collateral.0, 10 * AAPL);
    assert_eq!(c.accounts.get(&alice()).unwrap().pending_transfers, 0);
    // Success path records the activity.
    ctx(alice(), 1, T0);
    c.withdraw_collateral(aapl(), U128(AAPL)).detach();
    callback_ctx(true, T0);
    assert!(c.on_withdraw_collateral_transfer(alice(), aapl(), U128(AAPL)));
    assert_eq!(c.get_account_activity(alice(), None, Some(1))[0].kind, ActivityKind::WithdrawCollateral);
    assert_eq!(events("withdraw_collateral").len(), 1);
}

#[test]
fn failed_withdraw_supply_transfer_restores_shares() {
    let mut c = setup();
    supply(&mut c, carol(), wif(), 1000 * WIF, T0);
    ctx(carol(), 1, T0);
    c.withdraw_supply(wif(), U128(400 * WIF)).detach();
    assert_eq!(acct(&c, carol()).supplied[0].shares.0, 600 * WIF);
    assert_eq!(asset(&c, wif()).cash.0, 600 * WIF);
    callback_ctx(false, T0);
    assert!(!c.on_withdraw_supply_transfer(carol(), wif(), U128(400 * WIF), U128(400 * WIF)));
    assert_eq!(acct(&c, carol()).supplied[0].shares.0, 1000 * WIF);
    let a = asset(&c, wif());
    assert_eq!(a.cash.0, 1000 * WIF);
    assert_eq!(a.total_supply_shares.0, 1000 * WIF);
    callback_ctx(true, T0);
    ctx(carol(), 1, T0);
    c.withdraw_supply(wif(), U128(WIF)).detach();
    callback_ctx(true, T0);
    assert!(c.on_withdraw_supply_transfer(carol(), wif(), U128(WIF), U128(WIF)));
    assert_eq!(c.get_account_activity(carol(), None, Some(1))[0].kind, ActivityKind::WithdrawSupply);
}

// ---------------------------------------------------------------- storage, activity, paging

#[test]
fn storage_management_fixed_deposit() {
    let mut c = setup();
    let b = c.storage_balance_bounds();
    assert_eq!(b.min, NearToken::from_millinear(100));
    assert_eq!(b.max, Some(NearToken::from_millinear(100)));
    ctx(stranger(), STORAGE_DEPOSIT.as_yoctonear() - 1, T0);
    expect_panic(|| { c.storage_deposit(None, None); }, "less than the storage deposit of 0.1 NEAR");
    assert!(c.storage_balance_of(stranger()).is_none());
    // Registering someone else, with excess (refunded).
    ctx(alice(), STORAGE_DEPOSIT.as_yoctonear() * 2, T0);
    let bal = c.storage_deposit(Some(stranger()), Some(true));
    assert_eq!(bal.total, STORAGE_DEPOSIT);
    assert_eq!(bal.available, NearToken::from_yoctonear(0));
    assert!(c.storage_balance_of(stranger()).is_some());
    // Already registered: full refund, still registered.
    ctx(stranger(), STORAGE_DEPOSIT.as_yoctonear(), T0);
    c.storage_deposit(None, None);
    ctx(stranger(), 1, T0);
    expect_panic(|| { c.storage_withdraw(Some(NearToken::from_yoctonear(1))); }, "greater than the available");
    c.storage_withdraw(None);
    // Unregister: empty account succeeds; unknown returns false; positions block it.
    assert!(c.storage_unregister(None));
    assert_eq!(c.get_account(stranger()), None);
    assert!(!c.storage_unregister(None));
    deposit(&mut c, alice(), aapl(), AAPL, T0);
    ctx(alice(), 1, T0);
    expect_panic(|| { c.storage_unregister(Some(true)); }, "Cannot unregister an account with collateral");
    // A transfer in flight also blocks it.
    c.withdraw_collateral(aapl(), U128(AAPL)).detach();
    ctx(alice(), 1, T0);
    expect_panic(|| { c.storage_unregister(None); }, "Cannot unregister");
    callback_ctx(true, T0);
    c.on_withdraw_collateral_transfer(alice(), aapl(), U128(AAPL));
    ctx(alice(), 1, T0);
    assert!(c.storage_unregister(None));
    assert!(c.get_account_activity(alice(), None, None).is_empty());
}

#[test]
fn activity_ring_buffer_keeps_32_newest_first() {
    let mut c = setup();
    for i in 1..=40u128 {
        deposit(&mut c, alice(), aapl(), i, T0 + i as u64);
    }
    let all = c.get_account_activity(alice(), None, None);
    assert_eq!(all.len(), 32);
    assert_eq!(all[0].amount.0, 40);
    assert_eq!(all[31].amount.0, 9);
    assert_eq!(all[0].timestamp_ms, T0 + 40);
    let page = c.get_account_activity(alice(), Some(30), Some(5));
    assert_eq!(page.iter().map(|e| e.amount.0).collect::<Vec<_>>(), vec![10, 9]);
    assert_eq!(c.get_account_activity(alice(), None, Some(100)).len(), 32);
    assert!(c.get_account_activity(stranger(), None, None).is_empty());
}

#[test]
fn accounts_paged_and_liquidation_monitor_views() {
    let mut c = setup();
    stock_backed(&mut c);
    borrow_ok(&mut c, alice(), wif(), 400 * WIF, T0);
    assert_eq!(c.get_num_accounts(), 3);
    assert_eq!(c.get_accounts_paged(None, Some(2)).len(), 2);
    assert_eq!(c.get_accounts_paged(Some(2), Some(10)).len(), 1);
    assert!(c.get_accounts_paged(Some(3), None).is_empty());
    assert!(!c.is_liquidatable(alice()));
    assert!(!c.is_liquidatable(carol()));
    assert!(!c.is_liquidatable(stranger()));
    ctx(owner(), 1, T0);
    c.force_price(aapl(), U128(100 * WAD));
    let flagged: Vec<_> =
        c.get_accounts_paged(None, None).into_iter().filter(|a| a.liquidatable).map(|a| a.account_id).collect();
    assert_eq!(flagged, vec![alice()]);
    assert!(c.is_liquidatable(alice()));
}

#[test]
fn worst_case_account_fits_the_storage_deposit() {
    // 16 assets with 64-byte ids in all three books, a transfer in flight, 32 activity entries
    // with 64-byte ids and counterparties, keyed by a 64-byte account id.
    let mut c = setup();
    let who = id(&"w".repeat(64));
    let token = |i: u32| id(&format!("{}{:02}", "t".repeat(62), i));
    let mut account = Account::default();
    for i in 0..MAX_ASSETS {
        account.collateral.insert(token(i), u128::MAX);
        account.supply_shares.insert(token(i), u128::MAX);
        account.borrow_scaled.insert(token(i), u128::MAX);
    }
    account.pending_transfers = u32::MAX;
    let entries: Vec<ActivityEntry> = (0..crate::events::ACTIVITY_CAP)
        .map(|_| ActivityEntry {
            kind: ActivityKind::Liquidated,
            token_id: token(0),
            amount: U128(u128::MAX),
            counterparty: Some(who.clone()),
            timestamp_ms: u64::MAX,
            block_height: u64::MAX,
        })
        .collect();
    c.accounts.flush();
    c.activity.flush();
    let before = near_sdk::env::storage_usage();
    c.accounts.insert(who.clone(), account);
    c.activity.insert(who, entries);
    c.accounts.flush();
    c.activity.flush();
    let used = near_sdk::env::storage_usage() - before;
    let covered = STORAGE_DEPOSIT.as_yoctonear() / near_sdk::env::storage_byte_cost().as_yoctonear();
    assert!(used as u128 <= covered, "worst-case account uses {used} bytes, deposit covers {covered}");
}
