//! Radiri: on-chain record of cross-chain stablecoin route snapshots.
//!
//! An off-chain monitor (the `reporter`) periodically quotes stablecoin routes
//! (NEAR Intents, Rhea) and records the results here. Anyone can read the latest
//! snapshot per pair/source and a short rolling history.
use near_sdk::serde_json::json;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

/// Max snapshots kept per `pair_id|source` key.
pub const HISTORY_CAP: usize = 48;
/// Max snapshots accepted in one `record_snapshots` call.
pub const MAX_BATCH: usize = 50;
/// Max length of a `pair_id`, in bytes.
pub const MAX_PAIR_ID_LEN: usize = 64;
/// Max page size for `get_all_latest`.
pub const MAX_PAGE: u32 = 100;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    #[serde(rename = "near-intents")]
    NearIntents,
    #[serde(rename = "rhea")]
    Rhea,
}

impl Source {
    pub const ALL: [Source; 2] = [Source::NearIntents, Source::Rhea];

    pub fn as_str(&self) -> &'static str {
        match self {
            Source::NearIntents => "near-intents",
            Source::Rhea => "rhea",
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    #[serde(rename = "ok")]
    Ok,
    #[serde(rename = "no_liquidity")]
    NoLiquidity,
    #[serde(rename = "error")]
    Error,
}

/// Argument shape for `record_snapshots`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SnapshotInput {
    pub pair_id: String,
    pub source: Source,
    pub amount_in_usd: u32,
    pub cost_bps: i32,
    pub eta_s: Option<u32>,
    pub status: Status,
}

/// Snapshot as returned by views. Matches `OnchainSnapshot` in `src/lib/radiri/types.ts`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Snapshot {
    pub pair_id: String,
    pub source: Source,
    pub amount_in_usd: u32,
    pub cost_bps: i32,
    pub eta_s: Option<u32>,
    pub status: Status,
    pub timestamp_ms: u64,
    pub block_height: u64,
}

/// Compact history entry (pair_id/source are implied by the storage key).
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Point {
    pub amount_in_usd: u32,
    pub cost_bps: i32,
    pub eta_s: Option<u32>,
    pub status: Status,
    pub timestamp_ms: u64,
    pub block_height: u64,
}

impl Point {
    fn from_snapshot(s: &Snapshot) -> Self {
        Self {
            amount_in_usd: s.amount_in_usd,
            cost_bps: s.cost_bps,
            eta_s: s.eta_s,
            status: s.status,
            timestamp_ms: s.timestamp_ms,
            block_height: s.block_height,
        }
    }

    fn to_snapshot(&self, pair_id: &str, source: Source) -> Snapshot {
        Snapshot {
            pair_id: pair_id.to_string(),
            source,
            amount_in_usd: self.amount_in_usd,
            cost_bps: self.cost_bps,
            eta_s: self.eta_s,
            status: self.status,
            timestamp_ms: self.timestamp_ms,
            block_height: self.block_height,
        }
    }
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Latest,
    History,
}

fn key(pair_id: &str, source: Source) -> String {
    format!("{}|{}", pair_id, source.as_str())
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    reporter: AccountId,
    /// Latest snapshot keyed `"{pair_id}|{source}"`.
    latest: IterableMap<String, Snapshot>,
    /// Oldest-first rolling history, capped at `HISTORY_CAP`, keyed like `latest`.
    history: LookupMap<String, Vec<Point>>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, reporter: AccountId) -> Self {
        Self {
            owner,
            reporter,
            latest: IterableMap::new(StorageKey::Latest),
            history: LookupMap::new(StorageKey::History),
        }
    }

    /// Owner-only: rotate the reporter account.
    pub fn set_reporter(&mut self, reporter: AccountId) {
        require!(
            env::predecessor_account_id() == self.owner,
            "Only the owner can call set_reporter"
        );
        self.reporter = reporter;
    }

    /// Reporter-only: record a batch of route snapshots. Returns the number recorded.
    pub fn record_snapshots(&mut self, snapshots: Vec<SnapshotInput>) -> u32 {
        require!(
            env::predecessor_account_id() == self.reporter,
            "Only the reporter can call record_snapshots"
        );
        require!(!snapshots.is_empty(), "snapshots must not be empty");
        require!(
            snapshots.len() <= MAX_BATCH,
            format!("Batch too large: max {} snapshots", MAX_BATCH)
        );
        for s in &snapshots {
            require!(!s.pair_id.is_empty(), "pair_id must not be empty");
            require!(
                s.pair_id.len() <= MAX_PAIR_ID_LEN,
                format!("pair_id must be at most {} bytes", MAX_PAIR_ID_LEN)
            );
            require!(!s.pair_id.contains('|'), "pair_id must not contain '|'");
        }

        let timestamp_ms = env::block_timestamp_ms();
        let block_height = env::block_height();
        let mut recorded = Vec::with_capacity(snapshots.len());

        for input in snapshots {
            let snap = Snapshot {
                pair_id: input.pair_id,
                source: input.source,
                amount_in_usd: input.amount_in_usd,
                cost_bps: input.cost_bps,
                eta_s: input.eta_s,
                status: input.status,
                timestamp_ms,
                block_height,
            };
            let k = key(&snap.pair_id, snap.source);

            let hist = self.history.entry(k.clone()).or_default();
            hist.push(Point::from_snapshot(&snap));
            if hist.len() > HISTORY_CAP {
                let overflow = hist.len() - HISTORY_CAP;
                hist.drain(..overflow);
            }

            self.latest.insert(k, snap.clone());
            recorded.push(snap);
        }

        let count = recorded.len() as u32;
        let event = json!({
            "standard": "radiri",
            "version": "1.0.0",
            "event": "snapshot",
            "data": recorded,
        });
        env::log_str(&format!("EVENT_JSON:{}", event));
        count
    }

    /// Latest snapshot for a pair. With `source`, returns that source's latest.
    /// Without, returns the cheapest (lowest `cost_bps`) `ok` snapshot across sources,
    /// falling back to the most recent snapshot of any status if none is `ok`.
    pub fn get_latest(&self, pair_id: String, source: Option<Source>) -> Option<Snapshot> {
        if let Some(src) = source {
            return self.latest.get(&key(&pair_id, src)).cloned();
        }
        let candidates: Vec<&Snapshot> = Source::ALL
            .iter()
            .filter_map(|s| self.latest.get(&key(&pair_id, *s)))
            .collect();
        candidates
            .iter()
            .filter(|s| s.status == Status::Ok)
            .min_by_key(|s| s.cost_bps)
            .or_else(|| candidates.iter().max_by_key(|s| s.timestamp_ms))
            .map(|s| (*s).clone())
    }

    /// Page through all latest snapshots (one per pair|source). `limit` defaults to and is capped at 100.
    pub fn get_all_latest(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Snapshot> {
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as usize;
        self.latest
            .values()
            .skip(from)
            .take(limit)
            .cloned()
            .collect()
    }

    /// Number of distinct pair|source keys with a latest snapshot.
    pub fn get_latest_count(&self) -> u32 {
        self.latest.len()
    }

    /// Up to `limit` (default and max 48) most recent snapshots for pair+source, oldest first.
    pub fn get_history(&self, pair_id: String, source: Source, limit: Option<u32>) -> Vec<Snapshot> {
        let limit = (limit.unwrap_or(HISTORY_CAP as u32) as usize).min(HISTORY_CAP);
        match self.history.get(&key(&pair_id, source)) {
            None => vec![],
            Some(points) => {
                let start = points.len().saturating_sub(limit);
                points[start..]
                    .iter()
                    .map(|p| p.to_snapshot(&pair_id, source))
                    .collect()
            }
        }
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn get_reporter(&self) -> AccountId {
        self.reporter.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(predecessor: AccountId, ts_ms: u64, height: u64) {
        let c = VMContextBuilder::new()
            .predecessor_account_id(predecessor)
            .block_timestamp(ts_ms * 1_000_000)
            .block_height(height)
            .build();
        testing_env!(c);
    }

    fn owner() -> AccountId {
        accounts(0)
    }
    fn reporter() -> AccountId {
        accounts(1)
    }
    fn stranger() -> AccountId {
        accounts(2)
    }

    fn setup() -> Contract {
        ctx(owner(), 1_000, 1);
        Contract::new(owner(), reporter())
    }

    fn input(pair: &str, source: Source, cost: i32, status: Status) -> SnapshotInput {
        SnapshotInput {
            pair_id: pair.to_string(),
            source,
            amount_in_usd: 1000,
            cost_bps: cost,
            eta_s: Some(30),
            status,
        }
    }

    #[test]
    fn init_and_getters() {
        let c = setup();
        assert_eq!(c.get_owner(), owner());
        assert_eq!(c.get_reporter(), reporter());
        assert!(c.get_all_latest(None, None).is_empty());
        assert_eq!(c.get_latest("x".into(), None), None);
        assert!(c.get_history("x".into(), Source::Rhea, None).is_empty());
    }

    #[test]
    fn reporter_records_and_stamps() {
        let mut c = setup();
        ctx(reporter(), 5_000, 42);
        let n = c.record_snapshots(vec![input("USDC:eth>USDT:arb", Source::NearIntents, 12, Status::Ok)]);
        assert_eq!(n, 1);
        let s = c
            .get_latest("USDC:eth>USDT:arb".into(), Some(Source::NearIntents))
            .unwrap();
        assert_eq!(s.timestamp_ms, 5_000);
        assert_eq!(s.block_height, 42);
        assert_eq!(s.cost_bps, 12);

        let logs = get_logs();
        assert_eq!(logs.len(), 1);
        let ev: near_sdk::serde_json::Value =
            near_sdk::serde_json::from_str(logs[0].strip_prefix("EVENT_JSON:").unwrap()).unwrap();
        assert_eq!(ev["standard"], "radiri");
        assert_eq!(ev["version"], "1.0.0");
        assert_eq!(ev["event"], "snapshot");
        assert_eq!(ev["data"][0]["source"], "near-intents");
        assert_eq!(ev["data"][0]["status"], "ok");
        assert_eq!(ev["data"][0]["block_height"], 42);
    }

    #[test]
    fn json_shape_matches_ts() {
        let s = Snapshot {
            pair_id: "p".into(),
            source: Source::Rhea,
            amount_in_usd: 10,
            cost_bps: -3,
            eta_s: None,
            status: Status::NoLiquidity,
            timestamp_ms: 1,
            block_height: 2,
        };
        let v = near_sdk::serde_json::to_value(&s).unwrap();
        assert_eq!(
            v,
            json!({"pair_id":"p","source":"rhea","amount_in_usd":10,"cost_bps":-3,
                   "eta_s":null,"status":"no_liquidity","timestamp_ms":1,"block_height":2})
        );
        let bad: Result<SnapshotInput, _> = near_sdk::serde_json::from_value(json!({
            "pair_id":"p","source":"uniswap","amount_in_usd":1,"cost_bps":1,"eta_s":null,"status":"ok"
        }));
        assert!(bad.is_err());
        let bad: Result<SnapshotInput, _> = near_sdk::serde_json::from_value(json!({
            "pair_id":"p","source":"rhea","amount_in_usd":1,"cost_bps":1,"eta_s":null,"status":"pending"
        }));
        assert!(bad.is_err());
    }

    #[test]
    #[should_panic(expected = "Only the reporter can call record_snapshots")]
    fn stranger_cannot_record() {
        let mut c = setup();
        ctx(stranger(), 1, 1);
        c.record_snapshots(vec![input("p", Source::Rhea, 1, Status::Ok)]);
    }

    #[test]
    #[should_panic(expected = "Only the reporter can call record_snapshots")]
    fn owner_cannot_record() {
        let mut c = setup();
        ctx(owner(), 1, 1);
        c.record_snapshots(vec![input("p", Source::Rhea, 1, Status::Ok)]);
    }

    #[test]
    #[should_panic(expected = "Only the owner can call set_reporter")]
    fn stranger_cannot_set_reporter() {
        let mut c = setup();
        ctx(stranger(), 1, 1);
        c.set_reporter(stranger());
    }

    #[test]
    fn owner_rotates_reporter() {
        let mut c = setup();
        ctx(owner(), 1, 1);
        c.set_reporter(stranger());
        assert_eq!(c.get_reporter(), stranger());
        ctx(stranger(), 2, 2);
        c.record_snapshots(vec![input("p", Source::Rhea, 1, Status::Ok)]);
        assert_eq!(c.get_latest_count(), 1);
    }

    #[test]
    #[should_panic(expected = "pair_id must not be empty")]
    fn rejects_empty_pair() {
        let mut c = setup();
        ctx(reporter(), 1, 1);
        c.record_snapshots(vec![input("", Source::Rhea, 1, Status::Ok)]);
    }

    #[test]
    #[should_panic(expected = "pair_id must be at most 64 bytes")]
    fn rejects_long_pair() {
        let mut c = setup();
        ctx(reporter(), 1, 1);
        c.record_snapshots(vec![input(&"a".repeat(65), Source::Rhea, 1, Status::Ok)]);
    }

    #[test]
    fn accepts_64_byte_pair() {
        let mut c = setup();
        ctx(reporter(), 1, 1);
        c.record_snapshots(vec![input(&"a".repeat(64), Source::Rhea, 1, Status::Ok)]);
    }

    #[test]
    #[should_panic(expected = "pair_id must not contain '|'")]
    fn rejects_pipe_in_pair() {
        let mut c = setup();
        ctx(reporter(), 1, 1);
        c.record_snapshots(vec![input("a|b", Source::Rhea, 1, Status::Ok)]);
    }

    #[test]
    #[should_panic(expected = "Batch too large: max 50 snapshots")]
    fn rejects_big_batch() {
        let mut c = setup();
        ctx(reporter(), 1, 1);
        let batch = (0..51)
            .map(|i| input(&format!("p{i}"), Source::Rhea, 1, Status::Ok))
            .collect();
        c.record_snapshots(batch);
    }

    #[test]
    #[should_panic(expected = "snapshots must not be empty")]
    fn rejects_empty_batch() {
        let mut c = setup();
        ctx(reporter(), 1, 1);
        c.record_snapshots(vec![]);
    }

    #[test]
    fn invalid_entry_rejects_whole_batch() {
        let mut c = setup();
        ctx(reporter(), 1, 1);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.record_snapshots(vec![
                input("good", Source::Rhea, 1, Status::Ok),
                input("", Source::Rhea, 1, Status::Ok),
            ])
        }));
        assert!(r.is_err());
        // Validation happens before any write.
        assert_eq!(c.get_latest_count(), 0);
    }

    #[test]
    fn ring_buffer_caps_at_48() {
        let mut c = setup();
        for i in 0..60u64 {
            ctx(reporter(), 1_000 + i, 10 + i);
            c.record_snapshots(vec![input("p", Source::NearIntents, i as i32, Status::Ok)]);
        }
        let h = c.get_history("p".into(), Source::NearIntents, None);
        assert_eq!(h.len(), 48);
        assert_eq!(h.first().unwrap().cost_bps, 12); // oldest kept
        assert_eq!(h.last().unwrap().cost_bps, 59); // newest
        assert_eq!(h[0].pair_id, "p");
        assert_eq!(h[0].source, Source::NearIntents);

        let h5 = c.get_history("p".into(), Source::NearIntents, Some(5));
        assert_eq!(h5.iter().map(|s| s.cost_bps).collect::<Vec<_>>(), vec![55, 56, 57, 58, 59]);
        let h_big = c.get_history("p".into(), Source::NearIntents, Some(1000));
        assert_eq!(h_big.len(), 48);
        // Other source untouched.
        assert!(c.get_history("p".into(), Source::Rhea, None).is_empty());
        // Latest tracks the newest.
        assert_eq!(c.get_latest("p".into(), Some(Source::NearIntents)).unwrap().cost_bps, 59);
        assert_eq!(c.get_latest_count(), 1);
    }

    #[test]
    fn best_across_sources() {
        let mut c = setup();
        ctx(reporter(), 1, 1);
        c.record_snapshots(vec![
            input("p", Source::NearIntents, 20, Status::Ok),
            input("p", Source::Rhea, 8, Status::Ok),
        ]);
        let best = c.get_latest("p".into(), None).unwrap();
        assert_eq!(best.source, Source::Rhea);

        // Cheaper but not ok -> ignored.
        ctx(reporter(), 2, 2);
        c.record_snapshots(vec![input("p", Source::Rhea, -5, Status::Error)]);
        let best = c.get_latest("p".into(), None).unwrap();
        assert_eq!(best.source, Source::NearIntents);
        assert_eq!(best.cost_bps, 20);

        // No ok at all -> most recent snapshot.
        ctx(reporter(), 3, 3);
        c.record_snapshots(vec![input("p", Source::NearIntents, 0, Status::NoLiquidity)]);
        let best = c.get_latest("p".into(), None).unwrap();
        assert_eq!(best.source, Source::NearIntents);
        assert_eq!(best.status, Status::NoLiquidity);
    }

    #[test]
    fn pagination() {
        let mut c = setup();
        ctx(reporter(), 1, 1);
        let batch: Vec<_> = (0..50)
            .map(|i| input(&format!("p{i:02}"), Source::Rhea, i, Status::Ok))
            .collect();
        c.record_snapshots(batch);
        ctx(reporter(), 2, 2);
        let batch: Vec<_> = (0..50)
            .map(|i| input(&format!("p{i:02}"), Source::NearIntents, i, Status::Ok))
            .collect();
        c.record_snapshots(batch);
        ctx(reporter(), 3, 3);
        let batch: Vec<_> = (50..70)
            .map(|i| input(&format!("p{i:02}"), Source::Rhea, i, Status::Ok))
            .collect();
        c.record_snapshots(batch);

        assert_eq!(c.get_latest_count(), 120);
        assert_eq!(c.get_all_latest(None, None).len(), 100);
        assert_eq!(c.get_all_latest(None, Some(500)).len(), 100);
        assert_eq!(c.get_all_latest(Some(100), None).len(), 20);
        assert_eq!(c.get_all_latest(Some(10), Some(5)).len(), 5);
        assert!(c.get_all_latest(Some(500), None).is_empty());

        let mut all = c.get_all_latest(Some(0), Some(60));
        all.extend(c.get_all_latest(Some(60), Some(60)));
        let mut keys: Vec<_> = all.iter().map(|s| key(&s.pair_id, s.source)).collect();
        keys.sort();
        keys.dedup();
        assert_eq!(keys.len(), 120);
    }
}
