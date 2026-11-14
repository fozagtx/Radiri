//! Kinked interest-rate model and borrow-index accrual.
//!
//! ```text
//! utilization_bps  = borrowed * 10_000 / (cash + borrowed)                (0 when both are 0)
//! borrow_apr_bps   = U <= U_opt ? base + slope1 * U / U_opt
//!                               : base + slope1 + slope2 * (U - U_opt) / (10_000 - U_opt)
//! supply_apr_bps   = borrow_apr_bps * U / 10_000 * (10_000 - reserve_factor_bps) / 10_000
//! borrow_index_new = borrow_index * (1e18 + borrow_apr_bps * 1e18 / 10_000 * dt_sec / 31_536_000) / 1e18
//! debt(account)    = ceil(scaled_debt * borrow_index / 1e18)
//! ```
//! Every division is an integer division evaluated left to right, rounded down, except the
//! debt conversions noted on each function.
use crate::math::{mul_div_ceil, mul_div_floor, BPS, SECONDS_PER_YEAR, WAD};
use near_sdk::near;

/// Kinked rate model of one asset. All values in basis points per year.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InterestModel {
    pub base_bps: u16,
    pub slope1_bps: u16,
    pub slope2_bps: u16,
    pub optimal_utilization_bps: u16,
}

/// Utilization in basis points: borrowed / (cash + borrowed), 0 when both are 0.
pub fn utilization_bps(cash: u128, borrowed: u128) -> u16 {
    let total = crate::math::add(cash, borrowed);
    if total == 0 {
        return 0;
    }
    // borrowed <= total, so the result is <= 10_000.
    mul_div_floor(borrowed, BPS, total) as u16
}

/// Borrow APR in basis points for utilization `u_bps`. Requires a validated model
/// (0 < optimal_utilization_bps < 10_000).
pub fn borrow_apr_bps(m: &InterestModel, u_bps: u16) -> u16 {
    let u = u_bps.min(10_000) as u128;
    let opt = m.optimal_utilization_bps as u128;
    let base = m.base_bps as u128;
    let s1 = m.slope1_bps as u128;
    let s2 = m.slope2_bps as u128;
    let apr = if u <= opt {
        base + s1 * u / opt
    } else {
        base + s1 + s2 * (u - opt) / (BPS - opt)
    };
    // Validation caps base + slope1 + slope2 at u16::MAX, so this never saturates.
    apr.min(u16::MAX as u128) as u16
}

/// Supply APR in basis points: the borrow APR spread over all supplied funds, minus reserves.
pub fn supply_apr_bps(borrow_apr_bps: u16, u_bps: u16, reserve_factor_bps: u16) -> u16 {
    let x = borrow_apr_bps as u128 * u_bps.min(10_000) as u128 / BPS;
    (x * (BPS - (reserve_factor_bps as u128).min(BPS)) / BPS) as u16
}

/// Index after `dt_sec` seconds at `apr_bps` (simple interest within one accrual period,
/// compounding across accruals). Rounded down.
pub fn accrue_index(borrow_index: u128, apr_bps: u16, dt_sec: u64) -> u128 {
    // apr_bps * 1e18 / 10_000 is exact (1e18 is a multiple of 1e4).
    let rate = apr_bps as u128 * WAD / BPS;
    let growth = mul_div_floor(rate, dt_sec as u128, SECONDS_PER_YEAR);
    mul_div_floor(borrow_index, crate::math::add(WAD, growth), WAD)
}

/// Token amount owed for `scaled` debt at `borrow_index`, rounded up (protocol's favour).
pub fn debt_from_scaled(scaled: u128, borrow_index: u128) -> u128 {
    mul_div_ceil(scaled, borrow_index, WAD)
}

/// Scaled debt added by borrowing `amount`, rounded up (protocol's favour).
pub fn scaled_for_borrow(amount: u128, borrow_index: u128) -> u128 {
    mul_div_ceil(amount, WAD, borrow_index)
}

/// Scaled debt removed by repaying `amount`, rounded down (protocol's favour).
pub fn scaled_for_repay(amount: u128, borrow_index: u128) -> u128 {
    mul_div_floor(amount, WAD, borrow_index)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MEME: InterestModel =
        InterestModel { base_bps: 200, slope1_bps: 1200, slope2_bps: 30000, optimal_utilization_bps: 6000 };

    #[test]
    fn utilization_edges() {
        assert_eq!(utilization_bps(0, 0), 0);
        assert_eq!(utilization_bps(100, 0), 0);
        assert_eq!(utilization_bps(0, 100), 10_000);
        assert_eq!(utilization_bps(25, 75), 7_500);
        assert_eq!(utilization_bps(2, 1), 3_333);
    }

    #[test]
    fn borrow_apr_below_at_and_above_kink() {
        assert_eq!(borrow_apr_bps(&MEME, 0), 200);
        // Below: 200 + 1200 * 3000 / 6000 = 800.
        assert_eq!(borrow_apr_bps(&MEME, 3000), 800);
        // At the kink: base + slope1.
        assert_eq!(borrow_apr_bps(&MEME, 6000), 1400);
        // Above: 200 + 1200 + 30000 * 2000 / 4000 = 16400.
        assert_eq!(borrow_apr_bps(&MEME, 8000), 16_400);
        // Full utilization: base + slope1 + slope2.
        assert_eq!(borrow_apr_bps(&MEME, 10_000), 31_400);
        // Monotonic around the kink.
        assert!(borrow_apr_bps(&MEME, 5999) <= borrow_apr_bps(&MEME, 6000));
        assert!(borrow_apr_bps(&MEME, 6000) < borrow_apr_bps(&MEME, 6001));
    }

    #[test]
    fn supply_apr_and_reserve_split() {
        // 1400 * 6000 / 10000 = 840; 840 * (10000 - 2000) / 10000 = 672.
        assert_eq!(supply_apr_bps(1400, 6000, 2000), 672);
        assert_eq!(supply_apr_bps(1400, 0, 2000), 0);
        assert_eq!(supply_apr_bps(1400, 10_000, 0), 1400);
    }

    #[test]
    fn index_accrual_over_time() {
        // 10 % APR for a full year: index 1.0 -> 1.1.
        assert_eq!(accrue_index(WAD, 1000, 31_536_000), 1_100_000_000_000_000_000);
        // Zero time, zero growth.
        assert_eq!(accrue_index(WAD, 1000, 0), WAD);
        // One day at 10 %: 1e18 * (1 + 0.1/365) rounded down.
        assert_eq!(accrue_index(WAD, 1000, 86_400), 1_000_273_972_602_739_726);
        // Compounding across two half-years beats one simple year.
        let half = accrue_index(accrue_index(WAD, 1000, 15_768_000), 1000, 15_768_000);
        assert!(half > 1_100_000_000_000_000_000);
    }

    #[test]
    fn debt_grows_with_index_and_rounds_against_borrower() {
        let index = WAD;
        let scaled = scaled_for_borrow(1_000_000, index);
        assert_eq!(scaled, 1_000_000 * WAD / WAD);
        let later = accrue_index(index, 1000, 31_536_000);
        assert_eq!(debt_from_scaled(scaled, later), 1_100_000);
        // Rounding: borrowing 1 unit at index 3e18 records ceil(1/3) scaled; repaying 1 unit
        // removes floor(1/3) = 0 scaled.
        assert_eq!(scaled_for_borrow(1, 3 * WAD), 1);
        assert_eq!(scaled_for_repay(1, 3 * WAD), 0);
        assert_eq!(debt_from_scaled(1, 3 * WAD + 1), 4);
    }
}
