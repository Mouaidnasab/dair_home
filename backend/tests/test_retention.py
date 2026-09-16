import gzip

from app import retention, rollups
from app.store import Store


def _day_samples(sn, day, grid_w=500.0):
    start, _ = rollups.day_bounds(day)
    return [{"device_sn": sn, "ts": start + i * 300, "pv_w": 1000.0, "load_w": 700.0, "grid_w": grid_w,
             "bat_w": 100.0, "soc": 60.0, "grid_v": 220.0} for i in range(288)]


def _seed(store: Store, days):
    for day in days:
        batch = _day_samples("020308004825320226", day)
        store.insert_samples(batch)
        rollups.refresh_many(store, rollups.spans_of(batch))


def test_rollups_survive_raw_deletion(store, tmp_path):
    days = ["2026-01-01", "2026-01-02", "2026-06-01"]
    _seed(store, days)
    before = [tuple(r) for r in store.query("SELECT * FROM rollup_daily ORDER BY day")]
    hourly_before = store.scalar("SELECT COUNT(*) FROM rollup_hourly")
    assert before[0][4] > 11.9  # grid_kwh ~ 0.5 kW * 24 h

    now = rollups.day_bounds("2026-06-02")[0] + 3600
    dry = retention.run(store, raw_days=30, dry_run=True, now=now, log=lambda *a: None)
    assert dry["rows_older"] == 576 and store.count_samples() == 864

    rep = retention.run(store, raw_days=30, archive_dir=tmp_path / "archive", now=now, log=lambda *a: None)
    assert rep["deleted"] == 576
    assert store.count_samples() == 288
    assert [tuple(r) for r in store.query("SELECT * FROM rollup_daily ORDER BY day")] == before
    assert store.scalar("SELECT COUNT(*) FROM rollup_hourly") == hourly_before

    # a later refresh that reaches back past the cutoff must not wipe the old rollups
    rollups.refresh(store, "020308004825320226", rollups.day_bounds("2026-01-01")[0], now)
    assert [tuple(r) for r in store.query("SELECT * FROM rollup_daily ORDER BY day")] == before

    files = rep["archived_files"]
    assert len(files) == 1 and "2026-01" in files[0]
    with gzip.open(files[0], "rt") as f:
        assert sum(1 for _ in f) == 577  # header + 576 rows

    again = retention.run(store, raw_days=30, now=now, log=lambda *a: None)
    assert again["deleted"] == 0
