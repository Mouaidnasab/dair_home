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
