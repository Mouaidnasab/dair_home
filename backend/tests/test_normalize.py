from datetime import datetime, timezone

from app import normalize
from tests.conftest import PAYLOADS


def test_cell_voltage_v_and_mv_normalize_to_volts():
    assert normalize.cell_volts("3.47") == 3.47
    assert normalize.cell_volts("3313") == 3.313
    assert normalize.cell_volts(3313) == 3.313
    assert normalize.cell_volts("0") is None
    assert normalize.cell_volts(None) is None


def test_snapshot_time_uses_device_clock(topology):
    inv = topology.device("020308004825441198")  # UTC+02:00 clock
    s = normalize.from_snapshot(inv, PAYLOADS["snapshot_inverter"])
    # '2026-09-17 00:30:00' at UTC+2 == 2026-09-16 22:30 UTC
    assert s["ts"] == int(datetime(2026, 9, 16, 22, 30, tzinfo=timezone.utc).timestamp())
    # the epoch field is the same local clock read as UTC+8
    assert normalize.cloud_epoch_to_ts(PAYLOADS["snapshot_inverter"]["dataTime"], "UTC+02:00") == s["ts"]
    assert s["load_w"] == 246 and s["bat_w"] == -259 and s["soc"] == 73 and s["grid_v"] == 215.2


def test_battery_snapshot_mv_cells(topology):
    bat = topology.device("072604820026022401")
    s = normalize.from_snapshot(bat, PAYLOADS["snapshot_battery"])
    assert s["cell_v_max"] == 3.313 and s["cell_v_min"] == 3.311
    assert s["soc"] == 73 and s["bat_w"] == -328.72 and s["pv_w"] is None


def test_history_rows(topology):
    inv = topology.device("020308004825441198")
    bat = topology.device("072604820026022401")
    si = normalize.from_history(inv, PAYLOADS["history_inverter"][0])
    sb = normalize.from_history(bat, PAYLOADS["history_battery"][0])
    assert si["ts"] == sb["ts"] == int(datetime(2026, 9, 16, 22, 30, tzinfo=timezone.utc).timestamp())
    assert sb["cell_v_max"] == 3.31  # nested battInfoEntity, already in volts


def test_failed_or_empty_rows_are_dropped(topology):
    bat = topology.device("072604830025322349")
    assert normalize.from_legacy_battery_row(bat, {"code": "998", "message": "Authentication failed"}) is None
    assert normalize.from_snapshot(bat, {}) is None
    assert normalize.from_snapshot(bat, {"dataTimeStr": "2026-09-17 00:30:00"}) is None  # no telemetry
