import json

from app.config import BACKEND_DIR


def test_topology_matches_discovery(topology):
    discovered = json.loads((BACKEND_DIR / "tools" / "discovery_output.json").read_text())
    assert {d["deviceSn"] for d in discovered["devices"]} == {d.sn for d in topology.devices}
    assert {p["id"] for p in discovered["plants"]} == {p.id for p in topology.plants}


def test_zones_and_shared_battery(topology):
    assert topology.zones == ["ground", "first", "garden"]
    assert [d.sn for d in topology.inverters("garden")] == ["020308004825441198"]
    assert [d.sn for d in topology.batteries("garden")] == ["072604820026022401"]
    shared = topology.device("072604830025322349")
    assert set(shared.zones) == {"first", "ground"}
    assert [d.sn for d in topology.batteries("ground")] == ["072604830025322349"]
    # every inverter belongs to exactly one zone, so zone energy never double counts
    assert all(len(d.zones) == 1 for d in topology.inverters())


def test_home_and_garden_are_separate_systems(topology):
    assert topology.systems == ["home", "garden"]
    assert topology.system_zones("home") == ["ground", "first"]
    assert topology.system_zones("garden") == ["garden"]
