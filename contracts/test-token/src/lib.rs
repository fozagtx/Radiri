//! Radiri test token: a TESTNET-ONLY NEP-141 fungible token with no value.
//!
//! Used by the Radiri lending contract on testnet (tPEPE, tWIF, tSHIB, tBRETT, tAAPL, tTSLA,
//! tNVDA). Anyone can `mint` up to 10,000,000,000 whole tokens per call. The metadata name must carry
//! "(no value)" and `new` refuses to initialise on an account outside testnet (or the local
//! sandbox), so the token cannot be mistaken for a real asset.
//!
//! Standards: NEP-141 (core + resolver), NEP-145 (storage management), NEP-148 (metadata),
//! NEP-297 events (`nep141` ft_mint / ft_transfer / ft_burn) — all from near-contract-standards.
use near_contract_standards::fungible_token::events::{FtBurn, FtMint};
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{FungibleToken, FungibleTokenCore, FungibleTokenResolver};
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::json_types::U128;
use near_sdk::{env, log, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise, PromiseOrValue};

/// Largest mint per call, in whole tokens.
/// Meme coins need billions of units to be meaningful collateral (2B PEPE is a few thousand USD).
pub const MAX_MINT_WHOLE_TOKENS: u128 = 10_000_000_000;
/// Every test token's name must contain this label.
pub const NO_VALUE_LABEL: &str = "(no value)";
/// Account suffixes the token may be initialised on: testnet, or the near-workspaces sandbox.
pub const ALLOWED_ACCOUNT_SUFFIXES: [&str; 2] = [".testnet", ".test.near"];
/// Largest supported decimals.
pub const MAX_DECIMALS: u8 = 24;

/// Grey "TEST" badge so wallets never show a real logo.
const ICON: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='16' fill='%239ca3af'/%3E%3Ctext x='16' y='20' font-family='monospace' font-size='9' text-anchor='middle' fill='white'%3ETEST%3C/text%3E%3C/svg%3E";

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Accounts,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    token: FungibleToken,
    metadata: FungibleTokenMetadata,
}

fn on_allowed_network(account_id: &AccountId) -> bool {
    ALLOWED_ACCOUNT_SUFFIXES.iter().any(|s| account_id.as_str().ends_with(s))
}

#[near]
impl Contract {
    /// Initialise with zero supply. `name` must contain "(no value)", e.g.
    /// "Radiri Test PEPE (no value)". The owner is registered for convenience; it has no
    /// special minting rights (anyone can mint).
    #[init]
    pub fn new(owner_id: AccountId, name: String, symbol: String, decimals: u8) -> Self {
        require!(
            on_allowed_network(&env::current_account_id()),
            "Testnet only: the token account must end with .testnet (or .test.near in the sandbox)"
        );
        require!(name.contains(NO_VALUE_LABEL), "name must contain \"(no value)\"");
        require!(!symbol.is_empty() && symbol.len() <= 16, "symbol must be 1 to 16 bytes");
        require!(decimals <= MAX_DECIMALS, "decimals must be at most 24");
        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name,
            symbol,
            icon: Some(ICON.to_string()),
            reference: None,
            reference_hash: None,
            decimals,
        };
        metadata.assert_valid();
        let mut token = FungibleToken::new(StorageKey::Accounts);
        token.internal_register_account(&owner_id);
        Self { owner_id, token, metadata }
    }

    /// Public faucet: mint `amount` base units (at most 10,000,000,000 whole tokens) to `account_id`.
    ///
    /// If `account_id` is not registered, attach at least `storage_balance_bounds().min`
    /// (0.00125 NEAR) and it is registered first; any excess deposit is refunded to the caller.
    /// If it is registered, any attached deposit is refunded. Returns the new balance.
    #[payable]
    pub fn mint(&mut self, account_id: AccountId, amount: U128) -> U128 {
        let amount = amount.0;
        require!(amount > 0, "amount must be > 0");
        let cap = MAX_MINT_WHOLE_TOKENS
            .checked_mul(10u128.pow(self.metadata.decimals as u32))
            .unwrap_or(u128::MAX);
        require!(amount <= cap, "At most 10,000,000,000 whole tokens per mint call");

        let attached = env::attached_deposit();
        let mut refund = attached;
        if !self.token.accounts.contains_key(&account_id) {
            let min = self.token.storage_balance_bounds().min;
            require!(
                attached >= min,
                format!(
                    "{} is not registered: attach at least {} yoctoNEAR to mint, or call storage_deposit first",
                    account_id,
                    min.as_yoctonear()
                )
            );
            self.token.internal_register_account(&account_id);
            refund = attached.saturating_sub(min);
        }
        self.token.internal_deposit(&account_id, amount);
        FtMint { owner_id: &account_id, amount: U128(amount), memo: Some("radiri testnet faucet") }.emit();
        if !refund.is_zero() {
            Promise::new(env::predecessor_account_id()).transfer(refund).detach();
        }
        U128(self.token.internal_unwrap_balance_of(&account_id))
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }

    /// Largest `mint` amount in base units.
    pub fn max_mint(&self) -> U128 {
        U128(
            MAX_MINT_WHOLE_TOKENS
                .checked_mul(10u128.pow(self.metadata.decimals as u32))
                .unwrap_or(u128::MAX),
        )
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned > 0 {
            log!("Account @{} burned {}", sender_id, burned);
        }
        used.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        match self.token.internal_storage_unregister(force) {
            Some((account_id, balance)) => {
                if balance > 0 {
                    FtBurn { owner_id: &account_id, amount: U128(balance), memo: Some("storage_unregister") }.emit();
                }
                true
            }
            None => false,
        }
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    const TOKEN: &str = "tpepe.radiri.testnet";

    fn ctx(predecessor: AccountId, deposit: NearToken) {
        testing_env!(VMContextBuilder::new()
            .current_account_id(TOKEN.parse().unwrap())
            .predecessor_account_id(predecessor)
            .attached_deposit(deposit)
            .build());
    }

    fn setup(decimals: u8) -> Contract {
        ctx(accounts(0), NearToken::from_yoctonear(0));
        Contract::new(accounts(0), "Radiri Test PEPE (no value)".into(), "tPEPE".into(), decimals)
    }

    fn min_storage(c: &Contract) -> NearToken {
        c.storage_balance_bounds().min
    }

    #[test]
    fn init_metadata_is_labelled() {
        let c = setup(18);
        let m = c.ft_metadata();
        assert_eq!(m.spec, "ft-1.0.0");
        assert!(m.name.contains("(no value)"));
        assert_eq!(m.symbol, "tPEPE");
        assert_eq!(m.decimals, 18);
        assert!(m.icon.unwrap().starts_with("data:image/svg+xml"));
        assert_eq!(c.ft_total_supply().0, 0);
        assert_eq!(c.get_owner(), accounts(0));
        assert!(c.storage_balance_of(accounts(0)).is_some());
        assert_eq!(c.max_mint().0, 10_000_000_000 * 10u128.pow(18));
    }

    #[test]
    #[should_panic(expected = "name must contain \"(no value)\"")]
    fn name_needs_no_value_label() {
        ctx(accounts(0), NearToken::from_yoctonear(0));
        Contract::new(accounts(0), "Pepe".into(), "PEPE".into(), 18);
    }

    #[test]
    #[should_panic(expected = "Testnet only")]
    fn refuses_mainnet_account() {
        testing_env!(VMContextBuilder::new().current_account_id("tpepe.radiri.near".parse().unwrap()).build());
        Contract::new(accounts(0), "Radiri Test PEPE (no value)".into(), "tPEPE".into(), 18);
    }

    #[test]
    fn sandbox_account_is_allowed() {
        testing_env!(VMContextBuilder::new().current_account_id("dev-1-2.test.near".parse().unwrap()).build());
        Contract::new(accounts(0), "Radiri Test PEPE (no value)".into(), "tPEPE".into(), 18);
    }

    #[test]
    fn mint_auto_registers_with_storage_and_refunds_excess() {
        let mut c = setup(6);
        let min = min_storage(&c);
        ctx(accounts(1), min.saturating_add(NearToken::from_millinear(5)));
        let bal = c.mint(accounts(2), U128(5_000_000));
        assert_eq!(bal.0, 5_000_000);
        assert_eq!(c.ft_balance_of(accounts(2)).0, 5_000_000);
        assert_eq!(c.ft_total_supply().0, 5_000_000);
        assert!(get_logs().iter().any(|l| l.contains("\"event\":\"ft_mint\"")));
        // Registered now: a second mint needs no deposit.
        ctx(accounts(1), NearToken::from_yoctonear(0));
        assert_eq!(c.mint(accounts(2), U128(1)).0, 5_000_001);
    }

    #[test]
    #[should_panic(expected = "is not registered: attach at least")]
    fn mint_to_unregistered_without_deposit_panics() {
        let mut c = setup(6);
        ctx(accounts(1), NearToken::from_yoctonear(0));
        c.mint(accounts(2), U128(1));
    }

    #[test]
    #[should_panic(expected = "At most 10,000,000,000 whole tokens per mint call")]
    fn mint_is_capped_per_call() {
        let mut c = setup(8);
        ctx(accounts(0), NearToken::from_yoctonear(0));
        c.mint(accounts(0), U128(10_000_000_000 * 10u128.pow(8) + 1));
    }

    #[test]
    fn mint_at_cap_is_allowed() {
        let mut c = setup(8);
        ctx(accounts(0), NearToken::from_yoctonear(0));
        assert_eq!(c.mint(accounts(0), U128(10_000_000_000 * 10u128.pow(8))).0, 1_000_000_000_000_000_000);
    }

    #[test]
    fn transfer_between_registered_accounts() {
        let mut c = setup(18);
        ctx(accounts(0), NearToken::from_yoctonear(0));
        c.mint(accounts(0), U128(1000));
        let min = min_storage(&c);
        ctx(accounts(1), min);
        c.storage_deposit(None, Some(true));
        ctx(accounts(0), NearToken::from_yoctonear(1));
        c.ft_transfer(accounts(1), U128(400), None);
        assert_eq!(c.ft_balance_of(accounts(0)).0, 600);
        assert_eq!(c.ft_balance_of(accounts(1)).0, 400);
    }
}
