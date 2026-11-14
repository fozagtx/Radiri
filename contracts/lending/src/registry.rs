//! Asset registry: which tokens the protocol accepts, with their risk and rate parameters.
//!
//! An asset must be registered before it can be deposited, supplied, borrowed, priced or
//! seized. `can_collateralize` gates new collateral deposits; `can_borrow` gates new borrows.
//! Both are independent of swap eligibility (1Click catalog), which lives off-chain.
use crate::events::emit;
use crate::interest::InterestModel;
use crate::math::MAX_DECIMALS;
use crate::pool::AssetState;
use crate::{Contract, ContractExt};
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{assert_one_yocto, env, near, require, AccountId};

/// Most assets the registry accepts. Bounds per-account storage (see `storage.rs`).
pub const MAX_ASSETS: u32 = 16;
/// Upper bound for base + slope1 + slope2 (650 % APR); keeps every APR inside a u16.
pub const MAX_TOTAL_APR_BPS: u32 = u16::MAX as u32;
/// Highest liquidation bonus accepted (50 %).
pub const MAX_LIQUIDATION_BONUS_BPS: u16 = 5_000;
/// Longest price validity window accepted (1 day).
pub const MAX_PRICE_AGE_SEC: u32 = 86_400;
/// Longest symbol accepted, in bytes.
pub const MAX_SYMBOL_LEN: usize = 16;

/// Asset category. JSON: "meme" | "stock" | "stable" | "major".
#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AssetCategory {
    Meme,
    Stock,
    Stable,
    Major,
}

/// Argument of `register_asset` / `update_asset`. Matches `AssetConfig` in `src/types/protocol.ts`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct AssetConfig {
    pub token_id: AccountId,
    pub symbol: String,
    pub decimals: u8,
    pub category: AssetCategory,
    pub can_collateralize: bool,
    pub can_borrow: bool,
    pub ltv_bps: u16,
    /// Must be > ltv_bps and < 10_000.
    pub liquidation_threshold_bps: u16,
    pub liquidation_bonus_bps: u16,
    pub reserve_factor_bps: u16,
    /// Protocol-wide collateral allowed, base units. "0" = no cap.
    pub collateral_cap: U128,
    /// Protocol-wide debt allowed, base units. "0" = no cap.
    pub borrow_cap: U128,
    pub interest: InterestModel,
    pub max_price_age_sec: u32,
    /// A single report moving the price more than this (vs a fresh previous price) is rejected.
    pub max_price_change_bps: u16,
    /// Blocks new collateral, supply and borrow of this asset.
    pub paused: bool,
}

/// Validate every bound of an asset config. Panics with the first violated rule.
pub fn validate_config(c: &AssetConfig) {
    require!(
        !c.symbol.is_empty() && c.symbol.len() <= MAX_SYMBOL_LEN,
        "symbol must be 1 to 16 bytes"
    );
    require!(c.decimals <= MAX_DECIMALS, "decimals must be at most 24");
    require!(c.ltv_bps < c.liquidation_threshold_bps, "liquidation_threshold_bps must be > ltv_bps");
    require!(c.liquidation_threshold_bps < 10_000, "liquidation_threshold_bps must be < 10000");
    require!(
        c.liquidation_bonus_bps <= MAX_LIQUIDATION_BONUS_BPS,
        "liquidation_bonus_bps must be at most 5000"
    );
    // A liquidation must improve the position: threshold x (1 + bonus) < 100 %.
    require!(
        (c.liquidation_threshold_bps as u64) * (10_000 + c.liquidation_bonus_bps as u64) < 100_000_000,
        "liquidation_threshold_bps * (10000 + liquidation_bonus_bps) must be < 10000^2"
    );
    require!(c.reserve_factor_bps < 10_000, "reserve_factor_bps must be < 10000");
    let m = &c.interest;
    require!(
        m.optimal_utilization_bps > 0 && m.optimal_utilization_bps < 10_000,
        "optimal_utilization_bps must be between 1 and 9999"
    );
    require!(
        m.base_bps as u32 + m.slope1_bps as u32 + m.slope2_bps as u32 <= MAX_TOTAL_APR_BPS,
        "base_bps + slope1_bps + slope2_bps must be at most 65535"
    );
    require!(
        c.max_price_age_sec > 0 && c.max_price_age_sec <= MAX_PRICE_AGE_SEC,
        "max_price_age_sec must be between 1 and 86400"
    );
    require!(c.max_price_change_bps > 0, "max_price_change_bps must be > 0");
}

#[near]
impl Contract {
    /// Owner only, 1 yoctoNEAR. Adds a new asset with an empty pool and no price.
    #[payable]
    pub fn register_asset(&mut self, config: AssetConfig) {
        assert_one_yocto();
        self.assert_owner("register_asset");
        validate_config(&config);
        require!(!self.assets.contains_key(&config.token_id), "Asset is already registered");
        require!(self.assets.len() < MAX_ASSETS, "Asset registry is full (16 assets)");
        let now = env::block_timestamp_ms();
        emit("asset_registered", json!({ "config": &config }));
        self.assets.insert(config.token_id.clone(), AssetState::new(config, now));
    }

    /// Owner only, 1 yoctoNEAR. Replaces the config of a registered asset. Interest is accrued
    /// under the old parameters first. `token_id` selects the asset; `decimals` cannot change.
    #[payable]
    pub fn update_asset(&mut self, config: AssetConfig) {
        assert_one_yocto();
        self.assert_owner("update_asset");
        validate_config(&config);
        let mut asset = self.accrue_asset(&config.token_id);
        require!(asset.config.decimals == config.decimals, "decimals cannot change");
        emit("asset_updated", json!({ "config": &config }));
        asset.config = config;
        self.save_asset(asset);
    }
}
