import os

from fastapi.testclient import TestClient

from app import billing, rollups
from app.api import Services, create_app
from tests.test_retention import _day_samples


def _client(settings, topology, store, collector=None):
    svc = Services(settings, topology, store, collector, billing.Rates())
    return TestClient(create_app(svc, start_background=False))


def _seed_day(store, day):
    batch = []
    for sn in ("020308004825320226", "020308004825320563", "020308004825441198"):
        batch += _day_samples(sn, day, grid_w=0.0)
    for sn in ("072604830025322349", "072604820026022401"):
        batch += [dict(s, device_sn=sn, pv_w=None, load_w=None, grid_w=None) for s in _day_samples(sn, day)]
    store.insert_samples(batch)
    rollups.refresh_many(store, rollups.spans_of(batch))


def test_series_is_capped_and_aggregated(settings, topology, store):
    _seed_day(store, "2026-09-10")
    with _client(settings, topology, store) as c:
        home = c.get("/api/v1/series", params={"day": "2026-09-10"}).json()
        assert home["source"] == "samples"
        assert 0 < len(home["points"]) <= 300
        assert home["points"][0]["pv_w"] == 2000.0  # "home" system = ground + first inverters
        assert home["points"][0]["soc"] == 60.0  # shared battery only
        garden = c.get("/api/v1/series", params={"day": "2026-09-10", "zone": "garden"}).json()
        assert garden["points"][0]["pv_w"] == 1000.0
        fine = c.get("/api/v1/series", params={"day": "2026-09-10", "bucket": 60}).json()
        assert len(fine["points"]) <= 300 and fine["bucket"] >= 288
        one = c.get("/api/v1/series", params={"day": "2026-09-10", "sn": "072604820026022401"}).json()
        assert one["points"][0]["soc"] == 60.0
        assert c.get("/api/v1/series", params={"zone": "attic"}).status_code == 404
        ground = c.get("/api/v1/series", params={"day": "2026-09-10", "zone": "ground"}).json()
        assert ground["points"][0]["pv_w"] == 1000.0


def test_series_falls_back_to_hourly_rollups(settings, topology, store):
    _seed_day(store, "2026-01-05")
    store.conn.execute("DELETE FROM samples")
    with _client(settings, topology, store) as c:
        body = c.get("/api/v1/series", params={"day": "2026-01-05"}).json()
        assert body["source"] == "rollups" and len(body["points"]) == 24


def test_energy_and_cycles(settings, topology, store):
    _seed_day(store, "2026-09-10")
    with _client(settings, topology, store) as c:
        day = c.get("/api/v1/energy", params={"period": "day", "date": "2026-09-10"}).json()
        assert round(day["totals"]["pv_kwh"]) == 48  # home system: 2 kW for 24 h
        assert day["totals"]["grid_kwh"] == 0
        assert len(day["breakdown"]) == 24
        month = c.get("/api/v1/energy", params={"period": "month", "date": "2026-09-10", "zone": "garden"}).json()
        assert round(month["totals"]["pv_kwh"]) == 24
        assert c.get("/api/v1/energy", params={"period": "week"}).status_code == 400
        cycles = c.get("/api/v1/cycles").json()
        assert cycles["cycles"][0]["label"] == "Sep-Oct 2026"
        assert c.get("/api/v1/health").json()["schema_version"] >= 1
