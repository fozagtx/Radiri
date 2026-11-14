//! Read-only views. Every view projects interest to the current block without writing it, so a
//! view and the next state-changing call agree. JSON shapes match `src/types/protocol.ts`.
use crate::events::{ActivityEntry, ACTIVITY_CAP};
use crate::oracle::OraclePrice;
use crate::pool::AssetState;
use crate::registry::AssetConfig;
use crate::vault::Account;
use crate::{Contract, ContractExt};
use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId};

/// Largest page of `get_accounts_paged`.
pub const MAX_ACCOUNTS_PAGE: u32 = 50;

/// `AssetView` in `src/types/protocol.ts`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct AssetView {
    pub config: AssetConfig,
    /// liquidity - reserves: what can be borrowed or withdrawn now.
    pub cash: U128,
    pub total_borrowed: U128,
    pub reserves: U128,
    pub total_collateral: U128,
    pub total_supply_shares: U128,
    pub borrow_index: U128,
    pub utilization_bps: u16,
    pub borrow_apr_bps: u16,
    pub supply_apr_bps: u16,
    pub price: Option<OraclePrice>,
    pub price_fresh: bool,
    pub last_accrual_ms: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct CollateralView {
    pub token_id: AccountId,
    pub amount: U128,
    pub value_wad: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SuppliedView {
    pub token_id: AccountId,
    pub shares: U128,
    /// Underlying the shares are worth now (rounded down).
    pub amount: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct BorrowedView {
    pub token_id: AccountId,
    /// Debt including accrued interest (rounded up).
    pub amount: U128,
    pub value_wad: U128,
}

/// `AccountView` in `src/types/protocol.ts`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct AccountView {
    pub account_id: AccountId,
    pub collateral: Vec<CollateralView>,
    pub supplied: Vec<SuppliedView>,
    pub borrowed: Vec<BorrowedView>,
    pub collateral_value_wad: U128,
    pub borrow_limit_wad: U128,
    pub liquidation_threshold_wad: U128,
    pub debt_value_wad: U128,
    /// liq_threshold_wad * 1e18 / debt_value_wad; null without debt.
    pub health_factor_wad: Option<U128>,
    /// Every collateral and debt asset has a fresh price.
    pub prices_fresh: bool,
    /// prices_fresh && debt_value_wad > liquidation_threshold_wad: a liquidation would be
    /// accepted now.
    pub liquidatable: bool,
}

impl Contract {
    pub(crate) fn asset_view(&self, state: &AssetState) -> AssetView {
        let now = env::block_timestamp_ms();
        let s = state.accrued(now);
        AssetView {
            cash: U128(s.cash()),
            total_borrowed: U128(s.total_borrowed()),
            reserves: U128(s.reserves),
            total_collateral: U128(s.total_collateral),
            total_supply_shares: U128(s.total_supply_shares),
            borrow_index: U128(s.borrow_index),
            utilization_bps: s.utilization_bps(),
            borrow_apr_bps: s.borrow_apr_bps(),
            supply_apr_bps: s.supply_apr_bps(),
            price: s.price,
            price_fresh: s.price_is_fresh(now),
            last_accrual_ms: s.last_accrual_ms,
            config: s.config,
        }
    }

    pub(crate) fn account_view(&self, account_id: &AccountId, account: &Account) -> AccountView {
        let now = env::block_timestamp_ms();
        let ev = self.evaluate(account);
        let supplied = account
            .supply_shares
            .iter()
            .map(|(token_id, shares)| {
                let a = self.asset_state(token_id).accrued(now);
                SuppliedView { token_id: token_id.clone(), shares: U128(*shares), amount: U128(a.amount_for_shares(*shares)) }
            })
            .collect();
        let t = ev.totals;
        AccountView {
            account_id: account_id.clone(),
            collateral: ev
                .collateral
                .into_iter()
                .map(|(token_id, amount, value)| CollateralView { token_id, amount: U128(amount), value_wad: U128(value) })
                .collect(),
            supplied,
            borrowed: ev
                .borrowed
                .into_iter()
                .map(|(token_id, amount, value)| BorrowedView { token_id, amount: U128(amount), value_wad: U128(value) })
                .collect(),
            collateral_value_wad: U128(t.collateral_value_wad),
            borrow_limit_wad: U128(t.borrow_limit_wad),
            liquidation_threshold_wad: U128(t.liquidation_threshold_wad),
            debt_value_wad: U128(t.debt_value_wad),
            health_factor_wad: t.health_factor_wad().map(U128),
            prices_fresh: ev.prices_fresh,
            liquidatable: ev.prices_fresh && t.below_liquidation_threshold(),
        }
    }
}

#[near]
impl Contract {
    /// Every registered asset, in registration order.
    pub fn get_assets(&self) -> Vec<AssetView> {
        self.assets.values().map(|s| self.asset_view(s)).collect()
    }

    pub fn get_asset(&self, token_id: AccountId) -> Option<AssetView> {
        self.assets.get(&token_id).map(|s| self.asset_view(s))
    }

    /// `null` when the account is not registered.
    pub fn get_account(&self, account_id: AccountId) -> Option<AccountView> {
        self.accounts.get(&account_id).map(|a| self.account_view(&account_id, a))
    }

    /// Newest first. `from_index` skips that many of the newest entries (default 0); `limit`
    /// defaults to and is capped at 32.
    pub fn get_account_activity(&self, account_id: AccountId, from_index: Option<u32>, limit: Option<u32>) -> Vec<ActivityEntry> {
        let from = from_index.unwrap_or(0) as usize;
        let limit = (limit.unwrap_or(ACTIVITY_CAP as u32) as usize).min(ACTIVITY_CAP);
        match self.activity.get(&account_id) {
            None => vec![],
            Some(log) => log.iter().rev().skip(from).take(limit).cloned().collect(),
        }
    }

    /// Registered accounts in registration order (unregistering moves the last account into the
    /// freed slot). `limit` defaults to 20 and is capped at 50. For the liquidation monitor.
    pub fn get_accounts_paged(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<AccountView> {
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(20).min(MAX_ACCOUNTS_PAGE) as usize;
        self.accounts.iter().skip(from).take(limit).map(|(id, a)| self.account_view(id, a)).collect()
    }

    /// Number of registered accounts (for paging `get_accounts_paged`).
    pub fn get_num_accounts(&self) -> u32 {
        self.accounts.len()
    }

    /// True when a liquidation of this account would be accepted now: prices fresh and
    /// debt_value_wad > liquidation_threshold_wad. False for unknown accounts.
    pub fn is_liquidatable(&self, account_id: AccountId) -> bool {
        self.accounts.get(&account_id).is_some_and(|a| {
            if !a.has_debt() {
                return false;
            }
            let ev = self.evaluate(a);
            ev.prices_fresh && ev.totals.below_liquidation_threshold()
        })
    }
}
