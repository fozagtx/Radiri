//! Cross-language parity: the vectors in tests/vectors/lending-math.json are computed by the
//! TypeScript mirror (src/lib/risk, `pnpm gen:lending`). The contract math must return exactly the
//! same numbers, so the UI's previews and the contract's checks can never disagree.
use crate::interest::{accrue_index, borrow_apr_bps, supply_apr_bps, utilization_bps, InterestModel};
use crate::liquidation::{liquidation_quote, LiquidationInput};
use crate::math::{debt_value_wad, health_factor_wad, value_wad};
use serde_json::Value;

const VECTORS: &str = include_str!("../tests/vectors/lending-math.json");

fn u128_of(value: &Value, key: &str) -> u128 {
    value[key].as_str().unwrap_or_else(|| panic!("{key} must be a decimal string")).parse().unwrap()
}

fn small<T: TryFrom<u64>>(value: &Value, key: &str) -> T
where
    T::Error: std::fmt::Debug,
{
    T::try_from(value[key].as_u64().unwrap_or_else(|| panic!("{key} must be an integer"))).unwrap()
}

#[test]
fn contract_math_matches_typescript_vectors() {
    let vectors: Vec<Value> = serde_json::from_str(VECTORS).unwrap();
    assert!(vectors.len() >= 20, "expected the full vector set");
    for (index, vector) in vectors.iter().enumerate() {
        let (input, expected) = (&vector["input"], &vector["expected"]);
        let label = format!("vector {index} ({})", vector["fn"]);
        match vector["fn"].as_str().unwrap() {
            "value_wad" => {
                let (amount, price, decimals) = (u128_of(input, "amount"), u128_of(input, "price_wad"), small::<u8>(input, "decimals"));
                assert_eq!(value_wad(amount, price, decimals), u128_of(expected, "value_wad"), "{label}");
                assert_eq!(debt_value_wad(amount, price, decimals), u128_of(expected, "debt_value_wad"), "{label}");
            }
            "health_factor_wad" => {
                let got = health_factor_wad(u128_of(input, "liquidation_threshold_wad"), u128_of(input, "debt_value_wad"));
                let want = expected["health_factor_wad"].as_str().map(|text| text.parse::<u128>().unwrap());
                assert_eq!(got, want, "{label}");
            }
            "utilization_bps" => {
                let got = utilization_bps(u128_of(input, "cash"), u128_of(input, "borrowed"));
                assert_eq!(got, small::<u16>(expected, "utilization_bps"), "{label}");
            }
            "interest_rates" => {
                let m = &input["model"];
                let model = InterestModel {
                    base_bps: small(m, "base_bps"),
                    slope1_bps: small(m, "slope1_bps"),
                    slope2_bps: small(m, "slope2_bps"),
                    optimal_utilization_bps: small(m, "optimal_utilization_bps"),
                };
                let u: u16 = small(input, "utilization_bps");
                let apr = borrow_apr_bps(&model, u);
                assert_eq!(apr, small::<u16>(expected, "borrow_apr_bps"), "{label}");
                assert_eq!(supply_apr_bps(apr, u, small(input, "reserve_factor_bps")), small::<u16>(expected, "supply_apr_bps"), "{label}");
            }
            "accrue_index" => {
                let dt: u64 = input["dt_sec"].as_str().unwrap().parse().unwrap();
                let got = accrue_index(u128_of(input, "borrow_index"), small(input, "apr_bps"), dt);
                assert_eq!(got, u128_of(expected, "borrow_index"), "{label}");
            }
            "liquidation" => {
                let quote = liquidation_quote(&LiquidationInput {
                    debt_amount: u128_of(input, "debt_amount"),
                    transferred_amount: u128_of(input, "transferred_amount"),
                    debt_price_wad: u128_of(input, "debt_price_wad"),
                    debt_decimals: small(input, "debt_decimals"),
                    collateral_price_wad: u128_of(input, "collateral_price_wad"),
                    collateral_decimals: small(input, "collateral_decimals"),
                    liquidation_bonus_bps: small(input, "liquidation_bonus_bps"),
                    borrower_collateral: u128_of(input, "borrower_collateral"),
                    close_factor_bps: small(input, "close_factor_bps"),
                });
                assert_eq!(quote.max_repay, u128_of(expected, "max_repay"), "{label} max_repay");
                assert_eq!(quote.repay, u128_of(expected, "repay"), "{label} repay");
                assert_eq!(quote.seize_value_wad, u128_of(expected, "seize_value_wad"), "{label} seize_value_wad");
                assert_eq!(quote.seize_amount, u128_of(expected, "seize_amount"), "{label} seize_amount");
                assert_eq!(quote.refund, u128_of(expected, "refund"), "{label} refund");
                assert_eq!(quote.capped, expected["capped"].as_bool().unwrap(), "{label} capped");
            }
            other => panic!("unknown vector fn {other}"),
        }
    }
}
