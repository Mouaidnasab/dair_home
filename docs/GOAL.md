# GOAL — dair_home v2: Pi-friendly, SD-safe, garden-aware

**Goal:** One lightweight service on the Raspberry Pi that tracks **all** home energy devices (Ground Floor, First Floor, Garden: 3 inverters + 2 batteries, one of them shared by two floors). It stores them in SQLite with ≥50× fewer SD writes than today, has a safe migration and retention path for old data, and serves a fast dashboard without the Node server.

**Done means:** `bash scripts/verify_goal.sh` exits 0 **and** every box below is checked.

Background and numbers are in [AUDIT.md](AUDIT.md).

## Rules for whoever implements this
- Work phase by phase, in order. A box gets checked only after its verification ran green in the transcript.
- Run `bash scripts/verify_goal.sh` after each phase and paste the summary line.
- `scripts/verify_goal.sh` may gain checks. Never delete or weaken one; if a check is wrong, fix it and explain why in the commit message.
- Never delete anything under `backend/data/` or on the Pi. Migration writes a new DB. Deleting source CSVs is a separate, manual, `--confirm` step.
- Never commit credentials. `.env`, `token.txt`, and `backend/data` stay ignored.
- Commit at the end of each phase on the branch `v2-pi` (not `master`).
- If a device cannot be found in the Felicity account (Phase 0), write the finding under "Blockers" below and stop. Do not invent a topology.

## Phase 0 — Hygiene and topology
- [x] Move the reverse-engineering scripts (`test_*.py`, `list_apis.py`, `search_*.py`) into `backend/tools/`. They read credentials from `backend/.env` only, and no plaintext email or password remains anywhere in the repo.
- [x] Add `backend/tools/discover.py`. It logs in and lists every plant and device on the account (plant list + `plantDetails.plantDeviceList`), then prints SN, type, alias, and plant.
- [x] Save the raw discovery result, with PII removed, to `backend/tools/discovery_output.json`.
- [x] Write `backend/topology.toml` from **discovery only**. It lists each plant (id, label, `zone = "ground"|"first"|"garden"`), its inverters, and batteries with their owning zone(s) (a list, so a battery can serve several zones; `072604830025322349` has `zones = ["first", "ground"]` per the owner table below). Every discovered SN must appear. Reconcile against the owner's statements under "Blockers / answers from owner". Any owner-given SN that discovery did not return stays listed there as **unresolved**; never add it to the topology by hand.
- [x] Turn TLS verification back on (no `verify=False`). Keep the ca-certificates/certifi Dockerfile fix.

## Phase 1 — Backend restructure (no behaviour change yet)
- [x] Split `backend/main.py` into the package `backend/app/`: `config.py` (env + topology), `felicity.py` (client, login lock, token path under `DATA_DIR`), `collector.py`, `store.py`, `rollups.py`, `retention.py`, `api.py`, `cli.py`. `backend/main.py` becomes a thin `from app.api import app`.
- [x] Add a pytest suite in `backend/tests/` and `backend/requirements-dev.txt` (pytest, respx or a fake client). Tests never hit the network.

## Phase 2 — Storage (SQLite + SD-safe writes)
- [x] `store.py`: SQLite in WAL mode, `synchronous=NORMAL`, numbered migrations in `backend/app/migrations/NNN_*.sql`, and a `schema_version` table.
- [x] Tables: `devices`, `device_meta` (static fields, written only when a value changes), `samples` (device_sn, ts_utc, typed telemetry columns — no JSON blobs), `rollup_hourly`, `rollup_daily`.
- [x] Collector:
  - dedupes on the upstream `dataTime`
  - never stores failed responses
  - keeps the latest snapshot in RAM
  - buffers rows and flushes one transaction every `FLUSH_INTERVAL` (default 900 s) and on shutdown
  - schedules polls from the device `reportFreq` (default 300 s)
- [x] On startup, backfill gaps from `list_storageRealtimeData_new` since the last stored sample, capped at `BACKFILL_MAX_DAYS`.
- [x] Normalize cell voltages to volts: `>100` means mV.
- [x] `tests/test_write_budget.py`: simulate 24 h with a fake client for every topology device and assert ≤ 100 commits/day, ≤ 5 MB DB growth/day, and **no `.csv` file created** under `DATA_DIR`.
- [x] `tests/test_normalize.py`: cell voltages `3.47` (V) and `3313` (mV) both normalize to volts.
- [x] `tests/test_dedupe.py`: repeated `dataTime` stores exactly one row.

## Phase 3 — Migration and retention
- [x] `python -m app.cli migrate-csv --src <dir> --db <path> --verify`: idempotent (running twice adds 0 rows), skips failure and empty rows, dedupes on (sn, dataTime). It prints per-file parity (distinct valid samples in CSV == rows inserted) and exits non-zero on mismatch. Tested in `tests/test_migrate_csv.py` with fixture CSVs covering both old and new column sets.
- [x] `python -m app.cli retention [--dry-run] [--raw-days 180] [--archive-dir DIR]`: rolls up before deleting, optionally writes a monthly `csv.gz` archive, deletes raw rows older than N days in batches, then runs `PRAGMA incremental_vacuum`. Tested in `tests/test_retention.py` (rollups unchanged after raw deletion).
- [x] `python -m app.cli delete-csv --src <dir> --db <path> --confirm`: deletes only CSV days whose parity has been verified.
- [x] Retention runs daily from the scheduler at 03:30 Asia/Damascus.

## Phase 4 — API v2
- [x] `GET /api/v1/live`: all devices grouped by zone, served from RAM (zero disk I/O, asserted in a test).
- [x] `GET /api/v1/series?zone|sn&day&bucket`: ≤ 300 points, aggregated in SQL (`tests/test_api_series.py`).
- [x] `GET /api/v1/energy?period=day|month|cycle|year&date&currency`: PV, load, grid import, battery charge/discharge in kWh from rollups, plus the tiered bill. Field names match `client/src/types/energy.ts` exactly (fixes C4).
- [x] C1 (grid kWh = 0 since Feb 2026, while grid voltage reads 206–220 V): find which field or endpoint now carries grid import (check `list_storageRealtimeData_new` history, `pd_todayGridInput`, meter/CT fields) and record the answer in AUDIT.md. `tests/test_grid_import.py` asserts:
  - (a) the importer plus energy endpoint give ≈2.76 kWh for the fixture day 2025-10-22
  - (b) the collector persists the grid-import field identified for current firmware
  - (c) a 2026 fixture sample with grid import gives non-zero kWh, if the investigation shows import happens
- [x] Tariff tiers (300 kWh @ 600, above @ 1400 SYP) and the 2-month cycle move to config instead of being hard-coded.
- [x] FastAPI serves the built client (`dist/public`) with SPA fallback. Old endpoints stay only as thin adapters, or are removed once the client no longer uses them.

## Phase 5 — Frontend
- [x] Remove `server/`, `drizzle/`, `shared/_core`, tRPC, react-query, `ComponentShowcase`, `DashboardLayout*`, and unused `components/ui/*` (≤ 12 left). Drop unused dependencies from `package.json`.
- [x] `client/src/lib/api.ts` talks to `/api/v1/*` only. One `live` poll per 60 s (paused when the tab is hidden) plus series/energy on demand. No `debugger`, no i18n `debug`. The double-load bug is fixed and dates use Asia/Damascus.
- [x] Add a Garden zone card and a battery card per battery showing its owning zones (en + ar strings).
- [x] Charts: pre-bucketed data, memoized. `GridTrendsPanel` is lazy-loaded.
- [x] `pnpm check` and `pnpm build:client` pass. The main JS chunk is ≤ 350 KB (uncompressed, as reported by vite).

## Phase 6 — Pi deployment
- [x] `deploy/docker-compose.yml`: one service (backend + static client), `mem_limit`, json-file log rotation (`max-size`), `DATA_DIR` volume, `TZ=Asia/Damascus`, and `/tmp` on tmpfs.
- [x] Multi-stage Dockerfile: node builds the client, and the runtime image is `python:3.12-slim` only (no node_modules). It builds for `linux/arm64`.
- [x] `docs/DEPLOY.md`: first-run migration steps on the Pi (backup → migrate-csv --verify **on the Pi's own CSVs**; parity is per machine → run → delete-csv --confirm after a week).

## Blockers / answers from owner
Owner's device list (Felicity web portal screenshot, 2026-09-17). This is authoritative; discovery must match it:

| Device SN | Type | Model | Alias | Plant (portal) | Zone |
|---|---|---|---|---|---|
| 020308004825320226 | Inverter | IVEM8048 | — | grand floor (11160008309715425) | ground |
| 020308004825320563 | Inverter | IVEM8048 | — | first floor (11160032281678305) | first |
| 072604830025322349 | Battery Pack | FLA48300 | battery | first floor | **shared: first + ground** (physically wired to both inverters; portal lists it only under first floor) |
| 020308004825441198 | Inverter | IVEM8048 | inventor | Garden (plant id: from discovery) | garden |
| 072604820026022401 | Battery Pack | FLA48200 | battery garden | Garden | garden |

- The owner earlier wrote `020308004825320226` as the garden inverter by mistake. The garden inverter is `020308004825441198`.
- Operating mode for all zones: **solar → battery → grid only when needed** (SBU / battery-first). So grid import of 0 for long stretches is plausible, and C1 may be real rather than a bug. Confirm with history data before "fixing" it.
- The shared battery's single reading must not be double-counted in whole-home totals. In per-zone views, show it as shared rather than splitting it.
- **Phase 0 discovery (2026-09-17):** it matches the owner table exactly, with nothing unresolved.
  - Garden plant id: `11728964549835233`.
  - Device clocks: ground and garden devices are UTC+02:00; first-floor devices are UTC+03:00.
  - Every device reports every 300 s.
  - Cloud 5-minute history goes back to at least Feb 2026.
- **Phase 5 note:** the old 1,046-line `GridTrendsPanel` was replaced by `EnergyPanel` (day/month/cycle/year, tiered bill, recent cycles). `EnergyPanel` and `PowerChart` are lazy-loaded, so recharts stays out of the first-paint bundle.
- **Phase 6 note (2026-09-17):** the image itself has **not** been built yet. On the dev Mac, Docker Desktop was unhealthy: pulls hung inside `docker-credential-desktop get`, and after a restart even `docker info` hung. The host reaches `registry-1.docker.io` normally (HTTP 401 in 0.46 s), so this is a local Docker Desktop problem, not a registry block. The build was verified step by step without Docker instead:
  - clean context filtered by `.dockerignore`
  - `pnpm install --frozen-lockfile` and `pnpm run build`
  - `pip install -r requirements.txt`
  - uvicorn serving `/` and `/api/v1/*` from the stage-2 layout
  - `pip download --platform manylinux2014_aarch64 --only-binary=:all:` for every dependency
  The first real `docker compose ... up --build` happens on the Pi (docs/DEPLOY.md).
- **Phase 5 render check (2026-09-17):** the built dashboard was rendered in headless Chrome against live data. That caught and fixed a vendor-chunk import cycle that left the page blank ("reading 'forwardRef'"). `verify_goal.sh` now fails on chunk import cycles. English and Arabic (RTL) layouts were checked at desktop width and at 520 px.
