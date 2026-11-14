//! NEP-145 storage management with a fixed deposit.
//!
//! Registration costs exactly `STORAGE_DEPOSIT` (0.1 NEAR = 10 kB at 1e19 yoctoNEAR per byte);
//! min == max, so `available` is always 0 and `storage_withdraw` can only withdraw 0. The bound
//! covers the worst-case account: 16 assets in each of the three books plus 32 activity entries,
//! all with 64-byte token ids (checked by a unit test). Unregistering refunds the deposit and
//! requires an empty account (no collateral, supply or debt, no transfer in flight); `force` is
//! refused for non-empty accounts so debt can never be erased.
use crate::vault::Account;
use crate::{Contract, ContractExt};
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::{assert_one_yocto, env, log, near, require, AccountId, NearToken, Promise};

/// Fixed NEP-145 deposit per account: 0.1 NEAR.
pub const STORAGE_DEPOSIT: NearToken = NearToken::from_millinear(100);

fn registered_balance() -> StorageBalance {
    StorageBalance { total: STORAGE_DEPOSIT, available: NearToken::from_yoctonear(0) }
}

#[near]
impl StorageManagement for Contract {
    /// Registers `account_id` (default: the caller) for exactly 0.1 NEAR and refunds any excess.
    /// An already registered account gets the whole deposit back. `registration_only` makes no
    /// difference because min == max.
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        let _ = registration_only;
        let amount = env::attached_deposit();
        let account_id = account_id.unwrap_or_else(env::predecessor_account_id);
        let refund = if self.accounts.contains_key(&account_id) {
            log!("The account is already registered, refunding the deposit");
            amount
        } else {
            require!(amount >= STORAGE_DEPOSIT, "The attached deposit is less than the storage deposit of 0.1 NEAR");
            self.accounts.insert(account_id, Account::default());
            amount.saturating_sub(STORAGE_DEPOSIT)
        };
        if !refund.is_zero() {
            Promise::new(env::predecessor_account_id()).transfer(refund).detach();
        }
        registered_balance()
    }

    /// 1 yoctoNEAR. Nothing is ever available (min == max); only `amount` 0 / null succeeds.
    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        assert_one_yocto();
        let account_id = env::predecessor_account_id();
        require!(self.accounts.contains_key(&account_id), format!("The account {} is not registered", account_id));
        if let Some(amount) = amount {
            require!(amount.is_zero(), "The amount is greater than the available storage balance");
        }
        registered_balance()
    }

    /// 1 yoctoNEAR. Removes an empty account and refunds 0.1 NEAR (+ the yocto). Returns false
    /// when the caller is not registered. Panics for a non-empty account even with `force`.
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        assert_one_yocto();
        let account_id = env::predecessor_account_id();
        let Some(account) = self.accounts.get(&account_id) else {
            log!("The account {} is not registered", account_id);
            return false;
        };
        let _ = force;
        require!(
            account.is_empty(),
            "Cannot unregister an account with collateral, supply, debt or a transfer in flight (force is not supported)"
        );
        self.accounts.remove(&account_id);
        self.activity.remove(&account_id);
        Promise::new(account_id)
            .transfer(STORAGE_DEPOSIT.saturating_add(NearToken::from_yoctonear(1)))
            .detach();
        true
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        StorageBalanceBounds { min: STORAGE_DEPOSIT, max: Some(STORAGE_DEPOSIT) }
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.accounts.contains_key(&account_id).then(registered_balance)
    }
}
