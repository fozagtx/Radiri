//! Radiri lending: deposit meme coins or tokenized stocks as collateral and borrow the other.
//!
//! One contract holds collateral, debt, pool liquidity and prices, because NEAR cross-contract
//! calls are asynchronous: a health check in one contract and a balance change in another could
//! interleave (docs/ARCHITECTURE.md section 3). The source is split by concern:
//!
//! | module        | concern                                                         |
//! | ------------- | --------------------------------------------------------------- |
//! | `registry`    | asset registry and config validation                            |
//! | `oracle`      | reporter-pushed prices, staleness, deviation guard, force_price |
//! | `vault`       | accounts, collateral, position evaluation, withdraw_collateral  |
//! | `pool`        | supply shares, liquidity, reserves, accrual, withdraw_supply    |
//! | `interest`    | kinked rate model and borrow index                              |
//! | `borrow`      | borrow and repay                                                |
//! | `liquidation` | liquidation math and execution                                  |
//! | `config`      | owner, guardian, reporters, global pause                        |
//! | `events`      | NEP-297 events (`radiri-lending` 1.0.0) and the activity log    |
//! | `math`        | checked 256-bit mul_div and the pure risk formulas              |
//! | `storage`     | NEP-145 with a fixed 0.1 NEAR deposit                           |
//! | `views`       | read-only views                                                 |
//!
//! Tokens enter only through `ft_on_transfer` from a registered token contract and leave only
//! through `ft_transfer` with a callback that restores state when the transfer fails.
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, Gas, PanicOnDefault, PromiseOrValue};

pub mod borrow;
pub mod config;
pub mod events;
pub mod interest;
pub mod liquidation;
pub mod math;
pub mod oracle;
pub mod pool;
pub mod registry;
pub mod storage;
pub mod vault;
pub mod views;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod vector_tests;

pub use config::LendingConfigView;
pub use events::{ActivityEntry, ActivityKind};
pub use interest::InterestModel;
pub use oracle::{OraclePrice, PriceInput};
pub use pool::AssetState;
pub use registry::{AssetCategory, AssetConfig};
pub use storage::STORAGE_DEPOSIT;
pub use vault::Account;
pub use views::{AccountView, AssetView};

/// Share of a borrower's debt (in one token) a single liquidation may repay.
pub const CLOSE_FACTOR_BPS: u16 = 5_000;
/// Gas for an outgoing `ft_transfer`.
pub const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(15);
/// Gas reserved for the callback that confirms or restores an outgoing transfer.
pub const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(20);
/// Prepaid gas required before any method that sends tokens out starts changing state.
pub const MIN_GAS_FOR_OUTGOING_TRANSFER: Gas = Gas::from_tgas(60);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Assets,
    Accounts,
    Activity,
}

/// One message per `ft_on_transfer`. JSON: `{"action":"deposit_collateral"}`,
/// `{"action":"supply"}`, `{"action":"repay"}`,
/// `{"action":"liquidate","borrower_id":"..","collateral_token_id":".."}`.
#[near(serializers = [json])]
#[serde(tag = "action", rename_all = "snake_case")]
#[derive(Clone, Debug, PartialEq)]
pub enum TokenReceiverMsg {
    DepositCollateral,
    Supply,
    Repay,
    Liquidate { borrower_id: AccountId, collateral_token_id: AccountId },
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub(crate) owner_id: AccountId,
    pub(crate) guardian_id: AccountId,
    pub(crate) oracle_reporters: Vec<AccountId>,
    pub(crate) paused: bool,
    /// token_id -> config, pool state and latest price. Iteration order = registration order.
    pub(crate) assets: IterableMap<AccountId, AssetState>,
    /// Registered (NEP-145) accounts and their positions.
    pub(crate) accounts: IterableMap<AccountId, Account>,
    /// Per-account activity ring buffer, oldest first, capped at 32.
    pub(crate) activity: LookupMap<AccountId, Vec<ActivityEntry>>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId, guardian_id: AccountId, oracle_reporters: Vec<AccountId>) -> Self {
        config::validate_reporters(&oracle_reporters);
        Self {
            owner_id,
            guardian_id,
            oracle_reporters,
            paused: false,
            assets: IterableMap::new(StorageKey::Assets),
            accounts: IterableMap::new(StorageKey::Accounts),
            activity: LookupMap::new(StorageKey::Activity),
        }
    }
}

#[near]
impl FungibleTokenReceiver for Contract {
    /// Entry point for every incoming token. The predecessor must be a registered asset's token
    /// contract; `sender_id` must be registered (NEP-145). Returns the unused amount, which the
    /// token contract refunds. A panic refunds the whole amount.
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token_id = env::predecessor_account_id();
        require!(
            self.assets.contains_key(&token_id),
            format!("Token is not a registered asset: {}", token_id)
        );
        let amount = amount.0;
        require!(amount > 0, "amount must be > 0");
        let msg: TokenReceiverMsg = near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| {
            env::panic_str(
                "Invalid msg: expected {\"action\":\"deposit_collateral\"|\"supply\"|\"repay\"} or {\"action\":\"liquidate\",\"borrower_id\":..,\"collateral_token_id\":..}",
            )
        });
        let unused = match msg {
            TokenReceiverMsg::DepositCollateral => {
                self.internal_deposit_collateral(&sender_id, &token_id, amount);
                0
            }
            TokenReceiverMsg::Supply => {
                self.internal_supply(&sender_id, &token_id, amount);
                0
            }
            TokenReceiverMsg::Repay => self.internal_repay(&sender_id, &token_id, amount),
            TokenReceiverMsg::Liquidate { borrower_id, collateral_token_id } => {
                self.internal_liquidate(&sender_id, &token_id, amount, &borrower_id, &collateral_token_id)
            }
        };
        PromiseOrValue::Value(U128(unused))
    }
}

/// Internal state accessors shared by the modules.
impl Contract {
    /// Stored state of a registered asset (not accrued). Panics when unregistered.
    pub(crate) fn asset_state(&self, token_id: &AccountId) -> AssetState {
        self.assets
            .get(token_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str(&format!("Asset is not registered: {}", token_id)))
    }

    pub(crate) fn save_asset(&mut self, state: AssetState) {
        self.assets.insert(state.config.token_id.clone(), state);
    }

    /// Accrue interest on an asset up to the current block, persist it and return the state.
    pub(crate) fn accrue_asset(&mut self, token_id: &AccountId) -> AssetState {
        let mut state = self.asset_state(token_id);
        state.accrue(env::block_timestamp_ms());
        self.save_asset(state.clone());
        state
    }

    /// A registered account's positions. Panics when unregistered.
    pub(crate) fn account(&self, account_id: &AccountId) -> Account {
        self.accounts.get(account_id).cloned().unwrap_or_else(|| {
            env::panic_str(&format!("Account {} is not registered; call storage_deposit first", account_id))
        })
    }

    /// Used by callbacks only: an account with a transfer in flight cannot unregister, so this
    /// always finds it; the default keeps a restore from being lost if it ever did not.
    pub(crate) fn account_or_default(&self, account_id: &AccountId) -> Account {
        self.accounts.get(account_id).cloned().unwrap_or_default()
    }

    pub(crate) fn save_account(&mut self, account_id: &AccountId, account: Account) {
        self.accounts.insert(account_id.clone(), account);
    }
}
