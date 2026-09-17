"""Polls the Felicity cloud, keeps the newest reading per device in RAM and writes batches to SQLite.

SD-card rules: a device is polled only when its next report is due, repeated readings (same
upstream sample time) are dropped, failures are never stored, and samples are flushed in a single
transaction every `flush_interval` seconds. Anything lost from the buffer on a power cut is
re-fetched from the cloud's 5-minute history on the next start (`backfill`).
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import date, datetime, timedelta
from typing import Any, Callable, Protocol

from . import normalize, rollups
from .config import Device, Settings, Topology
from .store import Store

log = logging.getLogger(__name__)

META_KEYS = (
    "alias", "deviceModel", "firmwareVersion", "controlVersion", "timeZone", "reportFreq",
    "workModeStr", "oSPriStr", "cSPriStr", "batTyStr", "ratedPower", "batteryCapacity", "status",
)
DEFAULT_REPORT_FREQ = 300


class CloudClient(Protocol):
    async def snapshot(self, sn: str, device_type: str) -> dict: ...
    async def history(self, sn: str, device_type: str, day: date) -> list[dict]: ...


class Collector:
    def __init__(self, settings: Settings, topology: Topology, store: Store, client: CloudClient,
                 clock: Callable[[], float] = time.time):
        self.settings = settings
        self.topology = topology
        self.store = store
        self.client = client
        self.clock = clock
        self.latest: dict[str, dict[str, Any]] = {}  # RAM only; served by /api/v1/live
        self.buffer: list[dict[str, Any]] = []
        self.last_ts: dict[str, int] = {}
        self.next_due: dict[str, float] = {}
        self.misses: dict[str, int] = {}
        self.meta: dict[str, dict[str, str]] = {}
        self.meta_pending: dict[str, dict[str, str]] = {}
        self.last_error: dict[str, str] = {}
        self.last_flush = 0.0
        self._history_lock = asyncio.Lock()

    # ---------- lifecycle ----------
    def load_state(self) -> None:
        now = self.clock()
        self.store.sync_devices(self.topology)
        for d in self.topology.devices:
            ts = self.store.last_ts(d.sn)
            if ts:
                self.last_ts[d.sn] = ts
            self.meta[d.sn] = self.store.get_meta(d.sn)
            self.next_due[d.sn] = now
        self.last_flush = now

    def report_freq(self, sn: str) -> int:
        try:
            return int(self.meta.get(sn, {}).get("reportFreq") or DEFAULT_REPORT_FREQ)
        except ValueError:
            return DEFAULT_REPORT_FREQ

    # ---------- polling ----------
    async def tick(self) -> int:
        """Poll every device that is due. Returns the number of new samples buffered."""
        now = self.clock()
        due = [d for d in self.topology.devices if self.next_due.get(d.sn, 0) <= now]
        results = await asyncio.gather(*(self.client.snapshot(d.sn, d.felicity_type) for d in due), return_exceptions=True)
        added = 0
        for device, result in zip(due, results):
            if isinstance(result, BaseException):
                self._error(device, result)
                self._schedule_retry(device, now)
                continue
            self.last_error.pop(device.sn, None)
            added += self.accept_snapshot(device, result, now)
        if now - self.last_flush >= self.settings.flush_interval:
            await self.flush()
        return added

    def accept_snapshot(self, device: Device, data: dict, now: float) -> int:
        self._track_meta(device.sn, data, now)
        sample = normalize.from_snapshot(device, data)
        if sample is None:
            self._schedule_retry(device, now)
            return 0
        entry = self.latest.get(device.sn)
        if entry is None or sample["ts"] >= entry["sample"]["ts"]:
            self.latest[device.sn] = {"sample": sample, "fetched_ts": int(now), "extra": _live_extra(device, data)}
        if sample["ts"] <= self.last_ts.get(device.sn, 0):
            self._schedule_retry(device, now)
            return 0
        self.buffer.append(sample)
        self.last_ts[device.sn] = sample["ts"]
        self.misses[device.sn] = 0
        due = sample["ts"] + self.report_freq(device.sn) + self.settings.poll_lag
        self.next_due[device.sn] = due if due > now else now + self.settings.poll_tick
        return 1

    def _schedule_retry(self, device: Device, now: float) -> None:
        misses = self.misses.get(device.sn, 0) + 1
        self.misses[device.sn] = misses
        wait = min(self.settings.poll_tick * 2 ** (misses - 1), self.report_freq(device.sn))
        self.next_due[device.sn] = now + wait

    def _track_meta(self, sn: str, data: dict, now: float) -> None:
        known = self.meta.setdefault(sn, {})
        for key in META_KEYS:
            if data.get(key) in (None, ""):
                continue
            value = str(data[key])
            if known.get(key) != value:
                known[key] = value
                self.meta_pending.setdefault(sn, {})[key] = value

    def _error(self, device: Device, exc: BaseException, what: str = "poll") -> None:
        msg = f"{type(exc).__name__}: {exc}"
        if self.last_error.get(device.sn) != msg:  # log each distinct failure once, not every poll
            log.warning("%s %s failed: %s", what, device.sn, msg)
            self.last_error[device.sn] = msg

    # ---------- writes ----------
    async def flush(self) -> int:
        self.last_flush = self.clock()
        if not self.buffer and not self.meta_pending:
            return 0
        batch, self.buffer = self.buffer, []
        meta, self.meta_pending = self.meta_pending, {}
        try:
            return await asyncio.to_thread(self._write, batch, meta)
        except Exception:
            self.buffer = batch + self.buffer  # keep for the next attempt
            for sn, kv in meta.items():
                self.meta_pending.setdefault(sn, {}).update(kv)
            raise

    def _write(self, batch: list[dict], meta: dict[str, dict[str, str]]) -> int:
        with self.store.transaction():
            inserted = self.store.insert_samples(batch)
            self.store.write_meta(meta, int(self.clock()))
            rollups.refresh_many(self.store, rollups.spans_of(batch))
        return inserted

    # ---------- gap filling ----------
    async def backfill(self, max_days: int | None = None) -> int:
        """Fetch cloud history for the gap since each device's last stored sample."""
        now = int(self.clock())
        horizon = now - (max_days if max_days is not None else self.settings.backfill_max_days) * 86400
        total = 0
        for device in self.topology.devices:
            # Use what is on disk, not the in-RAM newest sample: a live poll may already be buffered.
            stored = await asyncio.to_thread(self.store.last_ts, device.sn)
            last = max(stored or 0, horizon)
            if now - last < 2 * self.report_freq(device.sn):
                continue
            samples: list[dict] = []
            for day in _device_days(device, last, now):
                try:
                    rows = await self.client.history(device.sn, device.felicity_type, day)
                except Exception as exc:  # noqa: BLE001 - keep going with other days/devices
                    self._error(device, exc)
                    continue
                samples += [s for s in (normalize.from_history(device, r) for r in rows) if s and last < s["ts"] <= now]
            if not samples:
                continue
            inserted = await asyncio.to_thread(self._write, samples, {})
            newest = max(s["ts"] for s in samples)
            self.last_ts[device.sn] = max(self.last_ts.get(device.sn, 0), newest)
            total += inserted
            log.info("backfill %s: %d samples", device.sn, inserted)
        return total


    # ---------- full history ----------
    async def backfill_history(self, since: date | None = None, max_empty_days: int | None = None,
                               pause: float | None = None, force: bool = False) -> dict[str, dict]:
        """Walk each device's history backwards day by day and fetch every day that isn't complete.

        Starts at yesterday (device clock; today belongs to the live poll and `backfill`) and stops at
        `since`, or once the cloud has returned nothing for `max_empty_days` days in a row (its history
        for that device has run out). Complete days (>= 95% of the expected reports) cost no request.
        Progress is kept in the kv table, so an interrupted run resumes where it stopped, and a device
        that finished is skipped next time unless `force`.
        """
        s = self.settings
        since = since or s.history_since
        # Days older than the retention cutoff can't be rolled up any more (their raw rows would be
        # deleted again), so never walk past it. On a first install there is no cutoff yet.
        cutoff = await asyncio.to_thread(self.store.kv_get, "raw_cutoff_ts")
        if cutoff:
            cutoff_day = rollups.local_day(int(cutoff))
            since = max(since, date.fromisoformat(cutoff_day)) if since else date.fromisoformat(cutoff_day)
        max_empty = s.history_max_empty_days if max_empty_days is None else max_empty_days
        pause = s.history_request_pause if pause is None else pause
        if self._history_lock.locked():  # startup run still going; the hourly job just skips
            return {}
        async with self._history_lock:
            return await self._backfill_history(since, max_empty, pause, force)

    async def _backfill_history(self, since: date | None, max_empty: int, pause: float, force: bool) -> dict[str, dict]:
        report: dict[str, dict] = {}
        for device in self.topology.devices:
            done_key, cursor_key = f"history_done:{device.sn}", f"history_cursor:{device.sn}"
            if force:
                await asyncio.to_thread(self._kv_clear, done_key, cursor_key)
            elif await asyncio.to_thread(self.store.kv_get, done_key):
                report[device.sn] = {"skipped": "already complete"}
                continue
            report[device.sn] = await self._history_for_device(device, since, max_empty, pause, cursor_key, done_key)
        return report

    async def _history_for_device(self, device: Device, since: date | None, max_empty: int, pause: float,
                                  cursor_key: str, done_key: str) -> dict:
        tz = device.utc_offset
        expected = 86400 // self.report_freq(device.sn)
        cursor = await asyncio.to_thread(self.store.kv_get, cursor_key)
        day = date.fromisoformat(cursor) if cursor else datetime.fromtimestamp(self.clock(), tz).date() - timedelta(days=1)
        stats = {"requests": 0, "inserted": 0, "complete_days": 0, "oldest_day": None}
        pending: list[dict] = []
        empty_streak = 0
        while since is None or day >= since:
            start = int(datetime(day.year, day.month, day.day, tzinfo=tz).timestamp())
            have = await asyncio.to_thread(
                self.store.scalar, "SELECT COUNT(*) FROM samples WHERE device_sn=? AND ts>=? AND ts<?", (device.sn, start, start + 86400))
            if have >= expected * 0.95:
                stats["complete_days"] += 1
                empty_streak = 0
            else:
                rows = await self._history_with_retries(device, day)
                if rows is None:  # still failing: stop here, the cursor lets the next run resume
                    break
                stats["requests"] += 1
                samples = [x for x in (normalize.from_history(device, r) for r in rows) if x]
                empty_streak = 0 if samples or have else empty_streak + 1
                pending += samples
                if samples:
                    have = len(samples)
                if pause:
                    await asyncio.sleep(pause)
            if have:
                stats["oldest_day"] = day.isoformat()
            # Write roughly a week at a time: few transactions, bounded memory on the Pi.
            if len(pending) >= expected * 7 or empty_streak >= max_empty:
                stats["inserted"] += await self._write_history(pending, cursor_key, day)
                pending = []
            if empty_streak >= max_empty:
                break
            day -= timedelta(days=1)
        else:
            empty_streak = max_empty  # reached `since`
        stats["inserted"] += await self._write_history(pending, cursor_key, day)
        if empty_streak >= max_empty:
            await asyncio.to_thread(self.store.kv_set, done_key, stats["oldest_day"] or "")
            await asyncio.to_thread(self._kv_clear, cursor_key)
        log.info("history %s: %s", device.sn, stats)
        return stats

    async def _history_with_retries(self, device: Device, day: date) -> list[dict] | None:
        """The Felicity history API is slow and drops connections; retry with growing waits."""
        delays = (*self.settings.history_retry_delays, None)
        for wait in delays:
            try:
                return await self.client.history(device.sn, device.felicity_type, day)
            except Exception as exc:  # noqa: BLE001
                self._error(device, exc, what=f"history {day}")
                if wait is None:
                    return None
                await asyncio.sleep(wait)
        return None

    async def _write_history(self, samples: list[dict], cursor_key: str, day: date) -> int:
        def write() -> int:
            with self.store.transaction():
                inserted = self.store.insert_samples(samples) if samples else 0
                if samples:
                    rollups.refresh_many(self.store, rollups.spans_of(samples))
                self.store.kv_set(cursor_key, day.isoformat())
            return inserted

        return await asyncio.to_thread(write)

    def _kv_clear(self, *keys: str) -> None:
        with self.store.transaction() as c:
            c.executemany("DELETE FROM kv WHERE key=?", [(k,) for k in keys])


def _device_days(device: Device, start: int, end: int) -> list[date]:
    tz = device.utc_offset
    d = datetime.fromtimestamp(start, tz).date()
    last = datetime.fromtimestamp(end, tz).date()
    days = []
    while d <= last:
        days.append(d)
        d += timedelta(days=1)
    return days


def _live_extra(device: Device, data: dict) -> dict[str, Any]:
    """Details worth showing live but not worth storing every 5 minutes."""
    extra: dict[str, Any] = {"status": data.get("status"), "work_mode": data.get("workModeStr")}
    if device.kind == "battery":
        cells = [normalize.cell_volts(v) for v in data.get("bmsVoltageList") or []]
        temps = [normalize.to_float(v) for v in data.get("cellTempList") or []]
        extra["cells_v"] = [c for c in cells if c]
        extra["cell_temps_c"] = [t for t in temps if t is not None and 0 < t < 200]
        extra["capacity_ah"] = normalize.to_float(data.get("battCapacity") or data.get("batteryCapacity"))
        extra["remaining_kwh"] = normalize.to_float(data.get("remainingBatteryEnergy"))
    else:
        extra["priority"] = data.get("oSPriStr")
        extra["e_pv_month"] = normalize.to_float(data.get("ePvMonth"))
        extra["e_pv_year"] = normalize.to_float(data.get("ePvYear"))
        extra["e_pv_total"] = normalize.to_float(data.get("ePvTotal"))
    return extra
