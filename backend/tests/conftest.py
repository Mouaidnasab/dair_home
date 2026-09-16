import copy
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.config import BACKEND_DIR, Settings, Topology
from app.store import Store

FIXTURES = Path(__file__).parent / "fixtures"
PAYLOADS = json.loads((FIXTURES / "felicity_payloads.json").read_text())


@pytest.fixture
def topology() -> Topology:
    return Topology.load(BACKEND_DIR / "topology.toml")


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(data_dir=tmp_path, db_path=tmp_path / "dair.sqlite3", collector_enabled=False)


@pytest.fixture
def store(settings):
    s = Store(settings.db_path)
    yield s
    s.close()


class FakeClock:
    def __init__(self, start: float):
        self.now = float(start)

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class FakeCloud:
    """Simulates the Felicity cloud: each device reports every `period` seconds, visible `lag` s later."""

    def __init__(self, topology: Topology, clock: FakeClock, period: int = 300, lag: int = 60, grid_w: float = 0.0):
        self.topology = topology
        self.clock = clock
        self.period = period
        self.lag = lag
        self.grid_w = grid_w
        self.calls = 0
        self.history_calls = 0
        self.fail: set[str] = set()

    def _report_ts(self, now: float) -> int:
        t = int(now) - self.lag
        return t - t % self.period

    def payload(self, sn: str, ts: int) -> dict:
        device = self.topology.device(sn)
        base = copy.deepcopy(PAYLOADS["snapshot_inverter" if device.kind == "inverter" else "snapshot_battery"])
        tz = timezone(device.utc_offset.utcoffset(None))
        local = datetime.fromtimestamp(ts, tz)
        base.update({"deviceSn": sn, "timeZone": device.tz, "dataTimeStr": local.strftime("%Y-%m-%d %H:%M:%S"),
                     "dataTime": int((local.replace(tzinfo=None) - timedelta(hours=8)).replace(tzinfo=timezone.utc).timestamp() * 1000)})
        if device.kind == "inverter":
            base.update({"pvTotalPower": "1200", "acTotalOutActPower": "800", "acTtlInpower": str(self.grid_w), "emsPower": "400"})
        return base

    async def snapshot(self, sn: str, device_type: str) -> dict:
        self.calls += 1
        if sn in self.fail:
            raise RuntimeError("boom")
        return self.payload(sn, self._report_ts(self.clock()))

    async def history(self, sn: str, device_type: str, day) -> list[dict]:
        self.history_calls += 1
        device = self.topology.device(sn)
        tz = timezone(device.utc_offset.utcoffset(None))
        start = int(datetime(day.year, day.month, day.day, tzinfo=tz).timestamp())
        rows = []
        for ts in range(start, min(start + 86400, self._report_ts(self.clock()) + 1), self.period):
            p = self.payload(sn, ts)
            p["deviceDataTime"] = p.pop("dataTimeStr")
            p.pop("dataTime")
            p.pop("timeZone")
            rows.append(p)
        return rows


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock(datetime(2026, 9, 1, 0, 0, 30, tzinfo=timezone.utc).timestamp())


@pytest.fixture
def cloud(topology, clock) -> FakeCloud:
    return FakeCloud(topology, clock)
