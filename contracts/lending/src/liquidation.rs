//! Liquidation.
//!
//! A liquidator sends the borrower's debt token with
//! `ft_transfer_call(lending, amount, msg = {"action":"liquidate","borrower_id":..,"collateral_token_id":..})`.
//! The borrower must be liquidatable (`debt_wad > liq_threshold_wad`) on fresh prices for every
//! asset they hold. Then:
//! ```text
//! max_repay       = debt(borrower, debt_token) * close_factor_bps / 10_000        (5_000)
//! repay           = min(transferred_amount, max_repay)
//! seize_value_wad = value_wad(repay, debt_price) * (10_000 + bonus_bps(collateral)) / 10_000
//! seize_amount    = seize_value_wad * 10^collateral_decimals / collateral_price   (rounded down)
//! if seize_amount > borrower collateral: seize all, repay = ceil(repay * collateral / seize_amount)
//! refund          = transferred_amount - repay      (returned through ft_on_transfer)
//! ```
//! The seized collateral goes to the liquidator with `ft_transfer`; if that transfer fails, the
//! callback credits it to the liquidator's collateral in this contract (withdrawable later), so
//! the repaid debt and the seizure stay consistent. Debt left after the borrower's collateral is
//! exhausted stays recorded and the event reports it (`bad_debt`).
use crate::events::{emit, ActivityKind};
use crate::interest::{debt_from_scaled, scaled_for_repay};
use crate::math::{add, amount_for_value, bps_floor, mul_div_ceil, sub, value_wad, BPS};
use crate::vault::{credit, debit, debit_saturating};
use crate::{
    Contract, ContractExt, CLOSE_FACTOR_BPS, GAS_FOR_CALLBACK, GAS_FOR_FT_TRANSFER, MIN_GAS_FOR_OUTGOING_TRANSFER,
};
use near_contract_standards::fungible_token::core::ext_ft_core;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId, NearToken};

/// Inputs of the pure liquidation formula.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LiquidationInput {
    /// Borrower's current debt in the debt token (base units).
    pub debt_amount: u128,
    /// Amount the liquidator transferred.
    pub transferred_amount: u128,
    pub debt_price_wad: u128,
    pub debt_decimals: u8,
    pub collateral_price_wad: u128,
    pub collateral_decimals: u8,
    pub liquidation_bonus_bps: u16,
    /// Borrower's collateral in the collateral token (base units).
    pub borrower_collateral: u128,
    pub close_factor_bps: u16,
}

/// Outputs of the pure liquidation formula.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LiquidationQuote {
    pub max_repay: u128,
    pub repay: u128,
    pub seize_value_wad: u128,
    pub seize_amount: u128,
    pub refund: u128,
    /// The seize hit the borrower's collateral and repay was scaled down.
    pub capped: bool,
}

/// Pure liquidation math (mirrored in `src/lib/risk`).
pub fn liquidation_quote(i: &LiquidationInput) -> LiquidationQuote {
    let max_repay = bps_floor(i.debt_amount, i.close_factor_bps as u128);
    let mut repay = i.transferred_amount.min(max_repay);
    let seize_value_wad = bps_floor(
        value_wad(repay, i.debt_price_wad, i.debt_decimals),
        BPS + i.liquidation_bonus_bps as u128,
    );
    let mut seize_amount = amount_for_value(seize_value_wad, i.collateral_price_wad, i.collateral_decimals);
    let mut capped = false;
    if seize_amount > i.borrower_collateral {
        repay = mul_div_ceil(repay, i.borrower_collateral, seize_amount);
        seize_amount = i.borrower_collateral;
        capped = true;
    }
    LiquidationQuote {
        max_repay,
        repay,
        seize_value_wad,
        seize_amount,
        refund: sub(i.transferred_amount, repay),
        capped,
    }
}

impl Contract {
    /// `ft_on_transfer` with `{"action":"liquidate",...}`. Open during the global pause.
    /// `debt_token_id` is the predecessor (the token contract). Returns the refund.
    pub(crate) fn internal_liquidate(
        &mut self,
        liquidator_id: &AccountId,
        debt_token_id: &AccountId,
        amount: u128,
        borrower_id: &AccountId,
        collateral_token_id: &AccountId,
    ) -> u128 {
        require!(liquidator_id != borrower_id, "Self-liquidation is not allowed");
        require!(env::prepaid_gas() >= MIN_GAS_FOR_OUTGOING_TRANSFER, "Attach at least 60 Tgas to ft_on_transfer");
        let mut liquidator = self.account(liquidator_id);
        let mut borrower = self.accounts.get(borrower_id).cloned().unwrap_or_else(|| env::panic_str("Borrower has no account"));
        let collateral_asset = self.accrue_asset(collateral_token_id);
        for t in borrower.debt_tokens() {
            self.accrue_asset(&t);
        }
        let mut debt_asset = self.accrue_asset(debt_token_id);

        let ev = self.evaluate(&borrower);
        require!(ev.prices_fresh, "Liquidation requires fresh prices for every asset of the borrower");
        require!(ev.totals.below_liquidation_threshold(), "Borrower is not liquidatable");

        let scaled = borrower.borrow_scaled.get(debt_token_id).copied().unwrap_or(0);
        require!(scaled > 0, "Borrower has no debt in this token");
        let collateral = borrower.collateral.get(collateral_token_id).copied().unwrap_or(0);
        require!(collateral > 0, "Borrower has no collateral in this token");
        let debt = debt_from_scaled(scaled, debt_asset.borrow_index);

        let q = liquidation_quote(&LiquidationInput {
            debt_amount: debt,
            transferred_amount: amount,
            debt_price_wad: debt_asset.price_wad_or_zero(),
            debt_decimals: debt_asset.config.decimals,
            collateral_price_wad: collateral_asset.price_wad_or_zero(),
            collateral_decimals: collateral_asset.config.decimals,
            liquidation_bonus_bps: collateral_asset.config.liquidation_bonus_bps,
            borrower_collateral: collateral,
            close_factor_bps: CLOSE_FACTOR_BPS,
        });
        require!(q.repay > 0, "Repay amount is zero");
        require!(q.seize_amount > 0, "Repay amount too small to seize collateral");

        // Debt side: the liquidator's tokens repay part of the borrower's debt.
        let removed = if q.repay >= debt { scaled } else { scaled_for_repay(q.repay, debt_asset.borrow_index) };
        let removed = debit_saturating(&mut borrower.borrow_scaled, debt_token_id, removed);
        debt_asset.total_scaled_borrowed = debt_asset.total_scaled_borrowed.saturating_sub(removed);
        debt_asset.liquidity = add(debt_asset.liquidity, q.repay);
        let remaining_debt =
            debt_from_scaled(borrower.borrow_scaled.get(debt_token_id).copied().unwrap_or(0), debt_asset.borrow_index);
        self.save_asset(debt_asset);

        // Collateral side: seized from the borrower, in flight to the liquidator.
        debit(&mut borrower.collateral, collateral_token_id, q.seize_amount, "Not enough collateral");
        let mut collateral_asset = self.asset_state(collateral_token_id);
        collateral_asset.total_collateral = sub(collateral_asset.total_collateral, q.seize_amount);
        self.save_asset(collateral_asset);

        let collateral_exhausted = borrower.collateral.is_empty();
        let bad_debt = collateral_exhausted && borrower.has_debt();
        let borrower_debt_left: Vec<_> = if bad_debt {
            self.evaluate(&borrower).borrowed.into_iter().map(|(t, a, _)| json!({ "token_id": t, "amount": U128(a) })).collect()
        } else {
            Vec::new()
        };
        self.save_account(borrower_id, borrower);
        liquidator.pending_transfers += 1;
        self.save_account(liquidator_id, liquidator);

        self.record_activity(borrower_id, ActivityKind::Liquidated, collateral_token_id, q.seize_amount, Some(liquidator_id));
        self.record_activity(liquidator_id, ActivityKind::Liquidate, debt_token_id, q.repay, Some(borrower_id));
        emit(
            "liquidate",
            json!({
                "liquidator_id": liquidator_id,
                "borrower_id": borrower_id,
                "debt_token_id": debt_token_id,
                "collateral_token_id": collateral_token_id,
                "repaid": U128(q.repay),
                "seized": U128(q.seize_amount),
                "refund": U128(q.refund),
                "seize_capped": q.capped,
                "remaining_debt": U128(remaining_debt),
                "collateral_exhausted": collateral_exhausted,
                "bad_debt": bad_debt,
                "bad_debt_amounts": borrower_debt_left,
            }),
        );

        ext_ft_core::ext(collateral_token_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(liquidator_id.clone(), U128(q.seize_amount), None)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_seize_transfer(liquidator_id.clone(), collateral_token_id.clone(), U128(q.seize_amount)),
            )
            .detach();
        q.refund
    }
}

#[near]
impl Contract {
    /// Callback of the seized-collateral transfer. On failure the seized amount is credited to
    /// the liquidator's collateral in this contract (it never returns to the borrower, whose
    /// debt was already repaid by the liquidator).
    #[private]
    pub fn on_seize_transfer(&mut self, liquidator_id: AccountId, token_id: AccountId, amount: U128) -> bool {
        let ok = near_sdk::is_promise_success();
        let mut liquidator = self.account_or_default(&liquidator_id);
        liquidator.pending_transfers = liquidator.pending_transfers.saturating_sub(1);
        if !ok {
            let mut asset = self.accrue_asset(&token_id);
            asset.total_collateral = add(asset.total_collateral, amount.0);
            credit(&mut liquidator.collateral, &token_id, amount.0);
            self.save_asset(asset);
            emit(
                "transfer_failed",
                json!({ "action": "liquidation_seize", "account_id": liquidator_id, "token_id": token_id, "amount": amount, "restored": false, "credited_as_collateral": true }),
            );
        }
        self.save_account(&liquidator_id, liquidator);
        ok
    }
}
