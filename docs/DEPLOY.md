# Deploying on the Raspberry Pi

One container, one process: FastAPI collects from the Felicity cloud, stores it in SQLite on
`/srv/dair/data`, and serves the dashboard and API on port 3000, the old frontend's port (set `DAIR_PORT` to change it). The Node server is gone.

## What touches the SD card

| What | How often | Size |
|---|---|---|
| New samples (5 devices × one every 5 min) | one transaction every 15 min (`FLUSH_INTERVAL`) | about 220 KB per day |
| Rollups (hourly and daily kWh) | same transaction | a few KB |
| Retention (delete raw rows older than 180 days) | daily at 03:30 | frees space |
| Logs | only warnings, deduplicated; Docker keeps 3 × 1 MB | ≤ 3 MB |

- `/api/v1/live` is served from RAM.
- Charts read at most 300 rows.
- Bill views read the daily totals.
- On a power cut you lose at most the last 15 minutes of the buffer. The next start re-downloads it from the cloud's 5-minute history.

## Filling history from the cloud

The cloud keeps each device's 5-minute history for months, so the database can hold more than
the old CSVs ever did. Two mechanisms:

- **Gap after downtime:** on every start, `backfill` fetches from the newest stored reading up to now (up to `BACKFILL_MAX_DAYS`).
- **Full history, once:** on first start, `backfill-history` runs in the background.
  - It walks each device back from yesterday, one day at a time.
  - Days that already have ≥ 95 % of their readings are skipped with no request, so migrated CSV days cost nothing.
  - Every other day is fetched from the cloud, one request per second (`HISTORY_REQUEST_PAUSE`).
  - It stops once the cloud has returned nothing for `HISTORY_MAX_EMPTY_DAYS` (14) days in a row, meaning that device's history has run out, or at `HISTORY_SINCE` if you set it.
  - Rows are written about a week at a time, together with the rollups.
  - Progress is saved, so a restart resumes where it stopped. A finished device is never fetched again.
  - The Felicity API is slow (often about a minute per day of history) and drops connections now and then. Each day is retried twice (after 10 s and 60 s). A device that still fails is picked up again by an hourly job until every device is complete.
  - How far back the cloud goes (checked 2026-09-17): ground and first floor from about the end of January 2026, the garden from its install day 2026-05-05. Expect a few hours for the first run, and about 1 MB of database per month of history.
  - Set `HISTORY_BACKFILL=0` to turn it off.

> **Keep the Oct 2025 – Jan 2026 CSVs until they are migrated.** The cloud no longer has those
> days, so the old CSVs are the only copy. After `migrate-csv --verify` their energy totals live
> in the rollups forever. Raw 5-minute rows older than `RAW_RETENTION_DAYS` are still removed by
> retention, so keep the backup tarball from step 0 if you want the raw data.

To re-check a range by hand (for example after the cloud had an outage):

```bash
docker exec dair-home python -m app.cli backfill-history --since 2026-01-01 --force
```

## First run: migrate the old CSV data

Do this on the Pi, against the Pi's own CSVs. A parity check on another machine proves nothing
about the files on the Pi.

```bash
# 0. stop the old stack (Node + old backend) and back up the old data
docker compose down            # in the old deployment directory
sudo tar czf ~/dair-csv-backup-$(date +%F).tgz -C /path/to/old/backend data

# 1. put the old CSVs where the new container can read them
sudo mkdir -p /srv/dair/data/legacy
sudo cp /path/to/old/backend/data/*.csv /srv/dair/data/legacy/
sudo chown -R 1000:1000 /srv/dair/data

# 2. build and start the new container
cd ~/dair_home
docker compose -f deploy/docker-compose.yml up -d --build

# 3. import the CSVs in a one-off container with the collector off. It gets its own memory
#    limit, so it doesn't compete with the running service. Expect 10-20 minutes for a
#    year of CSVs on a Pi. --verify exits non-zero if any file fails its parity check.
docker compose -f deploy/docker-compose.yml run --rm -e COLLECTOR_ENABLED=0 dair \
    python -m app.cli migrate-csv --src /data/legacy --verify
#    Re-running is safe: files already imported insert 0 rows and are verified again.
#    If it stops with "database is locked" (a service flush landed at the same moment),
#    just run it again.

# 4. nothing to do for older history: on its first start the service walks back through the
#    cloud's 5-minute history in the background and fills every day that isn't complete
#    (including gaps between the old CSVs). Watch it with:
docker logs -f dair-home | grep history
```

After a week of the new system running correctly, delete the migrated CSVs. Only files whose
import passed parity and haven't changed since are removed:

```bash
docker exec dair-home python -m app.cli delete-csv --src /data/legacy            # dry run: lists files
docker exec dair-home python -m app.cli delete-csv --src /data/legacy --confirm
```

## Retention

- **Automatic:** retention runs daily at 03:30 (Asia/Damascus). It works in this order:
  1. Brings the hourly and daily rollups up to date.
  2. Only if `ARCHIVE_DIR` is set: writes raw samples older than `RAW_RETENTION_DAYS` to `ARCHIVE_DIR/samples_YYYY-MM_*.csv.gz`.
  3. Deletes those raw samples one day at a time.
  4. Returns the freed pages to the filesystem.
- **Charts for older days:** they still work, using hourly averages from the rollups.
- **Run it by hand, or preview it:**

  ```bash
  docker exec dair-home python -m app.cli retention --dry-run
  docker exec dair-home python -m app.cli retention --raw-days 90 --archive-dir /mnt/usb/dair-archive
  ```

- **Archive:** off by default. An archive on the SD card would just move the data around on the same card, and the cloud keeps 5-minute history for months anyway. To keep raw history, mount a USB disk or NAS share and set `ARCHIVE_DIR` to a path on that mount.

## Schema changes

- **Where they live:** `backend/app/migrations/NNN_*.sql`.
- **When they run:** at startup, recorded in `schema_version`.
- **How to add one:** add a new numbered file. Never edit one that has already shipped.
- **Before upgrading:** back up with `sqlite3 /srv/dair/data/dair.sqlite3 ".backup /srv/dair/data/backup.sqlite3"`.

## Devices

- **Configuration:** `backend/topology.toml` lists plants, zones, inverters and batteries, including which zones a shared battery serves.
- **Checking for new devices:**
  1. After adding a device in the Felicity app, run `docker exec dair-home python -m app.cli discover`. It flags any device missing from `topology.toml`.
  2. Add the device to `topology.toml`, then rebuild.

## Building for the Pi from another machine

```bash
docker buildx build --platform linux/arm64 -t dair-home:latest --load .
docker save dair-home:latest | ssh pi 'docker load'
```
