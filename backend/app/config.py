"""Settings (env) and topology (topology.toml)."""
from __future__ import annotations

import math
import os
import re
import tomllib
from dataclasses import dataclass, field
from datetime import date, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

LOCAL_TZ = ZoneInfo("Asia/Damascus")


def _env_int(name: str, default: int) -> int:
    return int(os.getenv(name, str(default)))


def parse_tiers(spec: str) -> list[tuple[float, float]]:
    """"300:600,inf:1400" -> [(300, 600), (inf, 1400)] — (cumulative kWh limit, price per kWh)."""
    tiers = []
    for part in spec.split(","):
        limit, price = part.split(":")
        tiers.append((math.inf if limit.strip() in ("inf", "∞") else float(limit), float(price)))
    return tiers


@dataclass
class Settings:
    felicity_user: str = ""
    felicity_pass: str = ""
    data_dir: Path = BACKEND_DIR / "data"
    db_path: Path = BACKEND_DIR / "data" / "dair.sqlite3"
    topology_path: Path = BACKEND_DIR / "topology.toml"
    static_dir: Path | None = None
    poll_tick: int = 60  # how often the scheduler checks which devices are due
    poll_lag: int = 90  # seconds after a device's next report before asking the cloud
    flush_interval: int = 900
    backfill_max_days: int = 7
    history_backfill: bool = True  # walk back through the cloud's history once, in the background
    history_since: date | None = None  # oldest day to fetch (None: until the cloud runs out)
    history_max_empty_days: int = 14
    history_request_pause: float = 1.0
    history_retry_delays: tuple[float, ...] = (10.0, 60.0)
    raw_retention_days: int = 180
    archive_dir: Path | None = None
    exchange_api_key: str = ""
    tariff_tiers: list[tuple[float, float]] = field(default_factory=lambda: parse_tiers("300:600,inf:1400"))
    billing_cycle_months: int = 2
    collector_enabled: bool = True

    @classmethod
    def from_env(cls) -> "Settings":
        data_dir = Path(os.getenv("DATA_DIR", str(BACKEND_DIR / "data"))).resolve()
        static = os.getenv("STATIC_DIR")
        archive = os.getenv("ARCHIVE_DIR")
        s = cls(
            felicity_user=os.getenv("FELICITY_USER", "").strip(),
            felicity_pass=os.getenv("FELICITY_PASS", "").strip(),
            data_dir=data_dir,
            db_path=Path(os.getenv("DB_PATH", str(data_dir / "dair.sqlite3"))),
            topology_path=Path(os.getenv("TOPOLOGY_PATH", str(BACKEND_DIR / "topology.toml"))),
            static_dir=Path(static) if static else None,
            poll_tick=_env_int("POLL_TICK", 60),
            poll_lag=_env_int("POLL_LAG", 90),
            flush_interval=_env_int("FLUSH_INTERVAL", 900),
            backfill_max_days=_env_int("BACKFILL_MAX_DAYS", 7),
            history_backfill=os.getenv("HISTORY_BACKFILL", "1") not in ("0", "false", "no"),
            history_since=date.fromisoformat(os.environ["HISTORY_SINCE"]) if os.getenv("HISTORY_SINCE") else None,
            history_max_empty_days=_env_int("HISTORY_MAX_EMPTY_DAYS", 14),
            history_request_pause=float(os.getenv("HISTORY_REQUEST_PAUSE", "1.0")),
            raw_retention_days=_env_int("RAW_RETENTION_DAYS", 180),
            archive_dir=Path(archive) if archive else None,
            exchange_api_key=os.getenv("API_KEY_EXCHANGE") or os.getenv("api_key_exchange") or "",
            tariff_tiers=parse_tiers(os.getenv("TARIFF_TIERS", "300:600,inf:1400")),
            billing_cycle_months=_env_int("BILLING_CYCLE_MONTHS", 2),
            collector_enabled=os.getenv("COLLECTOR_ENABLED", "1") not in ("0", "false", "no"),
        )
        if s.collector_enabled and not (s.felicity_user and s.felicity_pass):
            s.collector_enabled = False
        return s


# ---------------- topology ----------------

KIND_TO_FELICITY = {"inverter": "OG", "battery": "BP"}


def parse_utc_offset(tz: str | None) -> timezone:
    m = re.fullmatch(r"UTC([+-])(\d{1,2}):?(\d{2})?", (tz or "").strip())
    if not m:
        return timezone(timedelta(hours=3))  # Syria's fixed offset
    sign = 1 if m.group(1) == "+" else -1
    return timezone(sign * timedelta(hours=int(m.group(2)), minutes=int(m.group(3) or 0)))


@dataclass(frozen=True)
class Plant:
    id: str
    name: str
    zone: str
    label: str


@dataclass(frozen=True)
class Device:
    sn: str
    kind: str
    plant: str
    zones: tuple[str, ...]
    tz: str
    model: str = ""
    alias: str = ""

    @property
    def felicity_type(self) -> str:
        return KIND_TO_FELICITY[self.kind]

    @property
    def utc_offset(self) -> timezone:
        return parse_utc_offset(self.tz)


@dataclass(frozen=True)
class Topology:
    plants: tuple[Plant, ...]
    devices: tuple[Device, ...]

    @classmethod
    def load(cls, path: Path) -> "Topology":
        raw = tomllib.loads(Path(path).read_text())
        plants = tuple(Plant(p["id"], p.get("name", ""), p["zone"], p.get("label", p["zone"])) for p in raw.get("plant", []))
        devices = tuple(
            Device(
                sn=d["sn"], kind=d["kind"], plant=d["plant"], zones=tuple(d["zones"]),
                tz=d.get("tz", "UTC+03:00"), model=d.get("model", ""), alias=d.get("alias", ""),
            )
            for d in raw.get("device", [])
        )
        topo = cls(plants, devices)
        topo.validate()
        return topo

    def validate(self) -> None:
        zones = {p.zone for p in self.plants}
        plant_ids = {p.id for p in self.plants}
        for d in self.devices:
            if d.kind not in KIND_TO_FELICITY:
                raise ValueError(f"{d.sn}: unknown kind {d.kind!r}")
            if d.plant not in plant_ids:
                raise ValueError(f"{d.sn}: unknown plant {d.plant}")
            if not set(d.zones) <= zones:
                raise ValueError(f"{d.sn}: unknown zones {set(d.zones) - zones}")
        if len({d.sn for d in self.devices}) != len(self.devices):
            raise ValueError("duplicate device sn")

    @property
    def zones(self) -> list[str]:
        return [p.zone for p in self.plants]

    def device(self, sn: str) -> Device | None:
        return next((d for d in self.devices if d.sn == sn), None)

    def plant_for_zone(self, zone: str) -> Plant | None:
        return next((p for p in self.plants if p.zone == zone), None)

    def inverters(self, zone: str | None = None) -> list[Device]:
        return [d for d in self.devices if d.kind == "inverter" and (zone is None or zone in d.zones)]

    def batteries(self, zone: str | None = None) -> list[Device]:
        return [d for d in self.devices if d.kind == "battery" and (zone is None or zone in d.zones)]

    def inverter_for_plant(self, plant_id: str) -> Device | None:
        invs = [d for d in self.devices if d.kind == "inverter" and d.plant == plant_id]
        return invs[0] if len(invs) == 1 else None
