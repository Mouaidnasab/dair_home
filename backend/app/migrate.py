"""One-shot import of the v1 daily CSVs into SQLite, with per-file parity checks.

Parity: the distinct valid samples a CSV holds (successful rows, deduped on upstream sample time)
must all be present in the database afterwards — whether this run inserted them or an earlier one
(or another overlapping file) did. Re-running inserts nothing and still verifies.
"""
from __future__ import annotations

import csv
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from . import normalize, rollups
from .config import Topology
from .store import Store

FILE_RE = re.compile(r"^(?P<label>.+)_(?P<id>\d{15,18})_(?P<day>\d{4}-\d{2}-\d{2})\.csv$")
csv.field_size_limit(sys.maxsize)


@dataclass
class FileResult:
    file: str
    device_sn: str
    rows: int
    samples: int
    inserted: int
    present: int

    @property
    def ok(self) -> bool:
        return self.present == self.samples


def resolve_device(topology: Topology, ident: str):
    """A v1 file is keyed by plant id (inverter data) or by device sn (battery data)."""
    device = topology.device(ident)
    if device:
        return device
    return topology.inverter_for_plant(ident)


def read_file(topology: Topology, path: Path) -> tuple[object, int, dict[int, dict]] | None:
    m = FILE_RE.match(path.name)
    if not m:
        return None
    device = resolve_device(topology, m.group("id"))
    if device is None:
        return None
    by_ts: dict[int, dict] = {}
    rows = 0
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows += 1
            if "pd_code" in row:
                s = normalize.from_legacy_plant_row(device, row)
            else:
                s = normalize.from_legacy_battery_row(device, row)
            if s:
                by_ts[s["ts"]] = s  # last row for a sample time wins (same upstream reading)
    return device, rows, by_ts


def migrate_csv(store: Store, topology: Topology, src: Path, verify: bool = True, log=print) -> list[FileResult]:
    store.sync_devices(topology)
    results: list[FileResult] = []
    for path in sorted(Path(src).glob("*.csv")):
        parsed = read_file(topology, path)
        if parsed is None:
            log(f"skip  {path.name} (not a v1 device file)")
            continue
        device, rows, by_ts = parsed
        with store.transaction() as c:
            inserted = store.insert_samples(by_ts.values())
            if by_ts:
                rollups.refresh(store, device.sn, min(by_ts), max(by_ts))
            present = _count_present(store, device.sn, list(by_ts))
            ok = present == len(by_ts)
            c.execute(
                "INSERT INTO csv_imports (file, device_sn, size, samples, verified_ts) VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT (file) DO UPDATE SET device_sn=excluded.device_sn, size=excluded.size, samples=excluded.samples, verified_ts=excluded.verified_ts",
                (str(path.resolve()), device.sn, path.stat().st_size, len(by_ts), int(time.time()) if ok else None),
            )
        res = FileResult(path.name, device.sn, rows, len(by_ts), inserted, present)
        results.append(res)
        log(f"{'ok   ' if res.ok else 'FAIL '} {path.name}: rows={rows} samples={res.samples} inserted={inserted} present={present}")
    return results


def _count_present(store: Store, sn: str, ts_list: list[int]) -> int:
    present = 0
    for i in range(0, len(ts_list), 500):
        chunk = ts_list[i:i + 500]
        present += store.scalar(
            f"SELECT COUNT(*) FROM samples WHERE device_sn=? AND ts IN ({','.join('?' * len(chunk))})", (sn, *chunk)
        )
    return present


def delete_verified_csv(store: Store, src: Path, confirm: bool, log=print) -> list[Path]:
    """Delete CSVs whose import was verified and whose size hasn't changed since."""
    verified = {r["file"]: r for r in store.query("SELECT * FROM csv_imports WHERE verified_ts IS NOT NULL")}
    deleted = []
    for path in sorted(Path(src).glob("*.csv")):
        rec = verified.get(str(path.resolve()))
        if rec is None:
            log(f"keep  {path.name} (not verified)")
            continue
        if path.stat().st_size != rec["size"]:
            log(f"keep  {path.name} (changed since import)")
            continue
        if confirm:
            path.unlink()
            log(f"del   {path.name}")
        else:
            log(f"would delete {path.name} (pass --confirm)")
        deleted.append(path)
    return deleted
