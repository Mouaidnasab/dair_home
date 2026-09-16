"""Maintenance commands. Run from backend/:  python -m app.cli <command> --help"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from . import migrate, retention, rollups
from .config import Settings, Topology
from .store import Store


def _store(args, settings: Settings) -> Store:
    return Store(Path(args.db) if args.db else settings.db_path)


def main(argv: list[str] | None = None) -> int:
    settings = Settings.from_env()
    p = argparse.ArgumentParser(prog="python -m app.cli")
    p.add_argument("--topology", default=str(settings.topology_path))
    sub = p.add_subparsers(dest="cmd", required=True)

    m = sub.add_parser("migrate-csv", help="import v1 daily CSVs into SQLite (idempotent)")
    m.add_argument("--src", required=True)
    m.add_argument("--db")
    m.add_argument("--verify", action="store_true", help="exit non-zero unless every file passes parity")

    d = sub.add_parser("delete-csv", help="delete CSVs whose import was verified")
    d.add_argument("--src", required=True)
    d.add_argument("--db")
    d.add_argument("--confirm", action="store_true", help="actually delete (default: list only)")

    r = sub.add_parser("retention", help="archive + delete raw samples older than N days")
    r.add_argument("--db")
    r.add_argument("--raw-days", type=int, default=settings.raw_retention_days)
    r.add_argument("--archive-dir")
    r.add_argument("--dry-run", action="store_true")

    b = sub.add_parser("backfill", help="fetch cloud history for gaps (needs credentials)")
    b.add_argument("--db")
    b.add_argument("--days", type=int, default=settings.backfill_max_days)

    rb = sub.add_parser("rebuild-rollups", help="recompute rollups from all raw samples")
    rb.add_argument("--db")

    sub.add_parser("discover", help="list plants and devices on the Felicity account")

    args = p.parse_args(argv)
    topology = Topology.load(Path(args.topology))

    if args.cmd == "migrate-csv":
        store = _store(args, settings)
        results = migrate.migrate_csv(store, topology, Path(args.src))
        bad = [x for x in results if not x.ok]
        print(f"files={len(results)} samples={sum(x.samples for x in results)} inserted={sum(x.inserted for x in results)} "
              f"parity_failures={len(bad)} db_samples={store.count_samples()}")
        return 1 if (args.verify and bad) else 0

    if args.cmd == "delete-csv":
        store = _store(args, settings)
        migrate.delete_verified_csv(store, Path(args.src), confirm=args.confirm)
        return 0

    if args.cmd == "retention":
        store = _store(args, settings)
        rep = retention.run(store, args.raw_days, Path(args.archive_dir) if args.archive_dir else None, dry_run=args.dry_run)
        print(json.dumps(rep, indent=2))
        return 0

    if args.cmd == "rebuild-rollups":
        store = _store(args, settings)
        with store.transaction():
            for row in store.query("SELECT device_sn, MIN(ts) lo, MAX(ts) hi FROM samples GROUP BY device_sn"):
                rollups.refresh(store, row["device_sn"], row["lo"], row["hi"])
        print("rollups rebuilt")
        return 0

    if not (settings.felicity_user and settings.felicity_pass):
        print("FELICITY_USER / FELICITY_PASS missing (backend/.env)", file=sys.stderr)
        return 2

    from .collector import Collector
    from .felicity import FelicityClient

    async def with_client(fn):
        client = FelicityClient(settings.felicity_user, settings.felicity_pass, settings.data_dir / "token.txt")
        try:
            return await fn(client)
        finally:
            await client.aclose()

    if args.cmd == "backfill":
        store = _store(args, settings)

        async def run(client):
            c = Collector(settings, topology, store, client)
            c.load_state()
            return await c.backfill(args.days)

        print(f"backfilled {asyncio.run(with_client(run))} samples")
        return 0

    if args.cmd == "discover":
        async def run(client):
            return await client.plants(), await client.devices()

        plants, devices = asyncio.run(with_client(run))
        known = {d.sn for d in topology.devices}
        for pl in plants:
            print(f"PLANT  {pl.get('id')}  {pl.get('plantName')}")
        for dv in devices:
            flag = "" if dv.get("deviceSn") in known else "   <-- not in topology.toml"
            print(f"DEVICE {dv.get('deviceSn')}  {dv.get('deviceType')}  {dv.get('deviceModel')}  plant={dv.get('plantName')}{flag}")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
