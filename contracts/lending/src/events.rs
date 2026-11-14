//! NEP-297 events (`standard: "radiri-lending"`, `version: "1.0.0"`) and the per-account
//! activity ring buffer.
//!
//! Every log line is `EVENT_JSON:{"standard":"radiri-lending","version":"1.0.0","event":E,"data":[...]}`.
//! `data` is always an array; activity events carry exactly one object.
use crate::Contract;
use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, near, AccountId};

pub const EVENT_STANDARD: &str = "radiri-lending";
pub const EVENT_VERSION: &str = "1.0.0";
/// Activity entries kept per account (oldest dropped).
pub const ACTIVITY_CAP: usize = 32;

/// Emit one NEP-297 event with `data` as given (must already be an array).
pub(crate) fn emit_raw(event: &str, data: Value) {
    let ev = json!({
        "standard": EVENT_STANDARD,
        "version": EVENT_VERSION,
        "event": event,
        "data": data,
    });
    env::log_str(&format!("EVENT_JSON:{}", ev));
}

/// Emit one NEP-297 event whose `data` is a single-object array.
pub(crate) fn emit(event: &str, data: Value) {
    emit_raw(event, Value::Array(vec![data]));
}

/// What happened to an account. JSON values match `ActivityKind` in `src/types/protocol.ts`.
#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActivityKind {
    DepositCollateral,
    WithdrawCollateral,
    Supply,
    WithdrawSupply,
    Borrow,
    Repay,
    /// The account's collateral was seized (token_id = collateral token, amount = seized).
    Liquidated,
    /// The account liquidated someone (token_id = debt token, amount = repaid).
    Liquidate,
}

/// `ActivityEntry` in `src/types/protocol.ts`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ActivityEntry {
    pub kind: ActivityKind,
    pub token_id: AccountId,
    pub amount: U128,
    pub counterparty: Option<AccountId>,
    pub timestamp_ms: u64,
    pub block_height: u64,
}

impl Contract {
    /// Append an entry to the account's ring buffer (stored oldest first, capped at 32).
    pub(crate) fn record_activity(
        &mut self,
        account_id: &AccountId,
        kind: ActivityKind,
        token_id: &AccountId,
        amount: u128,
        counterparty: Option<&AccountId>,
    ) {
        let entry = ActivityEntry {
            kind,
            token_id: token_id.clone(),
            amount: U128(amount),
            counterparty: counterparty.cloned(),
            timestamp_ms: env::block_timestamp_ms(),
            block_height: env::block_height(),
        };
        let log = self.activity.entry(account_id.clone()).or_default();
        log.push(entry);
        if log.len() > ACTIVITY_CAP {
            let overflow = log.len() - ACTIVITY_CAP;
            log.drain(..overflow);
        }
    }
}
