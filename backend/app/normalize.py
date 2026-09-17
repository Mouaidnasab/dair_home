"""Turn Felicity payloads (live snapshot, history list, legacy CSV rows) into narrow samples.

A sample is a dict with the SAMPLE_COLUMNS keys. Units: W, V, A, Hz, %, °C, kWh.
bat_w is positive while charging, negative while discharging.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

from .config import Device, parse_utc_offset

SAMPLE_COLUMNS = (
    "pv_w", "load_w", "grid_w", "grid_v", "grid_hz", "out_v",
    "bat_w", "soc", "bat_v", "bat_a", "soh", "temp_c", "inv_temp_c",
    "cell_v_max", "cell_v_min", "e_pv_today", "e_load_today", "work_mode",
)

# Felicity's epoch `dataTime` is the device-local clock string read as China time (UTC+8).
_CLOUD_OFFSET = timedelta(hours=8)

INVERTER_FIELDS = {
    "pv_w": ("pvTotalPower",),
    "load_w": ("acTotalOutActPower",),
    "grid_w": ("acTtlInpower", "acTtlInPower"),
    "grid_v": ("acRInVolt",),
    "grid_hz": ("acRInFreq",),
    "out_v": ("acROutVolt",),
    "bat_w": ("emsPower",),
    "soc": ("emsSoc",),
    "bat_v": ("emsVoltage",),
    "bat_a": ("emsCurrent",),
    "inv_temp_c": ("devTempMax",),
    "e_pv_today": ("ePvToday",),
    "e_load_today": ("eLoadToday",),
    "work_mode": ("workMode",),
}

BATTERY_FIELDS = {
    "bat_w": ("bmsPower",),
    "soc": ("battSoc", "emsSoc"),
    "soh": ("battSoh", "emsSoh"),
    "bat_v": ("battVolt",),
    "bat_a": ("battCurr",),
    "temp_c": ("tempMax",),
    "cell_v_max": ("maxVoltage2bms",),
    "cell_v_min": ("minVoltage2bms",),
}


def to_float(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if f != f else f  # NaN


def cell_volts(v: Any) -> float | None:
    """Cell voltages arrive in V (3.47) on older firmware and mV (3313) on newer: normalize to V."""
    f = to_float(v)
    if f is None or f <= 0:
        return None
    if f > 100:
        f = f / 1000.0
    return round(f, 3)


def local_str_to_ts(s: str, tz: str | timezone) -> int | None:
    """'2026-09-17 00:30:00' in the device clock -> unix seconds (UTC)."""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.strip().replace("T", " "))
    except ValueError:
        return None
    off = tz if isinstance(tz, timezone) else parse_utc_offset(tz)
    return int(dt.replace(tzinfo=off).timestamp())


def cloud_epoch_to_ts(epoch_ms: Any, tz: str | timezone) -> int | None:
    f = to_float(epoch_ms)
    if not f:
        return None
    off = tz if isinstance(tz, timezone) else parse_utc_offset(tz)
    return int(f / 1000 + _CLOUD_OFFSET.total_seconds() - off.utcoffset(None).total_seconds())


def _pick(data: Mapping[str, Any], keys: tuple[str, ...]) -> Any:
    for k in keys:
        if data.get(k) not in (None, ""):
            return data[k]
    return None


def _map(kind: str, data: Mapping[str, Any]) -> dict[str, Any]:
    fields = INVERTER_FIELDS if kind == "inverter" else BATTERY_FIELDS
    out: dict[str, Any] = {c: None for c in SAMPLE_COLUMNS}
    for col, keys in fields.items():
        raw = _pick(data, keys)
        if col.startswith("cell_v"):
            out[col] = cell_volts(raw)
        elif col == "work_mode":
            f = to_float(raw)
            out[col] = int(f) if f is not None else None
        else:
            out[col] = to_float(raw)
    return out


def _has_telemetry(sample: Mapping[str, Any]) -> bool:
    return any(sample.get(c) is not None for c in SAMPLE_COLUMNS)


def from_snapshot(device: Device, data: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """Live `get_device_snapshot` data -> sample (or None when the payload has no sample time)."""
    if not data:
        return None
    tz = data.get("timeZone") or device.tz
    ts = local_str_to_ts(data.get("dataTimeStr") or "", tz) or cloud_epoch_to_ts(data.get("dataTime"), tz)
    if ts is None:
        return None
    sample = _map(device.kind, data)
    if not _has_telemetry(sample):
        return None
    return {"device_sn": device.sn, "ts": ts, **sample}


def from_history(device: Device, row: Mapping[str, Any]) -> dict[str, Any] | None:
    """One row of `list_storageRealtimeData_new` -> sample. Rows carry no timeZone: use the device's."""
    ts = local_str_to_ts(row.get("deviceDataTime") or row.get("dataTime") or "", device.tz)
    if ts is None:
        return None
    sample = _map(device.kind, row)
    if device.kind == "battery":
        # History nests BMS values; flat maxVoltage2bms is in V there.
        entity = row.get("battInfoEntity") or {}
        for col, key in (("cell_v_max", "maxVoltage2bms"), ("cell_v_min", "minVoltage2bms")):
            if sample[col] is None:
                sample[col] = cell_volts(entity.get(key))
    if not _has_telemetry(sample):
        return None
    return {"device_sn": device.sn, "ts": ts, **sample}


# ---------------- legacy CSV rows (backend v1) ----------------

_PREFIX_RE = re.compile(r"^(pd|ef|data|hist)_")


def from_legacy_plant_row(device: Device, row: Mapping[str, str]) -> dict[str, Any] | None:
    """Row of <Label>_<plantId>_<day>.csv (plantDetails pd_* + energy flow ef_*) -> inverter sample."""
    if row.get("pd_code") != "200" or row.get("ef_code") != "200":
        return None
    tz = row.get("ef_timeZone") or row.get("pd_timeZone") or device.tz
    ts = local_str_to_ts(row.get("ef_dataTimeStr") or "", tz) or cloud_epoch_to_ts(row.get("ef_dataTime"), tz)
    if ts is None:
        return None
    ef = {k[3:]: v for k, v in row.items() if k.startswith("ef_")}
    if ef.get("pvTotalPower") in (None, ""):
        ef["pvTotalPower"] = row.get("pd_pvTotalPower")
    sample = _map("inverter", ef)
    if not _has_telemetry(sample):
        return None
    return {"device_sn": device.sn, "ts": ts, **sample}


def from_legacy_battery_row(device: Device, row: Mapping[str, str]) -> dict[str, Any] | None:
    """Row of <Label>_<batterySn>_<day>.csv (snapshot data_* or backfilled hist_*) -> sample."""
    if row.get("dataType") == "Historical_List" or any(k.startswith("hist_") for k in row if row[k]):
        hist = {k[5:]: v for k, v in row.items() if k.startswith("hist_") and v not in (None, "")}
        return from_history(device, hist) if hist else None
    if row.get("code") != "200":
        return None
    data = {k[5:]: v for k, v in row.items() if k.startswith("data_")}
    return from_snapshot(device, data)
