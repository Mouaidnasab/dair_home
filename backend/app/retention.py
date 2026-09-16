"""Keep raw samples for N days; hourly/daily rollups are kept forever.

Order matters: rollups are brought up to date first, raw rows are (optionally) archived to a
monthly csv.gz, then deleted in batches, then freed pages are returned with incremental_vacuum.
The cutoff is always a local midnight and is remembered so later rollup refreshes never recompute
days whose raw data is gone.
"""
from __future__ import annotations

import csv
import gzip
import time
from datetime import datetime, timedelta
from pathlib import Path

from . import rollups
from .config import LOCAL_TZ
from .normalize import SAMPLE_COLUMNS
from .store import Store

BATCH_SECONDS = 86400  # delete one day at a time to keep transactions (and the WAL) small


def cutoff_for(now: float, raw_days: int) -> int:
    day = datetime.fromtimestamp(now, LOCAL_TZ).date() - timedelta(days=raw_days)
    return rollups.day_bounds(day)[0]


def run(store: Store, raw_days: int, archive_dir: Path | None = None, dry_run: bool = False,
        now: float | None = None, log=print) -> dict:
    now = time.time() if now is None else now
    cutoff = cutoff_for(now, raw_days)
    oldest = store.scalar("SELECT MIN(ts) FROM samples")
    count = store.scalar("SELECT COUNT(*) FROM samples WHERE ts < ?", (cutoff,))
    report = {"cutoff_ts": cutoff, "cutoff_day": rollups.local_day(cutoff), "rows_older": count,
              "deleted": 0, "archived_files": [], "dry_run": dry_run}
    log(f"retention: keep raw since {report['cutoff_day']} ({raw_days} days); {count} older rows")
    if dry_run or not count:
        return report

    # 1. rollups for everything about to lose its raw data
    devices = [r[0] for r in store.query("SELECT DISTINCT device_sn FROM samples WHERE ts < ?", (cutoff,))]
    with store.transaction():
        for sn in devices:
            rollups.refresh(store, sn, oldest, cutoff - 1)

    # 2. archive
    if archive_dir:
        report["archived_files"] = [str(p) for p in _archive(store, Path(archive_dir), oldest, cutoff)]

    # 3. remember the cutoff *before* deleting, so a crash mid-delete can't let a later refresh
    #    recompute a half-deleted day; then delete in day-sized batches
    store.kv_set("raw_cutoff_ts", str(max(cutoff, int(store.kv_get("raw_cutoff_ts") or 0))))
    start = oldest - oldest % BATCH_SECONDS
    while start < cutoff:
        end = min(start + BATCH_SECONDS, cutoff)
        with store.transaction() as c:
            before = c.total_changes
            c.execute("DELETE FROM samples WHERE ts >= ? AND ts < ?", (start, end))
            report["deleted"] += c.total_changes - before
        start = end

    # 4. give pages back to the filesystem
    with store._lock:
        store.conn.execute("PRAGMA incremental_vacuum")
        store.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    log(f"retention: deleted {report['deleted']} rows")
    return report


def _archive(store: Store, archive_dir: Path, start: int, cutoff: int) -> list[Path]:
    archive_dir.mkdir(parents=True, exist_ok=True)
    cols = ("device_sn", "ts", *SAMPLE_COLUMNS)
    written = []
    month_start = start
    while month_start < cutoff:
        d = datetime.fromtimestamp(month_start, LOCAL_TZ)
        nxt = (d.replace(day=1) + timedelta(days=32)).replace(day=1, hour=0, minute=0, second=0)
        month_end = min(int(nxt.timestamp()), cutoff)
        rows = store.query(f"SELECT {', '.join(cols)} FROM samples WHERE ts >= ? AND ts < ? ORDER BY ts, device_sn", (month_start, month_end))
        if rows:
            path = archive_dir / f"samples_{d:%Y-%m}_{rows[0]['ts']}-{rows[-1]['ts']}.csv.gz"
            with gzip.open(path, "wt", newline="") as f:
                w = csv.writer(f)
                w.writerow(cols)
                w.writerows(tuple(r) for r in rows)
            written.append(path)
        month_start = month_end
    return written
