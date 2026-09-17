import asyncio
import os

from app.collector import Collector


def _db_bytes(path):
    return sum(os.path.getsize(p) for p in (path, f"{path}-wal", f"{path}-shm") if os.path.exists(p))


def test_24h_of_collection_fits_the_sd_budget(settings, topology, store, clock, cloud):
    c = Collector(settings, topology, store, cloud, clock=clock)
    c.load_state()

    # warm-up (first poll + flush) so the budget measures steady state, not table creation
    asyncio.run(c.tick())
    clock.advance(settings.flush_interval)
    asyncio.run(c.tick())
    commits0, bytes0, calls0 = store.commits, _db_bytes(settings.db_path), cloud.calls
    main0 = os.path.getsize(settings.db_path)

    for _ in range(24 * 60):  # one scheduler tick per minute for a day
        clock.advance(settings.poll_tick)
        asyncio.run(c.tick())
    asyncio.run(c.flush())

    commits = store.commits - commits0
    growth = _db_bytes(settings.db_path) - bytes0
    per_device = store.count_samples() / len(topology.devices)
    main_growth = os.path.getsize(settings.db_path) - main0
    print(f"commits/day={commits} growth={growth}B main_db_growth={main_growth}B samples/device={per_device} cloud_calls={cloud.calls - calls0}")

    assert commits <= 100
    assert growth <= 5 * 1024 * 1024
    assert main_growth <= 1024 * 1024  # the database itself: ~1,440 narrow rows + rollups
    assert 280 <= per_device <= 292  # one row per 5-minute report, no duplicates
    assert cloud.calls - calls0 <= len(topology.devices) * 300  # ~1 call per report, not one per minute
    assert not list(settings.data_dir.rglob("*.csv"))
