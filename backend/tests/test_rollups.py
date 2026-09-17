from app import rollups


def test_daily_rollups_follow_local_days_across_old_dst_change(store):
    # Syria left DST on 2021-10-29 (+03:00 -> +02:00) before abolishing it in 2022.
    start, _ = rollups.day_bounds("2021-10-28")
    batch = [{"device_sn": "x", "ts": start + i * 300, "pv_w": 1000.0, "soc": 50.0} for i in range(288 * 3)]
    store.insert_samples(batch)
    rollups.refresh_many(store, rollups.spans_of(batch))
    rows = {r["day"]: r["samples"] for r in store.query("SELECT day, samples FROM rollup_daily ORDER BY day")}
    assert list(rows) == ["2021-10-28", "2021-10-29", "2021-10-30"]
    assert sum(rows.values()) == 288 * 3
    # re-running over the same range replaces rows instead of colliding
    rollups.refresh_many(store, rollups.spans_of(batch))
    assert store.scalar("SELECT SUM(samples) FROM rollup_daily") == 288 * 3
