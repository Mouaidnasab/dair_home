import asyncio

import pytest
from fastapi.testclient import TestClient

from app import billing
from app.api import Services, create_app
from app.collector import Collector


class ExplodingStore:
    """Any disk access from /api/v1/live fails the test."""

    def __getattr__(self, name):
        raise AssertionError(f"/api/v1/live touched the store ({name})")


def test_live_is_served_from_ram(settings, topology, store, clock, cloud):
    c = Collector(settings, topology, store, cloud, clock=clock)
    c.load_state()
    asyncio.run(c.tick())
    c.store = ExplodingStore()
    app = create_app(Services(settings, topology, ExplodingStore(), c, billing.Rates()), start_background=False)
    with TestClient(app) as client:
        body = client.get("/api/v1/live").json()
    assert [z["zone"] for z in body["zones"]] == ["ground", "first", "garden"]
    ground = body["zones"][0]
    assert ground["battery_sns"] == ["072604830025322349"]  # shared battery shows up for ground too
    assert body["home"]["pv_w"] == 3600.0  # three inverters, batteries not double counted
    assert len(body["batteries"]) == 2
    assert body["batteries"][0]["zones"] == ["first", "ground"]
