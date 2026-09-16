"""HTTP API (v1) and static dashboard.

/api/v1/live      newest reading of every device, from RAM (no disk access)
/api/v1/series    one day of power, bucketed in SQL (<= 300 points)
/api/v1/energy    kWh + grid bill for a day / month / billing cycle / year, from rollups
/api/v1/cycles    recent billing cycles
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import billing, retention, rollups
from .collector import Collector
from .config import LOCAL_TZ, Settings, Topology
from .normalize import SAMPLE_COLUMNS
from .store import Store

log = logging.getLogger(__name__)

MAX_POINTS = 300
STALE_AFTER = 900
ENERGY_COLS = ("pv_kwh", "load_kwh", "grid_kwh", "bat_charge_kwh", "bat_discharge_kwh")


@dataclass
class Services:
    settings: Settings
    topology: Topology
    store: Store
    collector: Collector | None
    rates: billing.Rates


def create_app(services: Services | None = None, start_background: bool = True) -> FastAPI:
    state: dict[str, Any] = {"svc": services}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        svc = state["svc"] or _build_services()
        state["svc"] = svc
        scheduler = None
        client = None
        if start_background:
            scheduler, client = await _start_background(svc)
        try:
            yield
        finally:
            if scheduler:
                scheduler.shutdown(wait=False)
            if svc.collector:
                try:
                    await svc.collector.flush()
                except Exception:  # noqa: BLE001
                    log.exception("final flush failed")
            if client:
                await client.aclose()
            if services is None:
                svc.store.close()

    app = FastAPI(title="dair_home", lifespan=lifespan)

    def svc() -> Services:
        if state["svc"] is None:
            raise HTTPException(503, "starting")
        return state["svc"]

    # ---------------- live ----------------
    @app.get("/api/v1/live")
    def live() -> dict:
        s = svc()
        now = int(datetime.now().timestamp())
        latest = s.collector.latest if s.collector else {}
        devices = {d.sn: _device_live(d, latest.get(d.sn), now) for d in s.topology.devices}
        zones = []
        for plant in s.topology.plants:
            invs = [devices[d.sn] for d in s.topology.inverters(plant.zone)]
            bats = [devices[d.sn] for d in s.topology.batteries(plant.zone)]
            zones.append({
                "zone": plant.zone, "label": plant.label, "plant_id": plant.id,
                **_sum_power(invs),
                "soc": _avg([b["soc"] for b in bats]) if any(b["soc"] is not None for b in bats) else _avg([i["soc"] for i in invs]),
                "inverters": invs,
                "battery_sns": [b["sn"] for b in bats],
            })
        all_invs = [devices[d.sn] for d in s.topology.inverters()]
        return {
            "now": now,
            "home": {**_sum_power(all_invs), "soc": _avg([devices[d.sn]["soc"] for d in s.topology.batteries()])},
            "zones": zones,
            "batteries": [devices[d.sn] for d in s.topology.batteries()],
            "collector": {
                "enabled": s.collector is not None,
                "buffered": len(s.collector.buffer) if s.collector else 0,
                "last_flush_ts": int(s.collector.last_flush) if s.collector else None,
                "errors": dict(s.collector.last_error) if s.collector else {},
            },
        }

    # ---------------- series ----------------
    @app.get("/api/v1/series")
    def series(zone: str = "home", sn: str | None = None, day: str | None = None,
               bucket: int = Query(300, ge=60, le=3600)) -> dict:
        s = svc()
        d = _parse_day(day)
        start, end = rollups.day_bounds(d)
        bucket = max(bucket, -(-(end - start) // MAX_POINTS))
        power_sns, soc_sns = _series_devices(s.topology, zone, sn)
        points = _series_points(s.store, power_sns, soc_sns, start, end, bucket)
        source = "samples"
        if not points:
            points = _hourly_points(s.store, power_sns, soc_sns, start, end)
            source, bucket = ("rollups", 3600) if points else ("none", bucket)
        return {"day": d.isoformat(), "zone": None if sn else zone, "sn": sn, "bucket": bucket,
                "source": source, "points": points}

    # ---------------- energy / billing ----------------
    @app.get("/api/v1/energy")
    def energy(period: str = "day", date_: str | None = Query(None, alias="date"), zone: str = "home",
               currency: str = "SYP") -> dict:
        s = svc()
        currency = _currency(currency)
        if period not in ("day", "month", "cycle", "year"):
            raise HTTPException(400, "period must be day|month|cycle|year")
        d = _parse_day(date_)
        sns = _zone_inverters(s.topology, zone)
        months = s.settings.billing_cycle_months
        if period == "day":
            first, last = d, d
        elif period == "month":
            first = d.replace(day=1)
            last = billing.add_months(first, 1) - timedelta(days=1)
        elif period == "cycle":
            first = billing.cycle_start(d, months)
            last = billing.add_months(first, months) - timedelta(days=1)
        else:
            first, last = date(d.year, 1, 1), date(d.year, 12, 31)

        # Costs are marginal within each cycle, so read from the start of the first cycle involved.
        cyc_first = billing.cycle_start(first, months)
        daily = _daily_rows(s.store, sns, cyc_first.isoformat(), last.isoformat())
        costs = billing.daily_marginal_costs({k: v["grid_kwh"] for k, v in daily.items()}, s.settings.tariff_tiers, months)
        in_period = {k: v for k, v in daily.items() if first.isoformat() <= k <= last.isoformat()}

        if period == "day":
            breakdown = _hourly_breakdown(s.store, sns, d)
        elif period == "year":
            breakdown = _group(in_period, costs, key=lambda day: day[:7])
        else:
            breakdown = _group(in_period, costs, key=lambda day: day)
        totals = _totals(in_period.values())
        cost_syp = sum(costs[k] for k in in_period)
        cyc = billing.cycle_start(d, months)
        cycle_kwh = sum(v["grid_kwh"] for k, v in daily.items() if billing.cycle_start(date.fromisoformat(k), months) == cyc)
        return {
            "period": period, "zone": zone, "date": d.isoformat(),
            "start_day": first.isoformat(), "end_day": last.isoformat(),
            "currency": currency,
            "totals": totals,
            "bill": {
                "grid_kwh": totals["grid_kwh"],
                "amount": _money(s.rates, cost_syp, currency),
                "cycle": {"start_day": cyc.isoformat(), "label": billing.cycle_label(cyc, months),
                          "grid_kwh": round(cycle_kwh, 3),
                          "amount": _money(s.rates, billing.tiered_cost(cycle_kwh, s.settings.tariff_tiers), currency),
                          "tiers": _tiers(s, cycle_kwh, currency)},
            },
            "breakdown": [
                {**{k: v for k, v in b.items() if k != "cost_syp"},
                 "cost": None if b["cost_syp"] is None else _money(s.rates, b["cost_syp"], currency)}
                for b in breakdown
            ],
        }

    @app.get("/api/v1/cycles")
    def cycles(limit: int = Query(6, ge=1, le=36), zone: str = "home", currency: str = "SYP") -> dict:
        s = svc()
        currency = _currency(currency)
        months = s.settings.billing_cycle_months
        sns = _zone_inverters(s.topology, zone)
        daily = _daily_rows(s.store, sns, "0000-00-00", "9999-99-99")
        by_cycle: dict[date, float] = {}
        for day, row in daily.items():
            cs = billing.cycle_start(date.fromisoformat(day), months)
            by_cycle[cs] = by_cycle.get(cs, 0.0) + row["grid_kwh"]
        out = []
        for cs in sorted(by_cycle, reverse=True)[:limit]:
            kwh = by_cycle[cs]
            out.append({"start_day": cs.isoformat(), "label": billing.cycle_label(cs, months), "grid_kwh": round(kwh, 3),
                        "amount": _money(s.rates, billing.tiered_cost(kwh, s.settings.tariff_tiers), currency),
                        "tiers": _tiers(s, kwh, currency)})
        return {"zone": zone, "currency": currency, "cycles": out}

    @app.get("/api/v1/topology")
    def topology() -> dict:
        t = svc().topology
        return {
            "zones": [{"zone": p.zone, "label": p.label, "plant_id": p.id} for p in t.plants],
            "devices": [{"sn": d.sn, "kind": d.kind, "zones": list(d.zones), "model": d.model, "alias": d.alias} for d in t.devices],
        }

    @app.get("/api/v1/health")
    def health() -> dict:
        s = svc()
        return {"status": "ok", "schema_version": s.store.schema_version, "collector": s.collector is not None,
                "tariff_tiers": [[None if t[0] == float("inf") else t[0], t[1]] for t in s.settings.tariff_tiers]}

    _mount_static(app, services.settings if services else Settings.from_env())
    return app


# ---------------- wiring ----------------

def _build_services() -> Services:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    # One line per HTTP call or scheduler run would grow logs on the SD card all day.
    for noisy in ("httpx", "apscheduler", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    settings = Settings.from_env()
    topology = Topology.load(settings.topology_path)
    store = Store(settings.db_path)
    store.sync_devices(topology)
    return Services(settings, topology, store, None, billing.Rates(settings.exchange_api_key))


async def _start_background(svc: Services):
    from apscheduler.schedulers.asyncio import AsyncIOScheduler

    from .felicity import FelicityClient

    s = svc.settings
    scheduler = AsyncIOScheduler(timezone=LOCAL_TZ, job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 120})
    client = None
    if s.collector_enabled:
        client = FelicityClient(s.felicity_user, s.felicity_pass, s.data_dir / "token.txt")
        svc.collector = Collector(s, svc.topology, svc.store, client)
        svc.collector.load_state()

        async def startup():
            await svc.collector.tick()  # fill /live right away
            try:
                await svc.collector.backfill()
            except Exception:  # noqa: BLE001
                log.exception("backfill failed")

        asyncio.create_task(startup())
        scheduler.add_job(svc.collector.tick, "interval", seconds=s.poll_tick)
    else:
        log.warning("collector disabled (no FELICITY_USER/FELICITY_PASS or COLLECTOR_ENABLED=0)")

    async def run_retention():
        if svc.collector:
            await svc.collector.flush()
        await asyncio.to_thread(retention.run, svc.store, s.raw_retention_days, s.archive_dir, False, None, log.info)

    scheduler.add_job(run_retention, "cron", hour=3, minute=30)
    if svc.rates.api_key:
        scheduler.add_job(svc.rates.refresh, "interval", hours=1)
        asyncio.create_task(svc.rates.refresh())
    scheduler.start()
    return scheduler, client


def _mount_static(app: FastAPI, settings: Settings) -> None:
    static = settings.static_dir
    if not static or not (static / "index.html").exists():
        return
    if (static / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=static / "assets"), name="assets")
    root = static.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        candidate = (root / path).resolve()
        if path and candidate.is_file() and root in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(root / "index.html", headers={"Cache-Control": "no-cache"})


# ---------------- helpers ----------------

def _parse_day(day: str | None) -> date:
    if not day:
        return datetime.now(LOCAL_TZ).date()
    try:
        return date.fromisoformat(day)
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")


def _currency(c: str) -> str:
    c = c.upper()
    if c not in billing.CURRENCIES:
        raise HTTPException(400, f"currency must be one of {billing.CURRENCIES}")
    return c


def _money(rates: billing.Rates, syp: float, currency: str) -> float | None:
    v = rates.convert(syp, currency)
    return None if v is None else round(v, 2)


def _tiers(s: Services, kwh: float, currency: str) -> list[dict]:
    return [{**t, "price": _money(s.rates, t["price"], currency)} for t in billing.tier_fill(kwh, s.settings.tariff_tiers)]


def _avg(values) -> float | None:
    vals = [v for v in values if v is not None]
    return round(sum(vals) / len(vals), 1) if vals else None


def _device_live(device, entry: dict | None, now: int) -> dict:
    base = {"sn": device.sn, "kind": device.kind, "zones": list(device.zones), "model": device.model, "alias": device.alias}
    if not entry:
        return {**base, "ts": None, "age_s": None, "stale": True, **{c: None for c in SAMPLE_COLUMNS}, "extra": {}}
    sample = entry["sample"]
    age = now - sample["ts"]
    return {**base, "ts": sample["ts"], "age_s": age, "stale": age > STALE_AFTER,
            **{c: sample.get(c) for c in SAMPLE_COLUMNS}, "extra": entry.get("extra", {})}


def _sum_power(invs: list[dict]) -> dict:
    fresh = [i for i in invs if i["ts"] is not None]

    def total(col):
        vals = [i[col] for i in fresh if i[col] is not None]
        return round(sum(vals), 1) if vals else None

    volts = [i["grid_v"] for i in fresh if i["grid_v"] is not None]
    return {"pv_w": total("pv_w"), "load_w": total("load_w"), "grid_w": total("grid_w"), "bat_w": total("bat_w"),
            "grid_v": max(volts) if volts else None,
            "grid_available": (max(volts) > rollups.GRID_UP_VOLTS) if volts else None,
            "updated_ts": min((i["ts"] for i in fresh), default=None)}


def _zone_inverters(t: Topology, zone: str) -> list[str]:
    if zone == "home":
        return [d.sn for d in t.inverters()]
    if zone not in t.zones:
        raise HTTPException(404, f"unknown zone {zone}")
    return [d.sn for d in t.inverters(zone)]


def _series_devices(t: Topology, zone: str, sn: str | None) -> tuple[list[str], list[str]]:
    if sn:
        d = t.device(sn)
        if not d:
            raise HTTPException(404, f"unknown device {sn}")
        return [sn], [sn]
    invs = _zone_inverters(t, zone)
    bats = [d.sn for d in (t.batteries() if zone == "home" else t.batteries(zone))]
    return invs, bats or invs


def _in(sns: list[str]) -> str:
    return ",".join("?" * len(sns))


def _series_points(store: Store, power_sns, soc_sns, start: int, end: int, bucket: int) -> list[dict]:
    if not power_sns:
        return []
    b = int(bucket)
    power = store.query(
        f"""
        SELECT t, SUM(pv) AS pv_w, SUM(ld) AS load_w, SUM(gr) AS grid_w, SUM(bt) AS bat_w, MAX(gv) AS grid_v
        FROM (SELECT device_sn, (ts / {b}) * {b} AS t, AVG(pv_w) AS pv, AVG(load_w) AS ld, AVG(grid_w) AS gr,
                     AVG(bat_w) AS bt, AVG(grid_v) AS gv
              FROM samples WHERE device_sn IN ({_in(power_sns)}) AND ts >= ? AND ts < ?
              GROUP BY device_sn, t)
        GROUP BY t ORDER BY t
        """,
        (*power_sns, start, end),
    )
    soc = {r["t"]: r["soc"] for r in store.query(
        f"SELECT (ts / {int(bucket)}) * {int(bucket)} AS t, AVG(soc) AS soc FROM samples "
        f"WHERE device_sn IN ({_in(soc_sns)}) AND ts >= ? AND ts < ? AND soc IS NOT NULL GROUP BY t",
        (*soc_sns, start, end),
    )}
    return [{"t": r["t"], "pv_w": _r(r["pv_w"]), "load_w": _r(r["load_w"]), "grid_w": _r(r["grid_w"]),
             "bat_w": _r(r["bat_w"]), "grid_v": _r(r["grid_v"]), "soc": _r(soc.get(r["t"]))} for r in power]


def _hourly_points(store: Store, power_sns, soc_sns, start: int, end: int) -> list[dict]:
    """Days older than raw retention: average power per hour from the energy rollups."""
    if not power_sns:
        return []
    rows = store.query(
        f"SELECT bucket AS t, SUM(pv_kwh) pv, SUM(load_kwh) ld, SUM(grid_kwh) gr, SUM(bat_charge_kwh) - SUM(bat_discharge_kwh) bt "
        f"FROM rollup_hourly WHERE device_sn IN ({_in(power_sns)}) AND bucket >= ? AND bucket < ? GROUP BY bucket ORDER BY bucket",
        (*power_sns, start, end),
    )
    soc = {r["t"]: r["soc"] for r in store.query(
        f"SELECT bucket AS t, AVG(soc_avg) soc FROM rollup_hourly WHERE device_sn IN ({_in(soc_sns)}) AND bucket >= ? AND bucket < ? GROUP BY bucket",
        (*soc_sns, start, end),
    )}
    return [{"t": r["t"], "pv_w": _r(r["pv"] * 1000), "load_w": _r(r["ld"] * 1000), "grid_w": _r(r["gr"] * 1000),
             "bat_w": _r(r["bt"] * 1000), "grid_v": None, "soc": _r(soc.get(r["t"]))} for r in rows]


def _r(v):
    return None if v is None else round(v, 1)


def _daily_rows(store: Store, sns: list[str], first: str, last: str) -> dict[str, dict]:
    if not sns:
        return {}
    rows = store.query(
        f"SELECT day, SUM(pv_kwh) pv_kwh, SUM(load_kwh) load_kwh, SUM(grid_kwh) grid_kwh, SUM(bat_charge_kwh) bat_charge_kwh, "
        f"SUM(bat_discharge_kwh) bat_discharge_kwh, MAX(grid_up_s) grid_up_s FROM rollup_daily "
        f"WHERE device_sn IN ({_in(sns)}) AND day >= ? AND day <= ? GROUP BY day ORDER BY day",
        (*sns, first, last),
    )
    return {r["day"]: dict(r) for r in rows}


def _totals(rows) -> dict:
    rows = list(rows)
    out = {c: round(sum(r[c] for r in rows), 3) for c in ENERGY_COLS}
    out["grid_up_hours"] = round(sum(r["grid_up_s"] for r in rows) / 3600, 2)
    return out


def _group(daily: dict[str, dict], costs: dict[str, float], key) -> list[dict]:
    groups: dict[str, list[str]] = {}
    for day in sorted(daily):
        groups.setdefault(key(day), []).append(day)
    return [{"key": k, **_totals(daily[d] for d in days), "cost_syp": sum(costs.get(d, 0.0) for d in days)}
            for k, days in groups.items()]


def _hourly_breakdown(store: Store, sns: list[str], d: date) -> list[dict]:
    if not sns:
        return []
    start, end = rollups.day_bounds(d)
    rows = store.query(
        f"SELECT bucket, SUM(pv_kwh) pv_kwh, SUM(load_kwh) load_kwh, SUM(grid_kwh) grid_kwh, SUM(bat_charge_kwh) bat_charge_kwh, "
        f"SUM(bat_discharge_kwh) bat_discharge_kwh, MAX(grid_up_s) grid_up_s FROM rollup_hourly "
        f"WHERE device_sn IN ({_in(sns)}) AND bucket >= ? AND bucket < ? GROUP BY bucket ORDER BY bucket",
        (*sns, start, end),
    )
    # Tariff cost is defined per day (marginal within the cycle); hours carry no cost of their own.
    return [{"key": datetime.fromtimestamp(r["bucket"], LOCAL_TZ).strftime("%H:00"), **_totals([dict(r)]), "cost_syp": None}
            for r in rows]
