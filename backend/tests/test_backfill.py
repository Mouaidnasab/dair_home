import asyncio

from app.collector import Collector


def test_backfill_fills_gap_since_last_sample(settings, topology, store, clock, cloud):
    c = Collector(settings, topology, store, cloud, clock=clock)
    c.load_state()
    asyncio.run(c.tick())
    asyncio.run(c.flush())
    before = store.count_samples()

    clock.advance(6 * 3600)  # the Pi was off for 6 hours
    c2 = Collector(settings, topology, store, cloud, clock=clock)
    c2.load_state()
    added = asyncio.run(c2.backfill())
    per_device = (store.count_samples() - before) / len(topology.devices)
    assert added == store.count_samples() - before
    assert 70 <= per_device <= 73  # 6 h of 5-minute reports
    assert asyncio.run(c2.backfill()) == 0  # nothing left to fill


def test_fresh_install_backfill_is_capped(settings, topology, store, clock, cloud):
    settings.backfill_max_days = 1
    c = Collector(settings, topology, store, cloud, clock=clock)
    c.load_state()
    asyncio.run(c.backfill())
    assert store.count_samples() / len(topology.devices) <= 289


def test_backfill_after_live_poll_still_fills_gap(settings, topology, store, clock, cloud):
    c = Collector(settings, topology, store, cloud, clock=clock)
    c.load_state()
    asyncio.run(c.tick())
    asyncio.run(c.flush())
    clock.advance(3 * 3600)
    c2 = Collector(settings, topology, store, cloud, clock=clock)
    c2.load_state()
    asyncio.run(c2.tick())  # startup polls first, so the newest sample is buffered but not stored
    assert asyncio.run(c2.backfill()) > 0


from datetime import timedelta as _td

from app import rollups as _rollups


def _days_ago(clock, n):
    return clock.now - n * 86400


def test_history_fills_holes_and_skips_complete_days(settings, topology, store, clock, cloud):
    settings.history_request_pause = 0
    cloud.history_start = _days_ago(clock, 20)
    inv = topology.device("020308004825441198")

    # Pre-seed a complete day 10 days ago for one device (as if migrated from CSV).
    c = Collector(settings, topology, store, cloud, clock=clock)
    c.load_state()
    day10 = (_rollups.datetime.fromtimestamp(_days_ago(clock, 10), inv.utc_offset)).date()
    seeded = asyncio.run(cloud.history(inv.sn, "OG", day10))
    from app import normalize
    store.insert_samples([normalize.from_history(inv, r) for r in seeded])
    cloud.history_days.clear()

    report = asyncio.run(c.backfill_history(max_empty_days=3))
    # the seeded complete day costs no request
    assert (inv.sn, day10) not in cloud.history_days
    assert report[inv.sn]["complete_days"] == 1
    # ~19 full days of history per device landed, rollups included
    per_device = store.count_samples(inv.sn) / 288
    assert 18.5 <= per_device <= 20.5
    assert store.scalar("SELECT COUNT(*) FROM rollup_daily WHERE device_sn=?", (inv.sn,)) >= 19
    # stopped after 3 empty days, marked complete, and the next run makes no requests
    assert all(r.get("oldest_day") for r in report.values())
    calls = cloud.history_calls
    again = asyncio.run(c.backfill_history(max_empty_days=3))
    assert cloud.history_calls == calls
    assert all(r == {"skipped": "already complete"} for r in again.values())


def test_history_respects_since_and_resumes_after_failure(settings, topology, store, clock, cloud):
    settings.history_request_pause = 0
    c = Collector(settings, topology, store, cloud, clock=clock)
    c.load_state()
    inv = topology.device("020308004825320226")
    today = _rollups.datetime.fromtimestamp(clock.now, inv.utc_offset).date()

    # the cloud fails on one day: the run stops there and keeps a cursor
    real_history = cloud.history
    broken_day = today - _td(days=4)

    attempts = []

    async def flaky(sn, t, day):
        if day == broken_day:
            attempts.append(sn)
            raise RuntimeError("timeout")
        return await real_history(sn, t, day)

    cloud.history = flaky
    asyncio.run(c.backfill_history(since=today - _td(days=8), max_empty_days=3))
    assert store.kv_get(f"history_cursor:{inv.sn}") == broken_day.isoformat()
    assert store.kv_get(f"history_done:{inv.sn}") is None
    assert attempts.count(inv.sn) == 3  # first try + two retries before giving up for this run

    cloud.history = real_history
    cloud.history_days.clear()
    asyncio.run(c.backfill_history(since=today - _td(days=8), max_empty_days=3))
    fetched = sorted({d for sn, d in cloud.history_days if sn == inv.sn})
    assert fetched[0] == today - _td(days=8) and fetched[-1] == broken_day  # resumed, never went past `since`
    assert store.kv_get(f"history_done:{inv.sn}") is not None
    assert store.count_samples(inv.sn) == 8 * 288


def test_history_stops_at_retention_cutoff(settings, topology, store, clock, cloud):
    settings.history_request_pause = 0
    inv = topology.device("020308004825320226")
    today = _rollups.datetime.fromtimestamp(clock.now, inv.utc_offset).date()
    cutoff_day = today - _td(days=5)
    store.kv_set("raw_cutoff_ts", str(_rollups.day_bounds(cutoff_day)[0]))
    c = Collector(settings, topology, store, cloud, clock=clock)
    c.load_state()
    asyncio.run(c.backfill_history(max_empty_days=30))
    assert min(d for sn, d in cloud.history_days if sn == inv.sn) >= cutoff_day


def test_transient_history_error_is_retried(settings, topology, store, clock, cloud):
    c = Collector(settings, topology, store, cloud, clock=clock)
    c.load_state()
    inv = topology.device("020308004825441198")
    today = _rollups.datetime.fromtimestamp(clock.now, inv.utc_offset).date()
    real_history, failed = cloud.history, set()

    async def once_flaky(sn, t, day):
        if (sn, day) not in failed:
            failed.add((sn, day))
            raise RuntimeError("peer closed connection")
        return await real_history(sn, t, day)

    cloud.history = once_flaky
    report = asyncio.run(c.backfill_history(since=today - _td(days=3), max_empty_days=3))
    assert all(r["inserted"] > 0 for r in report.values())
    assert store.kv_get(f"history_done:{inv.sn}") is not None
