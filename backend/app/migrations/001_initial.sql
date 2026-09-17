-- Devices known to the store (mirrors topology.toml at startup).
CREATE TABLE devices (
    sn     TEXT PRIMARY KEY,
    kind   TEXT NOT NULL,
    plant  TEXT NOT NULL,
    zones  TEXT NOT NULL          -- comma separated
) WITHOUT ROWID;

-- Slow-changing device facts (firmware, clock, mode). Written only when a value changes.
CREATE TABLE device_meta (
    sn          TEXT NOT NULL,
    key         TEXT NOT NULL,
    value       TEXT,
    updated_ts  INTEGER NOT NULL,
    PRIMARY KEY (sn, key)
) WITHOUT ROWID;

-- One row per upstream report (every ~300 s per device). ts = unix seconds UTC.
CREATE TABLE samples (
    device_sn    TEXT    NOT NULL,
    ts           INTEGER NOT NULL,
    pv_w         REAL, load_w REAL, grid_w REAL, grid_v REAL, grid_hz REAL, out_v REAL,
    bat_w        REAL, soc REAL, bat_v REAL, bat_a REAL, soh REAL, temp_c REAL, inv_temp_c REAL,
    cell_v_max   REAL, cell_v_min REAL, e_pv_today REAL, e_load_today REAL, work_mode INTEGER,
    PRIMARY KEY (device_sn, ts)
) WITHOUT ROWID;
CREATE INDEX samples_ts ON samples (ts);

-- Energy per device per hour (bucket = unix seconds of the hour start, UTC). Kept forever.
CREATE TABLE rollup_hourly (
    device_sn          TEXT    NOT NULL,
    bucket             INTEGER NOT NULL,
    pv_kwh             REAL NOT NULL DEFAULT 0,
    load_kwh           REAL NOT NULL DEFAULT 0,
    grid_kwh           REAL NOT NULL DEFAULT 0,
    bat_charge_kwh     REAL NOT NULL DEFAULT 0,
    bat_discharge_kwh  REAL NOT NULL DEFAULT 0,
    grid_up_s          INTEGER NOT NULL DEFAULT 0,
    soc_min REAL, soc_max REAL, soc_avg REAL,
    samples            INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (device_sn, bucket)
) WITHOUT ROWID;

-- Same, per Asia/Damascus calendar day ('YYYY-MM-DD'). Kept forever.
CREATE TABLE rollup_daily (
    device_sn          TEXT NOT NULL,
    day                TEXT NOT NULL,
    pv_kwh             REAL NOT NULL DEFAULT 0,
    load_kwh           REAL NOT NULL DEFAULT 0,
    grid_kwh           REAL NOT NULL DEFAULT 0,
    bat_charge_kwh     REAL NOT NULL DEFAULT 0,
    bat_discharge_kwh  REAL NOT NULL DEFAULT 0,
    grid_up_s          INTEGER NOT NULL DEFAULT 0,
    soc_min REAL, soc_max REAL, soc_avg REAL,
    samples            INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (device_sn, day)
) WITHOUT ROWID;

-- Legacy CSV files imported and verified (drives `cli delete-csv`).
CREATE TABLE csv_imports (
    file         TEXT PRIMARY KEY,
    device_sn    TEXT NOT NULL,
    size         INTEGER NOT NULL,
    samples      INTEGER NOT NULL,
    verified_ts  INTEGER
) WITHOUT ROWID;

-- Small key/value state, e.g. raw_cutoff_ts written by retention.
CREATE TABLE kv (
    key    TEXT PRIMARY KEY,
    value  TEXT
) WITHOUT ROWID;
