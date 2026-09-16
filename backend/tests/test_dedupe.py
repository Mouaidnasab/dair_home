import asyncio


from app.collector import Collector


def test_repeated_datatime_stores_one_row(settings, topology, store, clock, cloud):
    c = Collector(settings, topology, store, cloud, clock=clock)
    c.load_state()
    clock.advance(90)  # 00:02:00 — the next four polls all see the 00:00 report
    for _ in range(4):  # four polls inside the same 5-minute report window
        for d in topology.devices:
            c.next_due[d.sn] = 0
        asyncio.run(c.tick())
        clock.advance(30)
    asyncio.run(c.flush())
    for d in topology.devices:
        assert store.count_samples(d.sn) == 1


def test_store_insert_is_idempotent(store):
    s = {"device_sn": "x", "ts": 1}
    assert store.insert_samples([s, s]) == 1
    assert store.insert_samples([s]) == 0


def test_failures_are_not_stored_and_logged_once(settings, topology, store, clock, cloud, caplog):
    cloud.fail = {d.sn for d in topology.devices}
    c = Collector(settings, topology, store, cloud, clock=clock)
    c.load_state()
    for _ in range(5):
        for d in topology.devices:
            c.next_due[d.sn] = 0
        asyncio.run(c.tick())
    asyncio.run(c.flush())
    assert store.count_samples() == 0
    assert len([r for r in caplog.records if "failed" in r.getMessage()]) == len(topology.devices)
