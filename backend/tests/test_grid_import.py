"""C1: grid kWh read 0.0 for every 2026 day.

Investigation (2026-09-17, cloud history for all three inverters on 2026-02-05, 04-20, 07-15,
09-10 and 09-15): `acTtlInpower` is 0 on every 5-minute sample, the inverters run in work mode 3
(off-grid, "Battery First (SBU)"), and battery SoC never went below 30 %. Grid import really was
zero, so the field is still the right one; October 2025 shows real import through it.
"""
import asyncio

from fastapi.testclient import TestClient

from app import billing, migrate, normalize
from app.api import Services, create_app
from app.collector import Collector
from tests.conftest import FIXTURES, PAYLOADS


def test_oct_2025_grid_import_survives_migration(settings, topology, store):
    results = migrate.migrate_csv(store, topology, FIXTURES / "legacy", log=lambda *a: None)
    assert all(r.ok for r in results)
    app = create_app(Services(settings, topology, store, None, billing.Rates()), start_background=False)
    with TestClient(app) as c:
        day = c.get("/api/v1/energy", params={"period": "day", "date": "2025-10-22"}).json()
    # v1 computed 2.76 kWh by integrating 30-second duplicate rows; one row per real report gives ~3.1
    assert abs(day["totals"]["grid_kwh"] - 2.76) / 2.76 < 0.15
    assert day["bill"]["amount"] > 0


def test_collector_persists_grid_input_power(settings, topology, store, clock, cloud):
    cloud.grid_w = 1500.0
    c = Collector(settings, topology, store, cloud, clock=clock)
    c.load_state()
    for _ in range(4):
        asyncio.run(c.tick())
        clock.advance(300)
    asyncio.run(c.flush())
    inv = "020308004825320226"
    assert {r[0] for r in store.query("SELECT grid_w FROM samples WHERE device_sn=?", (inv,))} == {1500.0}
    assert store.scalar("SELECT SUM(grid_kwh) FROM rollup_hourly WHERE device_sn=?", (inv,)) > 0


def test_2026_firmware_field_name_maps_to_grid(topology):
    inv = topology.device("020308004825441198")
    snap = dict(PAYLOADS["snapshot_inverter"], acTtlInpower="850")
    assert normalize.from_snapshot(inv, snap)["grid_w"] == 850.0
    # the recorded 2026 history really has zero import
    assert normalize.from_history(inv, PAYLOADS["history_inverter"][0])["grid_w"] == 0.0
