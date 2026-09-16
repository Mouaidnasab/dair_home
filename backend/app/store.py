"""SQLite storage tuned for an SD card: WAL, synchronous=NORMAL, few large transactions."""
from __future__ import annotations

import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator

from .normalize import SAMPLE_COLUMNS

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
_SAMPLE_COLS = ("device_sn", "ts", *SAMPLE_COLUMNS)


class Store:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        if str(path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._depth = 0
        self.commits = 0  # write transactions committed (used by the write-budget test)
        self.conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        c = self.conn
        # auto_vacuum must be set before the first table exists; retention then frees pages incrementally.
        c.execute("PRAGMA auto_vacuum=INCREMENTAL")
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        c.execute("PRAGMA wal_autocheckpoint=256")  # checkpoint every ~1 MB of WAL instead of 4 MB
        c.execute("PRAGMA journal_size_limit=1048576")  # and truncate the WAL file back to 1 MB
        c.execute("PRAGMA temp_store=MEMORY")
        c.execute("PRAGMA cache_size=-4096")  # 4 MB page cache
        c.execute("PRAGMA foreign_keys=ON")
        self.migrate()

    def close(self) -> None:
        with self._lock:
            self.conn.close()

    # ---------- transactions ----------
    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """Nested-safe write transaction; commits once at the outermost level."""
        with self._lock:
            outer = self._depth == 0
            if outer:
                self.conn.execute("BEGIN IMMEDIATE")
            self._depth += 1
            try:
                yield self.conn
            except BaseException:
                self._depth -= 1
                if outer:
                    self.conn.execute("ROLLBACK")
                raise
            self._depth -= 1
            if outer:
                self.conn.execute("COMMIT")
                self.commits += 1

    def query(self, sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self.conn.execute(sql, tuple(params)).fetchall()

    def scalar(self, sql: str, params: Iterable[Any] = ()) -> Any:
        rows = self.query(sql, params)
        return rows[0][0] if rows else None

    # ---------- migrations ----------
    def migrate(self) -> list[int]:
        with self._lock:
            self.conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_ts INTEGER NOT NULL)")
            done = {r[0] for r in self.conn.execute("SELECT version FROM schema_version")}
            applied = []
            for f in sorted(MIGRATIONS_DIR.glob("[0-9][0-9][0-9]_*.sql")):
                version = int(f.name[:3])
                if version in done:
                    continue
                with self.transaction() as c:
                    for stmt in _split_sql(f.read_text()):
                        c.execute(stmt)
                    c.execute("INSERT INTO schema_version VALUES (?, ?)", (version, int(time.time())))
                applied.append(version)
            return applied

    @property
    def schema_version(self) -> int:
        return self.scalar("SELECT COALESCE(MAX(version), 0) FROM schema_version")

    # ---------- devices & meta ----------
    def sync_devices(self, topology) -> None:
        rows = [(d.sn, d.kind, d.plant, ",".join(d.zones)) for d in topology.devices]
        existing = {tuple(r) for r in self.query("SELECT sn, kind, plant, zones FROM devices")}
        if set(rows) == existing:
            return
        with self.transaction() as c:
            c.execute("DELETE FROM devices")
            c.executemany("INSERT INTO devices VALUES (?, ?, ?, ?)", rows)

    def get_meta(self, sn: str) -> dict[str, str]:
        return {r["key"]: r["value"] for r in self.query("SELECT key, value FROM device_meta WHERE sn=?", (sn,))}

    def write_meta(self, changes: dict[str, dict[str, str]], ts: int) -> None:
        if not changes:
            return
        with self.transaction() as c:
            c.executemany(
                "INSERT INTO device_meta (sn, key, value, updated_ts) VALUES (?, ?, ?, ?) "
                "ON CONFLICT (sn, key) DO UPDATE SET value=excluded.value, updated_ts=excluded.updated_ts",
                [(sn, k, v, ts) for sn, kv in changes.items() for k, v in kv.items()],
            )

    # ---------- samples ----------
    def insert_samples(self, samples: Iterable[dict[str, Any]]) -> int:
        """INSERT OR IGNORE on (device_sn, ts); returns rows actually inserted."""
        rows = [tuple(s.get(c) for c in _SAMPLE_COLS) for s in samples]
        if not rows:
            return 0
        sql = f"INSERT OR IGNORE INTO samples ({', '.join(_SAMPLE_COLS)}) VALUES ({', '.join('?' * len(_SAMPLE_COLS))})"
        with self.transaction() as c:
            before = c.total_changes
            c.executemany(sql, rows)
            return c.total_changes - before

    def last_ts(self, sn: str) -> int | None:
        return self.scalar("SELECT MAX(ts) FROM samples WHERE device_sn=?", (sn,))

    def samples_between(self, sn: str, start: int, end: int) -> list[sqlite3.Row]:
        return self.query("SELECT * FROM samples WHERE device_sn=? AND ts>=? AND ts<? ORDER BY ts", (sn, start, end))

    def count_samples(self, sn: str | None = None) -> int:
        if sn:
            return self.scalar("SELECT COUNT(*) FROM samples WHERE device_sn=?", (sn,))
        return self.scalar("SELECT COUNT(*) FROM samples")

    # ---------- kv ----------
    def kv_get(self, key: str) -> str | None:
        return self.scalar("SELECT value FROM kv WHERE key=?", (key,))

    def kv_set(self, key: str, value: str) -> None:
        with self.transaction() as c:
            c.execute("INSERT INTO kv VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value=excluded.value", (key, value))


def _split_sql(script: str) -> list[str]:
    """Split a migration file into statements (no semicolons inside our DDL literals)."""
    lines = [ln for ln in script.splitlines() if not ln.strip().startswith("--")]
    return [s.strip() for s in "\n".join(lines).split(";") if s.strip()]
