//! Reporter-pushed price oracle.
//!
//! Reporters push USD prices per whole token (x 1e18). The contract stamps each price with the
//! block time. A price is fresh when it exists, is > 0 and `now - timestamp <= max_price_age_sec`.
//! A report that moves a fresh price by more than `max_price_change_bps` is rejected (that entry
//! only; the rest of the batch is applied) and logged as a `price_rejected` event. The owner can
//! `force_price` past the guard. Stale prices never authorise a borrow, a withdrawal with debt or
//! a liquidation.
use crate::events::emit_raw;
use crate::math::change_exceeds_bps;
use crate::{Contract, ContractExt};
use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::{assert_one_yocto, env, near, require, AccountId};

/// Most prices accepted in one `report_prices` call.
pub const MAX_PRICE_BATCH: usize = 32;
/// Highest price accepted: $1e18 per whole token. Keeps value products far from u128 limits.
pub const MAX_PRICE_WAD: u128 = 1_000_000_000_000_000_000_000_000_000_000_000_000;

/// `OraclePrice` in `src/types/protocol.ts`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OraclePrice {
    /// USD per whole token x 1e18.
    pub price_wad: U128,
    pub timestamp_ms: u64,
}

impl OraclePrice {
    /// Fresh when > 0 and no older than `max_age_sec` at `now_ms`.
    pub fn is_fresh(&self, max_age_sec: u32, now_ms: u64) -> bool {
        self.price_wad.0 > 0 && now_ms.saturating_sub(self.timestamp_ms) <= max_age_sec as u64 * 1000
    }
}

/// One entry of `report_prices`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PriceInput {
    pub token_id: AccountId,
    pub price_wad: U128,
}

fn validate_price(price_wad: u128) {
    require!(price_wad > 0, "price_wad must be > 0");
    require!(price_wad <= MAX_PRICE_WAD, "price_wad must be at most 1e36");
}

#[near]
impl Contract {
    /// Oracle reporters only. No deposit, so a function-call access key limited to this method
    /// can sign it. Returns the number of prices accepted. Invalid input (unregistered token,
    /// zero price, duplicate token, batch too large) rejects the whole call before any write.
    pub fn report_prices(&mut self, prices: Vec<PriceInput>) -> u32 {
        let reporter = env::predecessor_account_id();
        require!(
            self.oracle_reporters.contains(&reporter),
            "Only an oracle reporter can call report_prices"
        );
        require!(!prices.is_empty(), "prices must not be empty");
        require!(prices.len() <= MAX_PRICE_BATCH, "Batch too large: max 32 prices");
        for (i, p) in prices.iter().enumerate() {
            validate_price(p.price_wad.0);
            require!(self.assets.contains_key(&p.token_id), format!("Asset is not registered: {}", p.token_id));
            require!(
                !prices[..i].iter().any(|q| q.token_id == p.token_id),
                format!("Duplicate token in batch: {}", p.token_id)
            );
        }

        let now = env::block_timestamp_ms();
        let mut accepted: Vec<Value> = Vec::new();
        let mut rejected: Vec<Value> = Vec::new();
        for p in prices {
            let mut asset = self.asset_state(&p.token_id);
            if let Some(prev) = asset.price {
                let max_change = asset.config.max_price_change_bps;
                if prev.is_fresh(asset.config.max_price_age_sec, now)
                    && change_exceeds_bps(prev.price_wad.0, p.price_wad.0, max_change)
                {
                    rejected.push(json!({
                        "token_id": p.token_id,
                        "price_wad": p.price_wad,
                        "previous_price_wad": prev.price_wad,
                        "max_price_change_bps": max_change,
                        "reporter_id": reporter,
                    }));
                    continue;
                }
            }
            asset.price = Some(OraclePrice { price_wad: p.price_wad, timestamp_ms: now });
            accepted.push(json!({
                "token_id": p.token_id,
                "price_wad": p.price_wad,
                "timestamp_ms": now,
                "forced": false,
            }));
            self.save_asset(asset);
        }
        let count = accepted.len() as u32;
        if !accepted.is_empty() {
            emit_raw("price_report", Value::Array(accepted));
        }
        if !rejected.is_empty() {
            emit_raw("price_rejected", Value::Array(rejected));
        }
        count
    }

    /// Owner only, 1 yoctoNEAR. Sets a price without the deviation guard, stamped with the
    /// block time. For recovering from a legitimate move larger than `max_price_change_bps`.
    #[payable]
    pub fn force_price(&mut self, token_id: AccountId, price_wad: U128) {
        assert_one_yocto();
        self.assert_owner("force_price");
        validate_price(price_wad.0);
        let mut asset = self.asset_state(&token_id);
        let now = env::block_timestamp_ms();
        asset.price = Some(OraclePrice { price_wad, timestamp_ms: now });
        self.save_asset(asset);
        emit_raw(
            "price_report",
            json!([{ "token_id": token_id, "price_wad": price_wad, "timestamp_ms": now, "forced": true }]),
        );
    }

    /// Latest price of an asset (fresh or not), `null` when the asset has never been priced
    /// or is not registered.
    pub fn get_price(&self, token_id: AccountId) -> Option<OraclePrice> {
        self.assets.get(&token_id).and_then(|a| a.price)
    }
}
