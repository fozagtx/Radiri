//! Per-asset pool: supply shares, liquidity, reserves, total debt and the borrow index.
//!
//! Accounting identities (all in the asset's base units):
//! ```text
//! liquidity      = tokens the pool holds for suppliers and the protocol (collateral excluded)
//! cash           = liquidity - reserves (saturating)  -> what can be borrowed or withdrawn
//! total_borrowed = ceil(total_scaled_borrowed * borrow_index / 1e18)
//! pool_value     = liquidity + total_borrowed - reserves  -> what supply shares are worth
//! shares minted  = floor(amount * total_shares / pool_value)   (1:1 for the first supplier)
//! shares burned  = ceil(amount * total_shares / pool_value)
//! ```
//! `cash` is the value exposed as `AssetView.cash` and used by the utilization formula.
use crate::events::{emit, ActivityKind};
use crate::interest::{self, debt_from_scaled};
use crate::math::{add, mul_div_ceil, mul_div_floor, sub, BPS, WAD};
use crate::oracle::OraclePrice;
use crate::registry::AssetConfig;
use crate::{Contract, ContractExt, GAS_FOR_CALLBACK, GAS_FOR_FT_TRANSFER, MIN_GAS_FOR_OUTGOING_TRANSFER};
use near_contract_standards::fungible_token::core::ext_ft_core;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{assert_one_yocto, env, near, require, AccountId, NearToken, Promise};

/// Stored state of one registered asset.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct AssetState {
    pub config: AssetConfig,
    /// Pool tokens held by the contract (supplied + repaid - borrowed - withdrawn). Includes reserves.
    pub liquidity: u128,
    /// Protocol share of accrued interest.
    pub reserves: u128,
    pub total_scaled_borrowed: u128,
    pub total_collateral: u128,
    pub total_supply_shares: u128,
    pub borrow_index: u128,
    pub last_accrual_ms: u64,
    pub price: Option<OraclePrice>,
}

impl AssetState {
    pub fn new(config: AssetConfig, now_ms: u64) -> Self {
        Self {
            config,
            liquidity: 0,
            reserves: 0,
            total_scaled_borrowed: 0,
            total_collateral: 0,
            total_supply_shares: 0,
            borrow_index: WAD,
            last_accrual_ms: now_ms,
            price: None,
        }
    }

    /// Borrowable / withdrawable liquidity: liquidity minus reserves.
    pub fn cash(&self) -> u128 {
        self.liquidity.saturating_sub(self.reserves)
    }

    pub fn total_borrowed(&self) -> u128 {
        debt_from_scaled(self.total_scaled_borrowed, self.borrow_index)
    }

    /// What all supply shares together are worth.
    pub fn pool_value(&self) -> u128 {
        add(self.liquidity, self.total_borrowed()).saturating_sub(self.reserves)
    }

    pub fn utilization_bps(&self) -> u16 {
        interest::utilization_bps(self.cash(), self.total_borrowed())
    }

    pub fn borrow_apr_bps(&self) -> u16 {
        interest::borrow_apr_bps(&self.config.interest, self.utilization_bps())
    }

    pub fn supply_apr_bps(&self) -> u16 {
        interest::supply_apr_bps(self.borrow_apr_bps(), self.utilization_bps(), self.config.reserve_factor_bps)
    }

    /// Accrue interest up to `now_ms` in whole seconds; the sub-second remainder carries over.
    /// `interest = total_borrowed_new - total_borrowed_old`, `reserves += interest * rf / 10_000`.
    pub fn accrue(&mut self, now_ms: u64) {
        if now_ms <= self.last_accrual_ms {
            return;
        }
        let dt_sec = (now_ms - self.last_accrual_ms) / 1000;
        if dt_sec == 0 {
            return;
        }
        let apr = self.borrow_apr_bps();
        let before = self.total_borrowed();
        self.borrow_index = interest::accrue_index(self.borrow_index, apr, dt_sec);
        let interest = sub(self.total_borrowed(), before);
        self.reserves = add(
            self.reserves,
            mul_div_floor(interest, self.config.reserve_factor_bps as u128, BPS),
        );
        self.last_accrual_ms += dt_sec * 1000;
    }

    /// Copy of this state accrued to `now_ms` (for views).
    pub fn accrued(&self, now_ms: u64) -> Self {
        let mut s = self.clone();
        s.accrue(now_ms);
        s
    }

    pub fn price_is_fresh(&self, now_ms: u64) -> bool {
        self.price.is_some_and(|p| p.is_fresh(self.config.max_price_age_sec, now_ms))
    }

    /// Price used for risk numbers: the latest price, fresh or not (0 when never priced).
    pub fn price_wad_or_zero(&self) -> u128 {
        self.price.map(|p| p.price_wad.0).unwrap_or(0)
    }

    pub fn shares_for_supply(&self, amount: u128) -> u128 {
        if self.total_supply_shares == 0 {
            return amount;
        }
        let value = self.pool_value();
        require!(value > 0, "Pool has shares but no value; supply is disabled");
        mul_div_floor(amount, self.total_supply_shares, value)
    }

    pub fn shares_for_withdraw(&self, amount: u128) -> u128 {
        require!(self.total_supply_shares > 0, "Pool has no supply");
        mul_div_ceil(amount, self.total_supply_shares, self.pool_value())
    }

    pub fn amount_for_shares(&self, shares: u128) -> u128 {
        if self.total_supply_shares == 0 {
            return 0;
        }
        mul_div_floor(shares, self.pool_value(), self.total_supply_shares)
    }
}

impl Contract {
    /// `ft_on_transfer` with `{"action":"supply"}`. Takes the whole amount.
    pub(crate) fn internal_supply(&mut self, sender_id: &AccountId, token_id: &AccountId, amount: u128) {
        self.assert_not_paused();
        let mut account = self.account(sender_id);
        let mut asset = self.accrue_asset(token_id);
        require!(!asset.config.paused, "Asset is paused");
        let shares = asset.shares_for_supply(amount);
        require!(shares > 0, "Supply amount too small to mint shares");
        asset.liquidity = add(asset.liquidity, amount);
        asset.total_supply_shares = add(asset.total_supply_shares, shares);
        crate::vault::credit(&mut account.supply_shares, token_id, shares);
        self.save_asset(asset);
        self.save_account(sender_id, account);
        self.record_activity(sender_id, ActivityKind::Supply, token_id, amount, None);
        emit(
            "supply",
            json!({ "account_id": sender_id, "token_id": token_id, "amount": U128(amount), "shares": U128(shares) }),
        );
    }
}

#[near]
impl Contract {
    /// User, 1 yoctoNEAR. Withdraw `amount` of the underlying from the supply pool; burns
    /// ceil(amount * total_shares / pool_value) shares. Limited by `cash`. Blocked by the global
    /// pause. Returns the ft_transfer promise; its final value is `true` when the tokens arrived
    /// and `false` when the transfer failed and the shares were restored.
    #[payable]
    pub fn withdraw_supply(&mut self, token_id: AccountId, amount: U128) -> Promise {
        assert_one_yocto();
        self.assert_not_paused();
        require!(env::prepaid_gas() >= MIN_GAS_FOR_OUTGOING_TRANSFER, "Attach at least 60 Tgas");
        let amount = amount.0;
        require!(amount > 0, "amount must be > 0");
        let account_id = env::predecessor_account_id();
        let mut account = self.account(&account_id);
        let mut asset = self.accrue_asset(&token_id);
        require!(amount <= asset.cash(), "Not enough cash in the pool");
        let shares = asset.shares_for_withdraw(amount);
        crate::vault::debit(&mut account.supply_shares, &token_id, shares, "Not enough supply shares");
        asset.total_supply_shares = sub(asset.total_supply_shares, shares);
        asset.liquidity = sub(asset.liquidity, amount);
        account.pending_transfers += 1;
        self.save_asset(asset);
        self.save_account(&account_id, account);

        ext_ft_core::ext(token_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(account_id.clone(), U128(amount), None)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_withdraw_supply_transfer(account_id, token_id, U128(amount), U128(shares)),
            )
    }

    /// Callback of `withdraw_supply`. On failure, re-mints the burned shares and returns the
    /// tokens to the pool's liquidity.
    #[private]
    pub fn on_withdraw_supply_transfer(
        &mut self,
        account_id: AccountId,
        token_id: AccountId,
        amount: U128,
        shares: U128,
    ) -> bool {
        let ok = near_sdk::is_promise_success();
        let mut account = self.account_or_default(&account_id);
        account.pending_transfers = account.pending_transfers.saturating_sub(1);
        if ok {
            self.save_account(&account_id, account);
            self.record_activity(&account_id, ActivityKind::WithdrawSupply, &token_id, amount.0, None);
            emit(
                "withdraw_supply",
                json!({ "account_id": account_id, "token_id": token_id, "amount": amount, "shares": shares }),
            );
        } else {
            let mut asset = self.accrue_asset(&token_id);
            asset.liquidity = add(asset.liquidity, amount.0);
            asset.total_supply_shares = add(asset.total_supply_shares, shares.0);
            crate::vault::credit(&mut account.supply_shares, &token_id, shares.0);
            self.save_asset(asset);
            self.save_account(&account_id, account);
            emit(
                "transfer_failed",
                json!({ "action": "withdraw_supply", "account_id": account_id, "token_id": token_id, "amount": amount, "restored": true }),
            );
        }
        ok
    }
}
