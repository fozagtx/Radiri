//! Roles and the global pause.
//!
//! - owner: registers/updates assets, sets reporters and the guardian, forces prices, unpauses.
//!   Every owner method requires 1 yoctoNEAR, so only a full-access key can call it.
//! - guardian: may `pause()` (as may the owner). `pause` takes no deposit so a guardian bot can
//!   hold a function-call key limited to it.
//! - oracle reporters: may `report_prices` (no deposit, function-call key friendly).
//!
//! Global pause blocks deposit_collateral, supply, borrow, withdraw_collateral and
//! withdraw_supply. Repay, liquidation, price reports and transfer callbacks stay open.
use crate::events::emit;
use crate::{Contract, ContractExt, CLOSE_FACTOR_BPS};
use near_sdk::serde_json::json;
use near_sdk::{assert_one_yocto, env, near, require, AccountId};

/// Most oracle reporters accepted.
pub const MAX_REPORTERS: usize = 8;

/// `LendingConfigView` in `src/types/protocol.ts`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct LendingConfigView {
    pub owner_id: AccountId,
    pub guardian_id: AccountId,
    pub oracle_reporters: Vec<AccountId>,
    pub paused: bool,
    pub close_factor_bps: u16,
}

pub(crate) fn validate_reporters(reporters: &[AccountId]) {
    require!(reporters.len() <= MAX_REPORTERS, "At most 8 oracle reporters");
    for (i, r) in reporters.iter().enumerate() {
        require!(!reporters[..i].contains(r), "Duplicate oracle reporter");
    }
}

impl Contract {
    pub(crate) fn assert_owner(&self, method: &str) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            format!("Only the owner can call {}", method)
        );
    }

    pub(crate) fn assert_not_paused(&self) {
        require!(!self.paused, "Protocol is paused");
    }
}

#[near]
impl Contract {
    /// Owner only, 1 yoctoNEAR. Replaces the oracle reporter list (max 8, no duplicates).
    #[payable]
    pub fn set_oracle_reporters(&mut self, reporters: Vec<AccountId>) {
        assert_one_yocto();
        self.assert_owner("set_oracle_reporters");
        validate_reporters(&reporters);
        emit("oracle_reporters_updated", json!({ "oracle_reporters": &reporters }));
        self.oracle_reporters = reporters;
    }

    /// Owner only, 1 yoctoNEAR.
    #[payable]
    pub fn set_guardian(&mut self, guardian_id: AccountId) {
        assert_one_yocto();
        self.assert_owner("set_guardian");
        emit("guardian_updated", json!({ "guardian_id": &guardian_id }));
        self.guardian_id = guardian_id;
    }

    /// Owner or guardian. Global pause.
    pub fn pause(&mut self) {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.owner_id || caller == self.guardian_id,
            "Only the owner or the guardian can call pause"
        );
        if !self.paused {
            self.paused = true;
            emit("paused", json!({ "by": caller }));
        }
    }

    /// Owner only, 1 yoctoNEAR.
    #[payable]
    pub fn unpause(&mut self) {
        assert_one_yocto();
        self.assert_owner("unpause");
        if self.paused {
            self.paused = false;
            emit("unpaused", json!({ "by": env::predecessor_account_id() }));
        }
    }

    pub fn get_config(&self) -> LendingConfigView {
        LendingConfigView {
            owner_id: self.owner_id.clone(),
            guardian_id: self.guardian_id.clone(),
            oracle_reporters: self.oracle_reporters.clone(),
            paused: self.paused,
            close_factor_bps: CLOSE_FACTOR_BPS,
        }
    }
}
