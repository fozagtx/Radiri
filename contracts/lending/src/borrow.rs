//! Borrow and repay.
//!
//! Ordering is reentrancy safe: every check runs and every state change is written before the
//! outgoing `ft_transfer`. Its callback restores the position if the transfer failed (for example
//! when the borrower is not registered on the token contract).
use crate::events::{emit, ActivityKind};
use crate::interest::{debt_from_scaled, scaled_for_borrow, scaled_for_repay};
use crate::math::{add, sub};
use crate::vault::{credit, debit_saturating};
use crate::{Contract, ContractExt, GAS_FOR_CALLBACK, GAS_FOR_FT_TRANSFER, MIN_GAS_FOR_OUTGOING_TRANSFER};
use near_contract_standards::fungible_token::core::ext_ft_core;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{assert_one_yocto, env, near, require, AccountId, NearToken, Promise};

#[near]
impl Contract {
    /// User, 1 yoctoNEAR. Borrow `amount` of `token_id`.
    ///
    /// Checks, in order: global pause, asset registered / not paused / `can_borrow`, interest
    /// accrued on every debt asset of the account, `amount <= cash`, `borrow_cap`, fresh prices
    /// for every collateral and debt asset plus the borrowed asset, and
    /// `debt_wad_after <= borrow_limit_wad`. Returns the ft_transfer promise; its final value is
    /// `true` when the tokens arrived and `false` when the transfer failed and the debt was
    /// removed again.
    #[payable]
    pub fn borrow(&mut self, token_id: AccountId, amount: U128) -> Promise {
        assert_one_yocto();
        self.assert_not_paused();
        require!(env::prepaid_gas() >= MIN_GAS_FOR_OUTGOING_TRANSFER, "Attach at least 60 Tgas");
        let amount = amount.0;
        require!(amount > 0, "amount must be > 0");
        let account_id = env::predecessor_account_id();
        let mut account = self.account(&account_id);
        let mut asset = self.accrue_asset(&token_id);
        require!(!asset.config.paused, "Asset is paused");
        require!(asset.config.can_borrow, "Asset cannot be borrowed");
        for t in account.debt_tokens() {
            if t != token_id {
                self.accrue_asset(&t);
            }
        }
        require!(amount <= asset.cash(), "Not enough liquidity");
        let cap = asset.config.borrow_cap.0;
        require!(cap == 0 || add(asset.total_borrowed(), amount) <= cap, "Borrow cap exceeded");

        let scaled = scaled_for_borrow(amount, asset.borrow_index);
        credit(&mut account.borrow_scaled, &token_id, scaled);
        let ev = self.evaluate(&account);
        require!(ev.prices_fresh, "Borrow requires fresh prices for every asset of the account");
        require!(ev.totals.within_borrow_limit(), "Borrow would exceed the borrow limit");

        asset.total_scaled_borrowed = add(asset.total_scaled_borrowed, scaled);
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
                    .on_borrow_transfer(account_id, token_id, U128(amount), U128(scaled)),
            )
    }

    /// Callback of `borrow`. On failure, removes the scaled debt that was added (at most what the
    /// account still owes) and returns the tokens to the pool's liquidity.
    #[private]
    pub fn on_borrow_transfer(&mut self, account_id: AccountId, token_id: AccountId, amount: U128, scaled: U128) -> bool {
        let ok = near_sdk::is_promise_success();
        let mut account = self.account_or_default(&account_id);
        account.pending_transfers = account.pending_transfers.saturating_sub(1);
        if ok {
            self.save_account(&account_id, account);
            self.record_activity(&account_id, ActivityKind::Borrow, &token_id, amount.0, None);
            emit("borrow", json!({ "account_id": account_id, "token_id": token_id, "amount": amount }));
        } else {
            let mut asset = self.accrue_asset(&token_id);
            let removed = debit_saturating(&mut account.borrow_scaled, &token_id, scaled.0);
            asset.total_scaled_borrowed = asset.total_scaled_borrowed.saturating_sub(removed);
            asset.liquidity = add(asset.liquidity, amount.0);
            self.save_asset(asset);
            self.save_account(&account_id, account);
            emit(
                "transfer_failed",
                json!({ "action": "borrow", "account_id": account_id, "token_id": token_id, "amount": amount, "restored": true }),
            );
        }
        ok
    }
}

impl Contract {
    /// `ft_on_transfer` with `{"action":"repay"}`. Open during the global pause. Repays the
    /// sender's own debt in `token_id`; returns the excess for refund.
    pub(crate) fn internal_repay(&mut self, sender_id: &AccountId, token_id: &AccountId, amount: u128) -> u128 {
        let mut account = self.account(sender_id);
        let mut asset = self.accrue_asset(token_id);
        let scaled = account.borrow_scaled.get(token_id).copied().unwrap_or(0);
        require!(scaled > 0, "No debt to repay in this token");
        let debt = debt_from_scaled(scaled, asset.borrow_index);
        let repay = amount.min(debt);
        let removed = if repay == debt { scaled } else { scaled_for_repay(repay, asset.borrow_index) };
        let removed = debit_saturating(&mut account.borrow_scaled, token_id, removed);
        asset.total_scaled_borrowed = asset.total_scaled_borrowed.saturating_sub(removed);
        asset.liquidity = add(asset.liquidity, repay);
        let remaining = debt_from_scaled(account.borrow_scaled.get(token_id).copied().unwrap_or(0), asset.borrow_index);
        self.save_asset(asset);
        self.save_account(sender_id, account);
        self.record_activity(sender_id, ActivityKind::Repay, token_id, repay, None);
        emit(
            "repay",
            json!({
                "account_id": sender_id,
                "token_id": token_id,
                "amount": U128(repay),
                "refund": U128(amount - repay),
                "remaining_debt": U128(remaining),
            }),
        );
        amount - repay
    }
}
