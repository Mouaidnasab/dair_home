# dair_home

Home energy monitor for the Deir Attiyeh house: two independent solar systems on Felicity IVEM8048 inverters.

- **Home:** ground floor and first floor inverters sharing one battery pack.
- **Garden:** its own inverter and battery pack.

It pulls from the Felicity Shine cloud, stores readings in SQLite, and serves a bilingual (en/ar) dashboard. It is built to run on a Raspberry Pi with an SD card.

```
backend/          FastAPI service (collector, store, API, CLI)   → backend/app/
backend/topology.toml   systems, plants/zones, devices (from `python -m app.cli discover`)
client/           React dashboard (Vite, Tailwind, recharts)
deploy/           docker-compose for the Pi
docs/             AUDIT.md (why v2), GOAL.md (plan), DEPLOY.md (install, migration, retention)
```

## Develop

```bash
# backend
cd backend
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env   # FELICITY_USER, FELICITY_PASS, optional API_KEY_EXCHANGE
.venv/bin/python -m pytest -q
.venv/bin/uvicorn main:app --reload        # :8000, collector on when credentials are set

# dashboard (proxies /api to :8000)
pnpm install
pnpm dev
pnpm check && pnpm build                    # → dist/public (served by the backend in production)
```

## API

| Endpoint | What it returns | Where the data comes from |
|---|---|---|
| `GET /api/v1/live` | Newest reading per device, per zone, and per system (`home`, `garden`) | RAM |
| `GET /api/v1/series?day=&zone=\|sn=` | One day of power, ≤ 300 points | samples (falls back to hourly rollups) |
| `GET /api/v1/energy?period=day\|month\|cycle\|year&date=&zone=&currency=` | kWh totals, breakdown, tiered grid bill | rollups |
| `GET /api/v1/cycles?zone=&currency=` | Recent billing cycles | rollups |
| `GET /api/v1/topology`, `/api/v1/health` | Configuration and status | — |

## Maintenance

`python -m app.cli` has these commands:

- `discover`
- `migrate-csv --src DIR --verify`
- `delete-csv --src DIR [--confirm]`
- `retention [--dry-run]`
- `backfill --days N`
- `backfill-history [--since YYYY-MM-DD] [--force]`
- `rebuild-rollups`

See [docs/DEPLOY.md](docs/DEPLOY.md) for what each one does.
