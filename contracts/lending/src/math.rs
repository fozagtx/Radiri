//! Checked fixed-point arithmetic and the pure risk formulas of docs/ARCHITECTURE.md section 4.
//!
//! Every product of two protocol quantities (amount x price, value x 10^decimals, ...) goes
//! through a 256-bit intermediate, so `1e27 PEPE base units x 4.4e12 price_wad` cannot overflow.
//! Results that do not fit in a u128 panic instead of wrapping. Rounding directions:
//!   - collateral value, borrow limit, liquidation threshold: down
//!   - debt amount and debt value: up (protocol's favour)
//!   - seized collateral: down (protocol's favour); proportional repay on a capped seize: up
//!
//! The TypeScript mirror (`src/lib/risk`) must implement these functions bit for bit; the shared
//! vectors in `tests/vectors/lending-math.json` pin them.
use near_sdk::env;

mod wide {
    // Macro expansion from the `uint` crate; not linted as our code.
    #![allow(clippy::all)]
    uint::construct_uint! {
        /// 256-bit unsigned integer used only as a multiplication intermediate.
        pub struct U256(4);
    }
}
pub use wide::U256;

/// 1.0 in 18-decimal fixed point.
pub const WAD: u128 = 1_000_000_000_000_000_000;
/// 100 % in basis points.
pub const BPS: u128 = 10_000;
/// Seconds per (365-day) year, used by the interest index.
pub const SECONDS_PER_YEAR: u128 = 31_536_000;
/// Largest supported token decimals. 10^24 (NEAR's own precision) fits comfortably in a u128.
pub const MAX_DECIMALS: u8 = 24;

#[inline]
fn fail(msg: &str) -> ! {
    env::panic_str(msg)
}

pub fn add(a: u128, b: u128) -> u128 {
    a.checked_add(b).unwrap_or_else(|| fail("Math overflow: add"))
}

pub fn sub(a: u128, b: u128) -> u128 {
    a.checked_sub(b).unwrap_or_else(|| fail("Math underflow: sub"))
}

pub fn mul(a: u128, b: u128) -> u128 {
    a.checked_mul(b).unwrap_or_else(|| fail("Math overflow: mul"))
}

fn to_u128(x: U256) -> u128 {
    if x > U256::from(u128::MAX) {
        fail("Math overflow: result does not fit in u128");
    }
    x.low_u128()
}

/// floor(a * b / d) with a 256-bit intermediate.
pub fn mul_div_floor(a: u128, b: u128, d: u128) -> u128 {
    if d == 0 {
        fail("Math error: division by zero");
    }
    to_u128(U256::from(a) * U256::from(b) / U256::from(d))
}

/// ceil(a * b / d) with a 256-bit intermediate.
pub fn mul_div_ceil(a: u128, b: u128, d: u128) -> u128 {
    if d == 0 {
        fail("Math error: division by zero");
    }
    let n = U256::from(a) * U256::from(b);
    let d = U256::from(d);
    let (q, r) = n.div_mod(d);
    let q = if r.is_zero() { q } else { q + U256::one() };
    to_u128(q)
}

/// 10^decimals. Panics above `MAX_DECIMALS`.
pub fn pow10(decimals: u8) -> u128 {
    if decimals > MAX_DECIMALS {
        fail("Math error: decimals above 24");
    }
    10u128.pow(decimals as u32)
}

/// x * bps / 10_000, rounded down.
pub fn bps_floor(x: u128, bps: u128) -> u128 {
    mul_div_floor(x, bps, BPS)
}

/// `value_wad(amount, price_wad, decimals) = amount * price_wad / 10^decimals`, rounded down.
/// Used for collateral values and for the repaid-debt value of a liquidation.
pub fn value_wad(amount: u128, price_wad: u128, decimals: u8) -> u128 {
    mul_div_floor(amount, price_wad, pow10(decimals))
}

/// Same as `value_wad` but rounded up. Used for debt values (protocol's favour).
pub fn debt_value_wad(amount: u128, price_wad: u128, decimals: u8) -> u128 {
    mul_div_ceil(amount, price_wad, pow10(decimals))
}

/// Inverse of `value_wad`: token base units worth `value_wad`, rounded down.
pub fn amount_for_value(value_wad: u128, price_wad: u128, decimals: u8) -> u128 {
    if price_wad == 0 {
        fail("Math error: zero price");
    }
    mul_div_floor(value_wad, pow10(decimals), price_wad)
}

/// True when moving from `old` to `new` changes the price by more than `max_bps` of `old`.
/// Exact comparison in 256 bits: |new - old| * 10_000 > max_bps * old.
pub fn change_exceeds_bps(old: u128, new: u128, max_bps: u16) -> bool {
    let diff = old.abs_diff(new);
    U256::from(diff) * U256::from(BPS) > U256::from(max_bps) * U256::from(old)
}

/// One collateral holding priced for a position summary.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CollateralTerm {
    pub amount: u128,
    pub price_wad: u128,
    pub decimals: u8,
    pub ltv_bps: u16,
    pub liquidation_threshold_bps: u16,
}

/// One debt (already converted from scaled debt to token amount) priced for a position summary.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DebtTerm {
    pub amount: u128,
    pub price_wad: u128,
    pub decimals: u8,
}

/// Aggregate risk numbers of a position, all in USD wad.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PositionTotals {
    pub collateral_value_wad: u128,
    pub borrow_limit_wad: u128,
    pub liquidation_threshold_wad: u128,
    pub debt_value_wad: u128,
}

impl PositionTotals {
    /// `liq_threshold_wad * 1e18 / debt_wad`, rounded down; `None` without debt.
    pub fn health_factor_wad(&self) -> Option<u128> {
        health_factor_wad(self.liquidation_threshold_wad, self.debt_value_wad)
    }

    /// `debt_wad <= borrow_limit_wad`: the gate for borrow and for withdraw-with-debt.
    pub fn within_borrow_limit(&self) -> bool {
        self.debt_value_wad <= self.borrow_limit_wad
    }

    /// `debt_wad > liq_threshold_wad` (health factor < 1). Price freshness is checked separately.
    pub fn below_liquidation_threshold(&self) -> bool {
        self.debt_value_wad > self.liquidation_threshold_wad
    }
}

/// ```text
/// collateral_value_wad = Σ value_wad(c)                         (each rounded down)
/// borrow_limit_wad     = Σ value_wad(c) * ltv_bps / 10_000       (each term rounded down)
/// liq_threshold_wad    = Σ value_wad(c) * lt_bps / 10_000        (each term rounded down)
/// debt_wad             = Σ debt_value_wad(d)                    (each rounded up)
/// ```
pub fn position_totals(collateral: &[CollateralTerm], debt: &[DebtTerm]) -> PositionTotals {
    let mut t = PositionTotals::default();
    for c in collateral {
        let v = value_wad(c.amount, c.price_wad, c.decimals);
        t.collateral_value_wad = add(t.collateral_value_wad, v);
        t.borrow_limit_wad = add(t.borrow_limit_wad, bps_floor(v, c.ltv_bps as u128));
        t.liquidation_threshold_wad =
            add(t.liquidation_threshold_wad, bps_floor(v, c.liquidation_threshold_bps as u128));
    }
    for d in debt {
        t.debt_value_wad = add(t.debt_value_wad, debt_value_wad(d.amount, d.price_wad, d.decimals));
    }
    t
}

/// `liq_threshold_wad * 1e18 / debt_wad`, rounded down; `None` when `debt_wad == 0`.
pub fn health_factor_wad(liquidation_threshold_wad: u128, debt_value_wad: u128) -> Option<u128> {
    if debt_value_wad == 0 {
        None
    } else {
        Some(mul_div_floor(liquidation_threshold_wad, WAD, debt_value_wad))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mul_div_rounding() {
        assert_eq!(mul_div_floor(10, 10, 3), 33);
        assert_eq!(mul_div_ceil(10, 10, 3), 34);
        assert_eq!(mul_div_ceil(9, 10, 3), 30);
        assert_eq!(mul_div_floor(0, 10, 3), 0);
        assert_eq!(mul_div_ceil(0, 10, 3), 0);
        // 256-bit intermediate: u128::MAX * u128::MAX / u128::MAX.
        assert_eq!(mul_div_floor(u128::MAX, u128::MAX, u128::MAX), u128::MAX);
        assert_eq!(mul_div_ceil(u128::MAX, 3, 3), u128::MAX);
    }

    #[test]
    #[should_panic(expected = "result does not fit in u128")]
    fn mul_div_overflow_panics() {
        mul_div_floor(u128::MAX, 2, 1);
    }

    #[test]
    #[should_panic(expected = "division by zero")]
    fn mul_div_zero_divisor_panics() {
        mul_div_floor(1, 1, 0);
    }

    #[test]
    #[should_panic(expected = "decimals above 24")]
    fn pow10_bound() {
        pow10(25);
    }

    #[test]
    fn value_wad_decimals_18_6_8() {
        // 1 whole token at $2.50 with 18, 6 and 8 decimals.
        let p = 2_500_000_000_000_000_000u128;
        assert_eq!(value_wad(10u128.pow(18), p, 18), p);
        assert_eq!(value_wad(10u128.pow(6), p, 6), p);
        assert_eq!(value_wad(10u128.pow(8), p, 8), p);
        // Half a $WIF (6 decimals) at $1.234567.
        assert_eq!(value_wad(500_000, 1_234_567_000_000_000_000, 6), 617_283_500_000_000_000);
        // 0.5 tAAPL (8 decimals) at $231.45.
        assert_eq!(value_wad(50_000_000, 231_450_000_000_000_000_000, 8), 115_725_000_000_000_000_000);
    }

    #[test]
    fn value_wad_huge_pepe_amount_does_not_overflow() {
        // 1e9 whole PEPE (1e27 base units) at $0.0000044: amount * price = 4.4e39 > u128::MAX.
        let amount = 1_000_000_000u128 * 10u128.pow(18);
        let price = 4_400_000_000_000u128;
        assert!(amount.checked_mul(price).is_none(), "the product must overflow u128");
        assert_eq!(value_wad(amount, price, 18), 4_400u128 * WAD);
        // 500 billion whole PEPE (the protocol collateral cap) still fits.
        let cap = 500_000_000_000u128 * 10u128.pow(18);
        assert_eq!(value_wad(cap, price, 18), 2_200_000u128 * WAD);
    }

    #[test]
    fn debt_value_rounds_up_collateral_rounds_down() {
        // 1 base unit of an 18-decimal token at 1.5 wei-of-USD per whole token.
        assert_eq!(value_wad(1, 15, 1), 1);
        assert_eq!(debt_value_wad(1, 15, 1), 2);
        assert_eq!(value_wad(3, 1, 18), 0);
        assert_eq!(debt_value_wad(3, 1, 18), 1);
    }

    #[test]
    fn change_guard_is_exact() {
        // 50 % of 100 is 50: moving to 150 is allowed, to 151 is not, to 49 is not.
        assert!(!change_exceeds_bps(100, 150, 5000));
        assert!(change_exceeds_bps(100, 151, 5000));
        assert!(!change_exceeds_bps(100, 50, 5000));
        assert!(change_exceeds_bps(100, 49, 5000));
        assert!(!change_exceeds_bps(u128::MAX, u128::MAX, 1));
    }

    #[test]
    fn position_and_health() {
        let c = [CollateralTerm {
            amount: 1000 * WAD,
            price_wad: WAD,
            decimals: 18,
            ltv_bps: 5000,
            liquidation_threshold_bps: 6500,
        }];
        let d = [DebtTerm { amount: 400 * 10u128.pow(6), price_wad: WAD, decimals: 6 }];
        let t = position_totals(&c, &d);
        assert_eq!(t.collateral_value_wad, 1000 * WAD);
        assert_eq!(t.borrow_limit_wad, 500 * WAD);
        assert_eq!(t.liquidation_threshold_wad, 650 * WAD);
        assert_eq!(t.debt_value_wad, 400 * WAD);
        assert_eq!(t.health_factor_wad(), Some(1_625_000_000_000_000_000));
        assert!(t.within_borrow_limit());
        assert!(!t.below_liquidation_threshold());
        assert_eq!(health_factor_wad(1, 0), None);
    }
}
