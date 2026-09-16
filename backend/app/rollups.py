"""Hourly and daily energy rollups computed from samples.

Energy is the trapezoid integral between consecutive samples. Each segment is attributed to the
hour its first sample falls in, so a day's total is exactly the sum of its hours. Segments longer
than MAX_GAP (device offline) are skipped rather than guessed.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Iterable

from .config import LOCAL_TZ
from .store import Store

MAX_GAP = 900
HOUR = 3600
GRID_UP_VOLTS = 100.0
ROLLUP_COLS = ("pv_kwh", "load_kwh", "grid_kwh", "bat_charge_kwh", "bat_discharge_kwh", "grid_up_s", "soc_min", "soc_max", "soc_avg", "samples")


def local_day(ts: int) -> str:
    return datetime.fromtimestamp(ts, LOCAL_TZ).date().isoformat()


def day_bounds(day: date | str) -> tuple[int, int]:
    d = date.fromisoformat(day) if isinstance(day, str) else day
    start = datetime(d.year, d.month, d.day, tzinfo=LOCAL_TZ)
    return int(start.timestamp()), int((start + timedelta(days=1)).timestamp())


def _empty() -> dict:
    return {"pv_kwh": 0.0, "load_kwh": 0.0, "grid_kwh": 0.0, "bat_charge_kwh": 0.0, "bat_discharge_kwh": 0.0,
            "grid_up_s": 0, "soc": [], "samples": 0}


def _trap(a: float | None, b: float | None, dt: float, sign: int = 1) -> float:
    if a is None or b is None:
        return 0.0
    a, b = max(sign * a, 0.0), max(sign * b, 0.0)
    return (a + b) / 2.0 * dt / 3_600_000.0  # W·s -> kWh


def compute_hourly(rows: list, start: int, end: int) -> dict[int, dict]:
    """rows: samples ordered by ts (may extend past `end` to close the last segment)."""
    buckets: dict[int, dict] = {}
    for i, r in enumerate(rows):
        ts = r["ts"]
        if not (start <= ts < end):
            continue
        b = buckets.setdefault(ts - ts % HOUR, _empty())
        b["samples"] += 1
        if r["soc"] is not None:
            b["soc"].append(r["soc"])
        if i + 1 >= len(rows):
            continue
        n = rows[i + 1]
        dt = n["ts"] - ts
        if dt <= 0 or dt > MAX_GAP:
            continue
        b["pv_kwh"] += _trap(r["pv_w"], n["pv_w"], dt)
        b["load_kwh"] += _trap(r["load_w"], n["load_w"], dt)
        b["grid_kwh"] += _trap(r["grid_w"], n["grid_w"], dt)
        b["bat_charge_kwh"] += _trap(r["bat_w"], n["bat_w"], dt)
        b["bat_discharge_kwh"] += _trap(r["bat_w"], n["bat_w"], dt, sign=-1)
        if (r["grid_v"] or 0) > GRID_UP_VOLTS and (n["grid_v"] or 0) > GRID_UP_VOLTS:
            b["grid_up_s"] += dt
    return buckets


def _finish(b: dict) -> tuple:
    soc = b["soc"]
    return (
        round(b["pv_kwh"], 5), round(b["load_kwh"], 5), round(b["grid_kwh"], 5),
        round(b["bat_charge_kwh"], 5), round(b["bat_discharge_kwh"], 5), int(b["grid_up_s"]),
        min(soc) if soc else None, max(soc) if soc else None,
        round(sum(soc) / len(soc), 2) if soc else None, b["samples"],
    )


def refresh(store: Store, sn: str, start_ts: int, end_ts: int) -> None:
    """Recompute rollups for every local day touching [start_ts, end_ts]. Never touches buckets
    older than the retention cutoff, whose raw samples are gone."""
    cutoff = int(store.kv_get("raw_cutoff_ts") or 0)
    # A new first sample of a day closes the previous day's last segment, so reach back MAX_GAP.
    first_day = max(day_bounds(local_day(max(start_ts - MAX_GAP, cutoff)))[0], cutoff)  # cutoff is a local midnight
    last_day_end = day_bounds(local_day(end_ts))[1]
    if first_day >= last_day_end:
        return
    rows = store.samples_between(sn, first_day, last_day_end + MAX_GAP)
    hourly = compute_hourly(rows, first_day, last_day_end)
    with store.transaction() as c:
        c.execute("DELETE FROM rollup_hourly WHERE device_sn=? AND bucket>=? AND bucket<?", (sn, first_day, last_day_end))
        c.executemany(
            f"INSERT INTO rollup_hourly (device_sn, bucket, {', '.join(ROLLUP_COLS)}) VALUES (?, ?, {', '.join('?' * len(ROLLUP_COLS))})",
            [(sn, bucket, *_finish(b)) for bucket, b in sorted(hourly.items())],
        )
        days = sorted({local_day(t) for t in range(first_day, last_day_end, HOUR)})
        c.execute("DELETE FROM rollup_daily WHERE device_sn=? AND day>=? AND day<=?", (sn, days[0], days[-1]))
        c.execute(
            """
            INSERT INTO rollup_daily (device_sn, day, pv_kwh, load_kwh, grid_kwh, bat_charge_kwh, bat_discharge_kwh,
                                      grid_up_s, soc_min, soc_max, soc_avg, samples)
            SELECT device_sn, date(bucket, 'unixepoch', ?) AS day,
                   ROUND(SUM(pv_kwh), 5), ROUND(SUM(load_kwh), 5), ROUND(SUM(grid_kwh), 5),
                   ROUND(SUM(bat_charge_kwh), 5), ROUND(SUM(bat_discharge_kwh), 5), SUM(grid_up_s),
                   MIN(soc_min), MAX(soc_max),
                   ROUND(SUM(soc_avg * samples) / NULLIF(SUM(CASE WHEN soc_avg IS NOT NULL THEN samples END), 0), 2),
                   SUM(samples)
            FROM rollup_hourly
            WHERE device_sn=? AND bucket>=? AND bucket<?
            GROUP BY day
            """,
            (_sqlite_offset(first_day), sn, first_day, last_day_end),
        )


def refresh_many(store: Store, spans: dict[str, tuple[int, int]]) -> None:
    """spans: sn -> (min_ts, max_ts) of newly written samples. One commit for all devices."""
    with store.transaction():
        for sn, (lo, hi) in spans.items():
            refresh(store, sn, lo, hi)


def spans_of(samples: Iterable[dict]) -> dict[str, tuple[int, int]]:
    spans: dict[str, tuple[int, int]] = {}
    for s in samples:
        lo, hi = spans.get(s["device_sn"], (s["ts"], s["ts"]))
        spans[s["device_sn"]] = (min(lo, s["ts"]), max(hi, s["ts"]))
    return spans


def _sqlite_offset(ts: int) -> str:
    """SQLite date() modifier for Asia/Damascus at `ts` (fixed +03:00 since 2022, but stay honest)."""
    off = datetime.fromtimestamp(ts, LOCAL_TZ).utcoffset() or timedelta(0)
    return f"{int(off.total_seconds() // 60):+d} minutes"
