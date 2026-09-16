import shutil
from pathlib import Path

from app import migrate
from app.cli import main as cli
from tests.conftest import FIXTURES

LEGACY = FIXTURES / "legacy"


def test_import_is_verified_and_idempotent(store, topology):
    first = migrate.migrate_csv(store, topology, LEGACY, log=lambda *a: None)
    assert len(first) == 4 and all(r.ok for r in first)
    by_file = {r.file: r for r in first}
    # Oct 2025 plant file: 49 rows polled every 30 s, but only 6 distinct upstream samples
    ground = by_file["Ground_Floor_11160008309715425_2025-10-22.csv"]
    assert (ground.rows, ground.samples, ground.device_sn) == (49, 6, "020308004825320226")
    # April battery file starts with auth-failure rows, which are skipped
    april = by_file["Battery_1_072604830025322349_2026-04-20.csv"]
    assert april.rows == 40 and april.samples < 10
    total = store.count_samples()

    second = migrate.migrate_csv(store, topology, LEGACY, log=lambda *a: None)
    assert all(r.ok for r in second)
    assert sum(r.inserted for r in second) == 0
    assert store.count_samples() == total


def test_both_cell_voltage_formats_import_as_volts(store, topology):
    migrate.migrate_csv(store, topology, LEGACY, log=lambda *a: None)
    rows = store.query("SELECT cell_v_max FROM samples WHERE device_sn='072604830025322349' AND cell_v_max IS NOT NULL")
    assert rows and all(3.0 < r[0] < 3.7 for r in rows)


def test_cli_verify_and_delete_only_verified(tmp_path, topology):
    src = tmp_path / "csv"
    shutil.copytree(LEGACY, src)
    (src / "export_raw_ALL_20260101_000000.csv").write_text("timestamp\n")  # not a device file: kept
    db = tmp_path / "m.sqlite3"
    assert cli(["migrate-csv", "--src", str(src), "--db", str(db), "--verify"]) == 0
    assert cli(["delete-csv", "--src", str(src), "--db", str(db)]) == 0  # dry run
    assert len(list(src.glob("*.csv"))) == 5
    assert cli(["delete-csv", "--src", str(src), "--db", str(db), "--confirm"]) == 0
    assert [p.name for p in src.glob("*.csv")] == ["export_raw_ALL_20260101_000000.csv"]
