//! Integration test against a local NEAR sandbox: init, reporter-only writes,
//! the on-chain ring buffer and the emitted event. Requires network access once
//! to fetch the sandbox binary.
use serde_json::json;

fn snapshot(pair_id: &str, source: &str, cost_bps: i32, status: &str) -> serde_json::Value {
    json!({
        "pair_id": pair_id,
        "source": source,
        "amount_in_usd": 100_000u32,
        "cost_bps": cost_bps,
        "eta_s": null,
        "status": status,
    })
}

#[tokio::test]
async fn registry_on_sandbox() -> Result<(), Box<dyn std::error::Error>> {
    let wasm = near_workspaces::compile_project("./").await?;
    let sandbox = near_workspaces::sandbox().await?;
    let contract = sandbox.dev_deploy(&wasm).await?;
    let reporter = sandbox.dev_create_account().await?;
    let stranger = sandbox.dev_create_account().await?;

    contract
        .call("new")
        .args_json(json!({ "owner": contract.id(), "reporter": reporter.id() }))
        .transact()
        .await?
        .into_result()?;

    let owner: String = contract.view("get_owner").await?.json()?;
    assert_eq!(owner, contract.id().as_str());
    let recorded_reporter: String = contract.view("get_reporter").await?.json()?;
    assert_eq!(recorded_reporter, reporter.id().as_str());

    let outcome = reporter
        .call(contract.id(), "record_snapshots")
        .args_json(json!({
            "snapshots": [
                snapshot("USDC:near>USDT:near", "near-intents", 0, "no_liquidity"),
                snapshot("USDC:near>USDT:near", "rhea", 17, "ok"),
            ]
        }))
        .transact()
        .await?
        .into_result()?;
    assert!(outcome.logs().iter().any(|line| line.contains("EVENT_JSON:")));
    assert!(outcome.logs().iter().any(|line| line.contains("\"standard\":\"radiri\"")));

    let best: serde_json::Value = contract
        .view("get_latest")
        .args_json(json!({ "pair_id": "USDC:near>USDT:near", "source": null }))
        .await?
        .json()?;
    assert_eq!(best["source"], "rhea");
    assert_eq!(best["status"], "ok");
    assert_eq!(best["cost_bps"], 17);

    let intents: serde_json::Value = contract
        .view("get_latest")
        .args_json(json!({ "pair_id": "USDC:near>USDT:near", "source": "near-intents" }))
        .await?
        .json()?;
    assert_eq!(intents["status"], "no_liquidity");

    let history: serde_json::Value = contract
        .view("get_history")
        .args_json(json!({ "pair_id": "USDC:near>USDT:near", "source": "rhea", "limit": null }))
        .await?
        .json()?;
    let history = history.as_array().expect("get_history returns an array");
    assert_eq!(history.len(), 1);
    assert_eq!(history[0]["source"], "rhea");

    let count: u32 = contract.view("get_latest_count").await?.json()?;
    assert_eq!(count, 2);

    let denied = stranger
        .call(contract.id(), "record_snapshots")
        .args_json(json!({ "snapshots": [snapshot("p", "rhea", 1, "ok")] }))
        .transact()
        .await?;
    assert!(denied.is_failure(), "a non-reporter must not be able to record");

    let denied_rotate = stranger
        .call(contract.id(), "set_reporter")
        .args_json(json!({ "reporter": stranger.id() }))
        .transact()
        .await?;
    assert!(denied_rotate.is_failure(), "only the owner may rotate the reporter");

    contract
        .call("set_reporter")
        .args_json(json!({ "reporter": stranger.id() }))
        .transact()
        .await?
        .into_result()?;
    let rotated: String = contract.view("get_reporter").await?.json()?;
    assert_eq!(rotated, stranger.id().as_str());

    Ok(())
}
