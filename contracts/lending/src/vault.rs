//! Per-account positions and collateral accounting.
//!
//! An account holds three independent books keyed by token id: collateral (base units),
//! supply shares, and scaled debt. Entries are removed when they reach zero, so an account with
//! no positions has three empty maps. `pending_transfers` counts outgoing ft_transfers whose
//! callback has not run yet; an account cannot unregister while it is non-zero.
use crate::events::{emit, ActivityKind};
use crate::interest::debt_from_scaled;
use crate::math::{add, position_totals, sub, CollateralTerm, DebtTerm, PositionTotals};
use crate::{Contract, ContractExt, GAS_FOR_CALLBACK, GAS_FOR_FT_TRANSFER, MIN_GAS_FOR_OUTGOING_TRANSFER};
use near_contract_standards::fungible_token::core::ext_ft_core;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{assert_one_yocto, env, near, require, AccountId, NearToken, Promise};
use std::collections::BTreeMap;

#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Account {
    /// token_id -> collateral amount (base units).
    pub collateral: BTreeMap<AccountId, u128>,
    /// token_id -> supply shares.
    pub supply_shares: BTreeMap<AccountId, u128>,
    /// token_id -> scaled debt (debt = ceil(scaled * borrow_index / 1e18)).
    pub borrow_scaled: BTreeMap<AccountId, u128>,
    /// Outgoing transfers awaiting their callback.
    pub pending_transfers: u32,
}

impl Account {
    pub fn has_debt(&self) -> bool {
        !self.borrow_scaled.is_empty()
    }

    pub fn is_empty(&self) -> bool {
        self.collateral.is_empty()
            && self.supply_shares.is_empty()
            && self.borrow_scaled.is_empty()
            && self.pending_transfers == 0
    }

    /// Token ids the account has debt in.
    pub fn debt_tokens(&self) -> Vec<AccountId> {
        self.borrow_scaled.keys().cloned().collect()
    }
}

/// Add `amount` to `map[token]`.
pub(crate) fn credit(map: &mut BTreeMap<AccountId, u128>, token: &AccountId, amount: u128) {
    if amount == 0 {
        return;
    }
    let v = map.entry(token.clone()).or_insert(0);
    *v = add(*v, amount);
}

/// Subtract `amount` from `map[token]`, panicking with `err` when the balance is too small.
/// Removes the entry at zero.
pub(crate) fn debit(map: &mut BTreeMap<AccountId, u128>, token: &AccountId, amount: u128, err: &str) {
    let have = map.get(token).copied().unwrap_or(0);
    require!(have >= amount, err);
    let left = have - amount;
    if left == 0 {
        map.remove(token);
    } else {
        map.insert(token.clone(), left);
    }
}

/// Subtract up to `amount` from `map[token]`; returns what was actually subtracted.
pub(crate) fn debit_saturating(map: &mut BTreeMap<AccountId, u128>, token: &AccountId, amount: u128) -> u128 {
    let have = map.get(token).copied().unwrap_or(0);
    let taken = have.min(amount);
    let left = have - taken;
    if left == 0 {
        map.remove(token);
    } else {
        map.insert(token.clone(), left);
    }
    taken
}

/// Risk numbers of an account at the current block, plus per-asset lines for views.
pub(crate) struct Evaluation {
    pub totals: PositionTotals,
    /// Every collateral and debt asset of the account has a fresh price.
    pub prices_fresh: bool,
    /// (token_id, amount, value_wad)
    pub collateral: Vec<(AccountId, u128, u128)>,
    /// (token_id, debt amount, value_wad)
    pub borrowed: Vec<(AccountId, u128, u128)>,
}

impl Contract {
    /// Evaluate `account` with interest projected to now and the latest prices (stale prices
    /// still produce values, but clear `prices_fresh`; a never-priced asset is valued at 0).
    pub(crate) fn evaluate(&self, account: &Account) -> Evaluation {
        let now = env::block_timestamp_ms();
        let mut prices_fresh = true;
        let mut cterms = Vec::with_capacity(account.collateral.len());
        let mut collateral = Vec::with_capacity(account.collateral.len());
        for (token_id, amount) in &account.collateral {
            let a = self.asset_state(token_id);
            prices_fresh &= a.price_is_fresh(now);
            let term = CollateralTerm {
                amount: *amount,
                price_wad: a.price_wad_or_zero(),
                decimals: a.config.decimals,
                ltv_bps: a.config.ltv_bps,
                liquidation_threshold_bps: a.config.liquidation_threshold_bps,
            };
            let value = crate::math::value_wad(term.amount, term.price_wad, term.decimals);
            collateral.push((token_id.clone(), *amount, value));
            cterms.push(term);
        }
        let mut dterms = Vec::with_capacity(account.borrow_scaled.len());
        let mut borrowed = Vec::with_capacity(account.borrow_scaled.len());
        for (token_id, scaled) in &account.borrow_scaled {
            let a = self.asset_state(token_id).accrued(now);
            prices_fresh &= a.price_is_fresh(now);
            let term = DebtTerm {
                amount: debt_from_scaled(*scaled, a.borrow_index),
                price_wad: a.price_wad_or_zero(),
                decimals: a.config.decimals,
            };
            let value = crate::math::debt_value_wad(term.amount, term.price_wad, term.decimals);
            borrowed.push((token_id.clone(), term.amount, value));
            dterms.push(term);
        }
        Evaluation { totals: position_totals(&cterms, &dterms), prices_fresh, collateral, borrowed }
    }

    /// `ft_on_transfer` with `{"action":"deposit_collateral"}`. Takes the whole amount.
    pub(crate) fn internal_deposit_collateral(&mut self, sender_id: &AccountId, token_id: &AccountId, amount: u128) {
        self.assert_not_paused();
        let mut account = self.account(sender_id);
        let mut asset = self.accrue_asset(token_id);
        require!(!asset.config.paused, "Asset is paused");
        require!(asset.config.can_collateralize, "Asset cannot be used as collateral");
        let total = add(asset.total_collateral, amount);
        let cap = asset.config.collateral_cap.0;
        require!(cap == 0 || total <= cap, "Collateral cap exceeded");
        asset.total_collateral = total;
        credit(&mut account.collateral, token_id, amount);
        self.save_asset(asset);
        self.save_account(sender_id, account);
        self.record_activity(sender_id, ActivityKind::DepositCollateral, token_id, amount, None);
        emit(
            "deposit_collateral",
            json!({ "account_id": sender_id, "token_id": token_id, "amount": U128(amount) }),
        );
    }
}

#[near]
impl Contract {
    /// User, 1 yoctoNEAR. Withdraw collateral. With debt, every asset of the account needs a
    /// fresh price and `debt_wad <= borrow_limit_wad_after`. Blocked by the global pause (not by
    /// the asset's own pause). Returns the ft_transfer promise; its final value is `true` when
    /// the tokens arrived and `false` when the transfer failed and the collateral was restored.
    #[payable]
    pub fn withdraw_collateral(&mut self, token_id: AccountId, amount: U128) -> Promise {
        assert_one_yocto();
        self.assert_not_paused();
        require!(env::prepaid_gas() >= MIN_GAS_FOR_OUTGOING_TRANSFER, "Attach at least 60 Tgas");
        let amount = amount.0;
        require!(amount > 0, "amount must be > 0");
        let account_id = env::predecessor_account_id();
        let mut account = self.account(&account_id);
        for t in account.debt_tokens() {
            self.accrue_asset(&t);
        }
        let mut asset = self.accrue_asset(&token_id);
        debit(&mut account.collateral, &token_id, amount, "Not enough collateral");
        if account.has_debt() {
            let ev = self.evaluate(&account);
            require!(ev.prices_fresh, "Withdrawal with debt requires fresh prices for every asset of the account");
            require!(ev.totals.within_borrow_limit(), "Withdrawal would exceed the borrow limit");
        }
        asset.total_collateral = sub(asset.total_collateral, amount);
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
                    .on_withdraw_collateral_transfer(account_id, token_id, U128(amount)),
            )
    }

    /// Callback of `withdraw_collateral`. On failure, the collateral is credited back.
    #[private]
    pub fn on_withdraw_collateral_transfer(&mut self, account_id: AccountId, token_id: AccountId, amount: U128) -> bool {
        let ok = near_sdk::is_promise_success();
        let mut account = self.account_or_default(&account_id);
        account.pending_transfers = account.pending_transfers.saturating_sub(1);
        if ok {
            self.save_account(&account_id, account);
            self.record_activity(&account_id, ActivityKind::WithdrawCollateral, &token_id, amount.0, None);
            emit(
                "withdraw_collateral",
                json!({ "account_id": account_id, "token_id": token_id, "amount": amount }),
            );
        } else {
            let mut asset = self.accrue_asset(&token_id);
            asset.total_collateral = add(asset.total_collateral, amount.0);
            credit(&mut account.collateral, &token_id, amount.0);
            self.save_asset(asset);
            self.save_account(&account_id, account);
            emit(
                "transfer_failed",
                json!({ "action": "withdraw_collateral", "account_id": account_id, "token_id": token_id, "amount": amount, "restored": true }),
            );
        }
        ok
    }
}
