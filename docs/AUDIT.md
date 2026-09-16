# dair_home — Audit (2026-09-17)

Snapshot of where the system is, measured against the local copy of `backend/data/` (12 MB, 23 CSVs, Oct 2025 → Apr 2026).

## 1. What exists

| Part | What it is | Runtime cost |
|---|---|---|
| `backend/main.py` (1,917 lines, one file) | FastAPI + APScheduler. Every 30 s: `plantDetails` + `get_energy_flow2` for 2 plants, `get_device_snapshot` for 1 battery. Flattens the whole JSON into one CSV per device per day. Serves export, battery, and grid-billing endpoints by re-parsing those CSVs. | 1 Python process |
| `server/` (Node, Manus template) | Serves the Vite build and proxies 7 routes to a **hard-coded public host** (`https://dair.drd-home.online`). Also has tRPC/drizzle/mysql/S3/LLM code that never runs. | 2nd process; Docker image ships the full `node_modules` (356 MB, dev deps included) |
| `client/` (React 19 + recharts + 27 Radix packages) | A single dashboard page with i18n (en/ar, RTL) and a currency switcher. | Heavy bundle, heavy SVG charts |
| Root `test_*.py`, `list_apis.py`, `search_*.py` | Untracked scratch scripts from reverse engineering the Felicity API. | ⚠️ **They contain the Felicity account email and password in plain text.** |

### Devices
Found in the `plantDeviceList` fields of the saved data:

| Plant | Plant ID | Devices |
|---|---|---|
| Ground_Floor | 11160008309715425 | inverter `020308004825320226` |
| First_Floor | 11160032281678305 | inverter `020308004825320563`, battery `072604830025322349` (alias "battery", `plantName` "first floor") |

The owner's portal confirms 5 devices (see the GOAL.md owner table):
- **Garden plant (new, not collected at all):** inverter `020308004825441198` + battery `072604820026022401` (FLA48200).
- **Shared battery:** battery `072604830025322349` belongs to "first floor" in the portal, but is physically wired to both the first and ground floor inverters.

## 2. Storage: why the SD card suffers

1. **`csv_append` rewrites the whole file** (`main.py:317-350`). When a file exists, it reads the header, reads every row into RAM, then writes the file back from scratch plus one row. With the 30 s poll this happens 3× per poll. Total bytes written per day grow with rows²: a 1.5 MB day file gets rewritten ~2,880 times, which is on the order of **GBs written per day per device**. This is the main SD-wear mechanism.
2. **~90% of rows are duplicates.** The devices report every 300 s (`data_reportFreq=300`). On 2026-04-20 there were 55 distinct `data_dataTime` values in 538 battery rows, and 54 distinct `ef_dataTime` values in 538 Ground_Floor rows.
3. **~85% of columns are dead weight.**
   - Plant rows: 199 columns, only 138 non-empty, 169 constant for the whole day, ~2.6 KB per row.
   - Battery rows: 550–668 columns, 142 non-empty, 507 constant.
   - The biggest pieces are re-serialized blobs repeated on every row: `pd_deviceSns`, `pd_plantDeviceList`, `pd_buttonAuthorityTag`, `ef_thMap`, `data_hotJson`, and the cell lists stored twice (as a list and as `cellVoltN`).
   - The data that actually varies is ~20 fields per device.
4. **Failure rows are stored.** An auth error (`998 Authentication failed`) or SSL error still appends a row with every other column empty.
5. **No retention or migration at all.** Files pile up forever. The "migration" is a startup scan that rewrites every CSV to drop PII columns.
6. **Logs:** `error.md` is 1 MB of the same SSL line repeated every 30 s. Container logs are not rotated.

## 3. The read path: why the Pi gets hot

- `_update_grid_stats` re-parses **today's whole CSV on every request** (`d == today_str`, line 1411). Both `/stats/grid-consumption` and `/stats/cycles` call it inline, and the dashboard polls `overview` every 30 s.
- `/export-compact?limit=1` (used for "latest") parses the **whole day** of both plant CSVs, plus the battery CSV, to return one row.
- `/api/energy/timeseries` asks for `limit=10000`: the whole day (~5,760 rows × 31 fields) is sent **on every poll**.
- On Linux most of this hits the page cache rather than literal SD reads. The real cost is CSV parse CPU and RAM churn, which turns into SD reads whenever a low-RAM Pi (also running Node) evicts the cache.

## 4. Correctness issues

| # | Issue | Where |
|---|---|---|
| C1 | **Grid kWh is 0.0 for every 2026 day.** `ef_acTtlInPower` is `0` on every row since Feb, yet `ef_acRInVolt` reads 206–220 V (the grid is present). **Resolved (2026-09-17): the zeros are real.** Cloud history for all three inverters on 2026-02-05, 04-20, 07-15, 09-10 and 09-15 shows `acTtlInpower` = 0 on every 5-minute sample. Work mode is 3 (off-grid, "Battery First (SBU)") and SoC never dropped below 30 %. October 2025 did show real import through the same field. Covered by `tests/test_grid_import.py`. Billing and cycle views depend on this. | `grid_stats_v2.json` |
| C2 | The battery belongs to First_Floor, but `export-compact` merges its SoC/power into **every** plant through a fuzzy timestamp join. There is no ownership model (see comments at `main.py:1138-1147`). | `main.py:1140-1191` |
| C3 | Battery cell voltage units changed from **V** (`3.47`, Feb) to **mV** (`3313`, Apr). Nothing normalizes them. | battery CSVs |
| C4 | Frontend/backend contract drift: the UI reads `insights.avg_grid_hours`, `bill_syp`, `cost_syp_marginal`, and `hours[]`, but the backend returns `bill` and `cost_marginal` and has no `insights` or `hours`. | `GridTrendsPanel.tsx`, `Home.tsx` |
| C5 | `verify=False` is set in 5 places. The Dockerfile diff (ca-certificates + certifi) already fixes the SSL errors, so TLS verification should be turned back on. | `main.py` |
| C6 | Date mismatch: `date_str` is a UTC date on the client and a Damascus date on the server, and the Node proxy computes day bounds in container UTC. | `Home.tsx:165`, `server/_core/index.ts` |
| C7 | `/battery/details` without `deviceSn` returns whichever battery happens to be last. That is fine with 1 battery and wrong with 2. | `main.py:1887` |
| C8 | Token file path is relative to the working directory (`token.txt`), and login has no lock: concurrent 998 responses trigger parallel logins. | `main.py:201`, `_authorized_request` |

## 5. Frontend

- **Refresh load:** each refresh is 4 requests sent one at a time. `loadData` depends on `firstLoadDone`, so the **first load runs twice** and the interval resets.
- **Timeseries processing:** 5+ passes over ~5,760 rows in the browser, then up to 1,440 points × ~6 recharts series ≈ 8–9k SVG nodes. `renderChart` isn't memoized, so it rebuilds 1,440 `toLocaleString` labels several times per poll.
- **Dead code:**
  - ~45 of 53 `components/ui/*` are unused (only card, badge, button, tabs, select, tooltip, dropdown-menu, and sonner are used).
  - `ComponentShowcase` (1,379 lines), `DashboardLayout*`, and `ElectricityStatusCard` are never routed.
  - Unused dependencies: `@aws-sdk/*`, `framer-motion`, `mysql2`, `axios`, `jose`, `drizzle-*`, `@trpc/*`, `@tanstack/react-query`, `cmdk`, `embla`, `vaul`, `react-day-picker`, `react-hook-form`, and more.
- `debugger;` statements ship to production (`api.ts:138,167,506,561`), and i18n runs with `debug: true`.
- `GridTrendsPanel.tsx` (1,046 lines) is mostly `??` chains guessing field names, a symptom of C4.
- There is no garden view, no per-battery view, and no second battery.

## 6. Target architecture

```
Felicity cloud ──(poll aligned to 5-min reportFreq, dedupe on dataTime)──► collector (in RAM)
                                                                             │ latest snapshot (RAM only)
                                                                             │ batch buffer, flush every 15 min
                                                                             ▼
                               SQLite (WAL, synchronous=NORMAL) on SD ── samples_5m (narrow typed columns)
                                                                     ── rollup_hourly / rollup_daily (+ grid kWh, PV kWh, batt in/out)
                                                                     ── devices / device_meta (static fields, written on change only)
                                                                     ── schema_version (numbered SQL migrations)
                                                                             ▲
                     gap backfill on startup from list_storageRealtimeData_new (cloud keeps 5-min history)
FastAPI (single process) ── /api/v1/live (RAM) · /api/v1/series (≤300 pts) · /api/v1/energy/{day,month,cycle,year} (rollups)
                         └─ serves client dist/ as static files (Node server removed)
```

Why this fits a Pi with an SD card:

- **Writes:** about 5–8 devices × 288 samples a day, ~150 B per row, is roughly 300 KB/day and ~100 MB/year of raw data. That is a few dozen small batched transactions per day instead of thousands of full-file rewrites.
- **Crash safety:** the cloud keeps 5-min history, so rows lost from the RAM buffer on a power cut are **re-fetched on startup**. That makes rare flushes safe.
- **Reads:** "latest" never touches disk. Charts read ≤300 pre-bucketed points. Billing reads daily rollups.
- **Retention:** raw 5-min rows are kept N days (default 180). Hourly and daily rollups are kept forever. Older raw data can go to a monthly `csv.gz` archive (optionally off-device) before `DELETE` + incremental vacuum. All retention steps are idempotent and have a `--dry-run` mode.
- **Migration:** a one-shot, idempotent CSV → SQLite importer that dedupes on (device, dataTime) and checks row-count parity. Source CSVs are deleted only after the parity check passes.
