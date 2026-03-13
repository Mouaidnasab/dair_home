from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from apscheduler.schedulers.asyncio import AsyncIOScheduler
import httpx
import os
import csv
import io
import json
import heapq
import asyncio
from typing import Iterator
from datetime import datetime, timedelta, date
from typing import Dict, Any, Optional, List, Tuple, Iterable
from dotenv import load_dotenv
from pathlib import Path
import base64
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import serialization

# Python 3.9+: standard timezones
from zoneinfo import ZoneInfo

# ======================
# Init / Env
# ======================
load_dotenv()

app = FastAPI()

# --- Fixed Syria TZ (Asia/Damascus) ---
SYRIA_TZ = ZoneInfo("Asia/Damascus")

LOGIN_URL = "https://shine-api.felicitysolar.com/userlogin"
PLANT_DETAILS_URL = "https://shine-api.felicitysolar.com/plant/plantDetails"
ENERGY_FLOW_URL = "https://shine-api.felicitysolar.com/device/get_energy_flow2"
SNAPSHOT_URL = "https://shine-api.felicitysolar.com/device/get_device_snapshot"

FELICITY_USER = os.getenv("FELICITY_USER", "").strip()
FELICITY_PASS = os.getenv("FELICITY_PASS", "").strip()
FELICITY_DEVICE_SN = os.getenv("FELICITY_DEVICE_SN", "")  # optional
FETCH_INTERVAL = int(os.getenv("FETCH_INTERVAL", "30"))  # seconds (30 = twice/minute)


if not FELICITY_USER or not FELICITY_PASS:
    raise RuntimeError(
        "FELICITY_USER and FELICITY_PASS must be set in the environment (.env)."
    )

API_KEY_EXCHANGE = os.getenv("API_KEY_EXCHANGE") or os.getenv("api_key_exchange")
# Valid currencies
CURRENCIES = ["SYP", "NEW SYP", "USD", "SAR"]
EXCHANGE_RATES = {
    "SYP": 1.0,  # Base (Old SYP)
    "NEW SYP": 0.01,  # 1 Old SYP = 0.01 New SYP
    "USD": 0.0,
    "SAR": 0.0,
}
LAST_EXCHANGE_UPDATE: Optional[datetime] = None


# Two plants (inverters)
PLANTS: List[Tuple[str, str]] = [
    ("11160008309715425", "Ground_Floor"),
    ("11160032281678305", "First_Floor"),
]

# Batteries (SN, Label)
BATTERIES: List[Tuple[str, str]] = [
    ("072604830025322349", "Battery_1"),
]

DATA_DIR = Path(os.getenv("DATA_DIR", "./data")).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)

# -------- PII Filtering --------
GRID_STATS_PATH = DATA_DIR / "grid_stats_v2.json"
OLD_GRID_STATS_PATH = DATA_DIR / "grid_stats.json"

# State for progress tracking
GRID_STATS_PROGRESS = {
    "status": "idle",
    "percent": 0,
    "current_day": 0,
    "total_days": 0,
    "last_update": None,
}

EXCLUDED_FIELDS = {
    "pd_provinceId",
    "pd_provinceName",
    "pd_plantLocation",
    "pd_address",
    "pd_email",
    "pd_ownerName",
    "pd_longitude",
    "pd_latitude",
}


def _cleanup_csv_file(csv_file: Path) -> None:
    """Helper to clean a single CSV file synchronously."""
    temp_file = csv_file.with_suffix(".tmp")
    try:
        # Check if file needs cleaning roughly first?
        # Ideally we read header to decide.
        with open(csv_file, "r", newline="", encoding="utf-8") as f_in:
            reader = csv.DictReader(f_in)
            header = reader.fieldnames
            if not header:
                return

            to_remove = [h for h in header if h in EXCLUDED_FIELDS]
            if not to_remove:
                return

            # Needs cleaning
            new_header = [h for h in header if h not in EXCLUDED_FIELDS]
            # Write to temp
            with open(temp_file, "w", newline="", encoding="utf-8") as f_out:
                writer = csv.DictWriter(f_out, fieldnames=new_header)
                writer.writeheader()
                for row in reader:
                    # Filter row based on new header
                    writer.writerow({k: v for k, v in row.items() if k in new_header})

        # Replace original
        temp_file.replace(csv_file)
        print(f"[Cleanup] Cleaned {csv_file.name} (removed: {to_remove})")

    except Exception as e:
        if temp_file.exists():
            try:
                temp_file.unlink()
            except:
                pass
        print(f"[Cleanup] Failed to clean {csv_file.name}: {e}")


def _cleanup_existing_csvs_sync():
    """Removes sensitive columns from all CSV files in DATA_DIR once (Sync version)."""
    if not DATA_DIR.exists():
        return

    print(f"[Cleanup] Starting background scan in {DATA_DIR}...")
    try:
        csv_files = list(DATA_DIR.glob("*.csv"))
        for csv_file in csv_files:
            _cleanup_csv_file(csv_file)
    except Exception as e:
        print(f"[Cleanup] Critical error during scan: {e}")
    print("[Cleanup] Finished background scan.")


async def cleanup_existing_csvs_background():
    """Wrapper to run sync cleanup in a thread."""
    await asyncio.to_thread(_cleanup_existing_csvs_sync)


def _cleanup_old_stats_json():
    """Removes the old v1 grid stats file if it exists to force a clean v2 start."""
    if OLD_GRID_STATS_PATH.exists():
        try:
            OLD_GRID_STATS_PATH.unlink()
            print(f"[Cleanup] Removed old stats file: {OLD_GRID_STATS_PATH.name}")
        except Exception as e:
            print(f"[Cleanup] Failed to remove old stats file: {e}")


HTTP_CLIENT: Optional[httpx.AsyncClient] = None


@app.on_event("startup")
async def on_startup():
    # Init shared client
    global HTTP_CLIENT
    HTTP_CLIENT = httpx.AsyncClient(timeout=20, headers=BASE_HEADERS)

    # Start scheduler
    scheduler.add_job(update_exchange_rates, "interval", hours=1)
    scheduler.start()

    # Run cleanup in background so we don't block startup
    _cleanup_old_stats_json()
    asyncio.create_task(cleanup_existing_csvs_background())
    # Also trigger grid stats calculation in background
    asyncio.create_task(update_grid_stats_background())
    # Allow partial failure of exchange update without crashing
    asyncio.create_task(update_exchange_rates())


@app.on_event("shutdown")
async def on_shutdown():
    global HTTP_CLIENT
    if HTTP_CLIENT:
        await HTTP_CLIENT.aclose()
    scheduler.shutdown()


# -------------------------------

TOKEN_PATH = "token.txt"

BASE_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
    "Content-Type": "application/json",
    "Origin": "https://shine.felicityess.com",
    "Referer": "https://shine.felicityess.com/",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    "lang": "en_US",
    "sec-ch-ua": '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "source": "WEB",
}


# ======================
# Token helpers
# ======================
def _read_token_from_file() -> Optional[str]:
    if os.path.exists(TOKEN_PATH):
        with open(TOKEN_PATH, "r", encoding="utf-8") as f:
            t = f.read().strip()
            return t if t else None
    return None


def _save_token_to_file(token: str) -> None:
    with open(TOKEN_PATH, "w", encoding="utf-8") as f:
        f.write(token)
    try:
        os.chmod(TOKEN_PATH, 0o600)
    except Exception:
        pass


# Felicity JS Public Key
FELICITY_PUB_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnAJE68pjWZmtSg6ZJs9FZugJXC6bBSluTW6mJttOLOaljrdErVnM5DNN+YFzpB9pAysTErjY1bnSVuEwQSwptnqUji7Ch2qMj2n+0eCp8p6vtSh7/tFr2ul8nDRtkoswLANAIwtUk/G85ipMpmY1W642LImnEJmGkkddlbjbjxJTZWR5hc/d9cPWb+AR77LxFFrMik3c+44v1kQlIPFP6EjIbOvt/Lv7fHWD9JI/YzN4y1gK7C/VQdNGuikQyNg+5W3rg9ecYf9I5uLAQwY/hxeI3lbNsErebqKe2EbJ8AwcNIC0lDBz53Sq0ML89QapEuy3fB+upuctxLULVDCbNwIDAQAB"


def _encrypt_password(password: str) -> str:
    pem = f"-----BEGIN PUBLIC KEY-----\n{FELICITY_PUB_KEY}\n-----END PUBLIC KEY-----\n"
    pub_key = serialization.load_pem_public_key(pem.encode("utf-8"))
    encrypted = pub_key.encrypt(password.encode("utf-8"), padding.PKCS1v15())
    return base64.b64encode(encrypted).decode("utf-8")


async def login_and_get_token() -> str:
    encrypted_pass = _encrypt_password(FELICITY_PASS)
    payload = {"userName": FELICITY_USER, "password": encrypted_pass, "version": "1.0"}

    # Use shared client if available, else transient (though startup guarantees it usually)
    if HTTP_CLIENT:
        r = await HTTP_CLIENT.post(LOGIN_URL, json=payload)
    else:
        async with httpx.AsyncClient(timeout=20, headers=BASE_HEADERS) as client:
            r = await client.post(LOGIN_URL, json=payload)

    r.raise_for_status()
    data = r.json()
    if not isinstance(data, dict):
        raise RuntimeError(f"Unexpected JSON format from login: {data}")

    data_val = data.get("data")
    token_1 = (
        data_val.get("token")
        if isinstance(data_val, dict)
        else (data_val if isinstance(data_val, str) else None)
    )

    resp_val = data.get("response")
    token_3 = resp_val.get("token") if isinstance(resp_val, dict) else None

    token = token_1 or data.get("token") or token_3
    if not token or not isinstance(token, str):
        raise RuntimeError("Login succeeded but token not found in response.")
    token = token.strip()
    _save_token_to_file(token)
    return token


async def get_token() -> str:
    token = _read_token_from_file()
    if token:
        return token
    return await login_and_get_token()


# ======================
# CSV helpers
# ======================
def _now_tz() -> datetime:
    """Current time in Syria time, tz-aware."""
    return datetime.now(SYRIA_TZ)


def _now_str() -> str:
    """ISO string with offset, in Syria time."""
    return _now_tz().isoformat(timespec="seconds")


def _flatten(prefix: str, obj: Any) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    if not isinstance(obj, dict):
        out[prefix.rstrip("_")] = obj
        return out
    for k, v in obj.items():
        out[f"{prefix}{k}"] = (
            json.dumps(v, ensure_ascii=False) if isinstance(v, dict) else v
        )
    return out


def csv_append(csv_path: Path, row: Dict[str, Any]) -> None:
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    file_exists = csv_path.exists()

    if file_exists:
        # Ensure header has all keys
        with open(csv_path, "r", newline="", encoding="utf-8") as f:
            reader = csv.reader(f)
            try:
                header = next(reader)
            except StopIteration:
                header = []
        for k in row.keys():
            if k not in header:
                header.append(k)
        # Re-write to add missing columns + append row
        if header:
            with open(csv_path, "r", newline="", encoding="utf-8") as f:
                rows = list(csv.DictReader(f))
            with open(csv_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=header)
                writer.writeheader()
                for r in rows:
                    writer.writerow({k: r.get(k, "") for k in header})
                writer.writerow({k: row.get(k, "") for k in header})
            return
    else:
        header = list(row.keys())

    with open(csv_path, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=header)
        if not file_exists:
            writer.writeheader()
        writer.writerow({k: row.get(k, "") for k in header})


def _plant_daily_csv_path(plant_id: str, label: str, d: Optional[date] = None) -> Path:
    """Per-plant, per-day CSV path, day computed in Syria time."""
    d = d or _now_tz().date()
    fname = f"{label}_{plant_id}_{d.isoformat()}.csv"
    return DATA_DIR / fname


def _iter_daily_paths_in_window(
    plant_id: str, label: str, start_dt: datetime, end_dt: datetime
) -> Iterable[Path]:
    """Yield all per-day paths (inclusive) intersecting [start_dt, end_dt] in Syria time."""
    # Normalize to Syria tz (in case we got aware in other tz)
    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=SYRIA_TZ)
    else:
        start_dt = start_dt.astimezone(SYRIA_TZ)
    if end_dt.tzinfo is None:
        end_dt = end_dt.replace(tzinfo=SYRIA_TZ)
    else:
        end_dt = end_dt.astimezone(SYRIA_TZ)

    cur = start_dt.date()
    last = end_dt.date()
    while cur <= last:
        yield _plant_daily_csv_path(plant_id, label, cur)
        cur = cur + timedelta(days=1)


def _battery_daily_csv_path(
    device_sn: str, label: str, d: Optional[date] = None
) -> Path:
    """Per-battery, per-day CSV path."""
    d = d or _now_tz().date()
    fname = f"{label}_{device_sn}_{d.isoformat()}.csv"
    return DATA_DIR / fname


# ======================
# HTTP helpers (auto-renew token, Bearer_ format)
# ======================
async def _authorized_request(
    method: str,
    url: str,
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[Dict[str, Any]] = None,
) -> httpx.Response:
    token = await get_token()
    if token and token.startswith("Bearer_"):
        auth_header = token
    else:
        auth_header = f"Bearer_{token}"

    # We overlay Authorization on top of base headers.
    # If HTTP_CLIENT is used, it already has BASE_HEADERS, but we need to inject Auth per request.
    # httpx clients merge request-level headers with client-level headers.
    req_headers = {"Authorization": auth_header}

    async def _do_req(client, h):
        return await client.request(
            method, url, params=params, json=json_body, headers=h
        )

    if HTTP_CLIENT:
        # Client has base headers
        try:
            r = await _do_req(HTTP_CLIENT, req_headers)
        except httpx.RequestError:
            # Retry once if connection failure (stale pool)
            r = await _do_req(HTTP_CLIENT, req_headers)
    else:
        # Fallback transient
        async with httpx.AsyncClient(timeout=20, headers=BASE_HEADERS) as client:
            r = await _do_req(client, req_headers)

    # If HTTP says token invalid, refresh & retry once
    if r.status_code in (401, 403):
        new_token = await login_and_get_token()
        req_headers["Authorization"] = f"Bearer_{new_token}"
        if HTTP_CLIENT:
            r = await _do_req(HTTP_CLIENT, req_headers)
        else:
            async with httpx.AsyncClient(timeout=20, headers=BASE_HEADERS) as client:
                r = await _do_req(client, req_headers)
        r.raise_for_status()
        return r

    # Try to inspect JSON body for "token has expired" message
    try:
        data = r.json()
    except Exception:
        # Not JSON or weird response → just enforce status and return
        r.raise_for_status()
        return r

    msg = str((data or {}).get("message", "")).lower()
    if "token has expired" in msg:
        # Body says token expired even though status wasn't 401/403
        new_token = await login_and_get_token()
        req_headers["Authorization"] = f"Bearer_{new_token}"
        if HTTP_CLIENT:
            r = await _do_req(HTTP_CLIENT, req_headers)
        else:
            async with httpx.AsyncClient(timeout=20, headers=BASE_HEADERS) as client:
                r = await _do_req(client, req_headers)
        r.raise_for_status()
        return r

    # Normal case
    r.raise_for_status()
    return r


# ======================
# Data pulls
# ======================
async def fetch_plant_details(plant_id: str) -> Dict[str, Any]:
    payload = {"plantId": plant_id, "currentDateStr": _now_str()}
    r = await _authorized_request("POST", PLANT_DETAILS_URL, json_body=payload)
    return r.json()


async def fetch_energy_flow(plant_id: str) -> Dict[str, Any]:
    params = {"plantId": plant_id, "deviceSn": FELICITY_DEVICE_SN or ""}
    r = await _authorized_request("GET", ENERGY_FLOW_URL, params=params)
    return r.json()


async def fetch_battery_snapshot(device_sn: str) -> Dict[str, Any]:
    payload = {
        "deviceSn": device_sn,
        "deviceType": "BP",
        # Using current time as dateStr might be required by API
        "dateStr": _now_str().replace("T", " "),
    }
    r = await _authorized_request("POST", SNAPSHOT_URL, json_body=payload)
    return r.json()


async def pull_once_for_plant(plant_id: str, label: str) -> Dict[str, Any]:
    pd = await fetch_plant_details(plant_id)
    ef = await fetch_energy_flow(plant_id)
    # Syria time ISO with offset
    now_iso = _now_str()
    row: Dict[str, Any] = {
        "timestamp": now_iso,
        "plantId": plant_id,
        "plantLabel": label,
        "pd_code": pd.get("code"),
        "pd_message": pd.get("message"),
        "ef_code": ef.get("code"),
        "ef_message": ef.get("message"),
    }
    row.update(_flatten("pd_", pd.get("data") or {}))
    row.update(_flatten("ef_", ef.get("data") or {}))

    # Filter out excluded fields
    row = {k: v for k, v in row.items() if k not in EXCLUDED_FIELDS}

    # Also clean the nested data in pd/ef for the direct return
    if pd.get("data"):
        pd["data"] = {
            k: v for k, v in pd["data"].items() if f"pd_{k}" not in EXCLUDED_FIELDS
        }
    if ef.get("data"):
        ef["data"] = {
            k: v for k, v in ef["data"].items() if f"ef_{k}" not in EXCLUDED_FIELDS
        }

    csv_path = _plant_daily_csv_path(plant_id, label)  # bucket by Syria day
    await asyncio.to_thread(csv_append, csv_path, row)
    return {"plantDetails": pd, "energyFlow": ef, "csv": str(csv_path)}


async def pull_once_for_battery(device_sn: str, label: str) -> Dict[str, Any]:
    snap = await fetch_battery_snapshot(device_sn)

    now_iso = _now_str()
    row: Dict[str, Any] = {
        "timestamp": now_iso,
        "deviceSn": device_sn,
        "deviceLabel": label,
        "code": snap.get("code"),
        "message": snap.get("message"),
    }
    # Flatten 'data' field
    row.update(_flatten("data_", snap.get("data") or {}))

    csv_path = _battery_daily_csv_path(device_sn, label)
    await asyncio.to_thread(csv_append, csv_path, row)
    return {"snapshot": snap, "csv": str(csv_path)}


# ======================
# Time-window/export helpers
# ======================
def _parse_iso(ts: str) -> datetime:
    """
    Robust ISO parse:
    - Accepts 'YYYY-MM-DD HH:MM:SS' or 'YYYY-MM-DDTHH:MM:SS[+offset]'
    - If naive (no tz), assume Syria time.
    - Always returns tz-aware in Syria time.
    """
    # Optimization: "T" replacement is implicit in fromisoformat in Py3.7+
    # But for safety with space separated legacy strings, we keep it checked?
    # Actually fromisoformat supports space separator only in very recent python.
    # Fast path: try direct parse, if fail, replace.
    # Most of our TS strings come from API which might be consistent.
    try:
        dt = datetime.fromisoformat(ts)
    except ValueError:
        # Fallback for space separator if fromisoformat failed (e.g. Py <3.11 with space)
        dt = datetime.fromisoformat(ts.replace("T", " "))

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=SYRIA_TZ)
    elif dt.tzinfo != SYRIA_TZ:
        # Only convert if strictly different object/offset
        dt = dt.astimezone(SYRIA_TZ)
    return dt


def _resolve_time_window(
    minutes: Optional[int],
    hours: Optional[int],
    start: Optional[str],
    end: Optional[str],
) -> tuple[datetime, datetime]:
    now = _now_tz()  # Syria time
    if start or end:
        start_dt = _parse_iso(start) if start else datetime.min.replace(tzinfo=SYRIA_TZ)
        end_dt = _parse_iso(end) if end else now
        if start_dt > end_dt:
            raise ValueError("start must be <= end")
        return start_dt, end_dt
    delta = timedelta(minutes=minutes or 0, hours=hours or 0)
    if delta.total_seconds() <= 0:
        delta = timedelta(minutes=60)
    return now - delta, now


def _yield_csv_rows_from_path(
    csv_path: Path, start_dt: datetime, end_dt: datetime
) -> Iterator[dict]:
    """Yields rows from CSV that fall within time range."""
    if not csv_path.exists():
        return
    # Ensure tz-aware Syria times
    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=SYRIA_TZ)
    if end_dt.tzinfo is None:
        end_dt = end_dt.replace(tzinfo=SYRIA_TZ)

    with open(csv_path, "r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            ts = row.get("timestamp")
            if not ts:
                continue
            try:
                row_dt = _parse_iso(ts)
            except Exception:
                continue
            if start_dt <= row_dt <= end_dt:
                yield row


def _filter_csv_by_time_from_path(
    csv_path: Path, start_dt: datetime, end_dt: datetime
) -> List[dict]:
    # Wrapper for legacy list support
    return list(_yield_csv_rows_from_path(csv_path, start_dt, end_dt))


def _select_plants(
    plantId: Optional[str], label: Optional[str]
) -> List[Tuple[str, str]]:
    if not plantId and not label:
        return PLANTS
    picks: List[Tuple[str, str]] = []
    for pid, lbl in PLANTS:
        if (plantId and pid == plantId) or (label and lbl == label):
            picks.append((pid, lbl))
    return picks


def _select_batteries(
    deviceSn: Optional[str], label: Optional[str]
) -> List[Tuple[str, str]]:
    if not deviceSn and not label:
        return BATTERIES
    picks: List[Tuple[str, str]] = []
    for sn, lbl in BATTERIES:
        if (deviceSn and sn == deviceSn) or (label and lbl == label):
            picks.append((sn, lbl))
    return picks


def _get_battery_rows(
    start_dt: datetime, end_dt: datetime, picks: List[Tuple[str, str]] = BATTERIES
) -> List[dict]:
    """Fetch and parse battery rows within a time window."""
    rows: List[dict] = []
    for sn, lbl in picks:
        for daily_path in _iter_daily_paths_in_window(sn, lbl, start_dt, end_dt):
            rows.extend(_filter_csv_by_time_from_path(daily_path, start_dt, end_dt))

    # Sort by timestamp
    rows.sort(key=lambda r: r.get("timestamp", ""))
    return rows


def _map_battery_summary(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "timestamp": row.get("timestamp"),
        "deviceSn": row.get("deviceSn"),
        "deviceLabel": row.get("deviceLabel"),
        "battSoc": _safe_int(row.get("data_battSoc")),
        "battVolt": _safe_float(row.get("data_battVolt")),
        "battCurr": _safe_float(row.get("data_battCurr")),
        "battPower": _safe_int(row.get("data_bmsPower")),
        "battTemp": _safe_int(
            row.get("data_tempMax")
        ),  # Using max temp as representative
        "status": row.get("data_status"),
    }


def _map_battery_details(row: Dict[str, Any]) -> Dict[str, Any]:
    # Start with summary
    base = _map_battery_summary(row)
    # Add details
    base.update(
        {
            "cellVoltList": row.get(
                "data_bmsVoltageList"
            ),  # Might need json parse if it's a string repr
            "cellTempList": row.get("data_cellTempList"),
            "bmsState": row.get("data_bmsState"),
            "bmsChargingState": row.get("data_bmsChargingState"),
            "cycles": row.get("data_batCycleIndex"),
            "soh": row.get("data_battSoh"),
            "capacity": row.get("data_battCapacity"),
            # Add other fields as needed
        }
    )
    return base


# ======================
# Compact field mapper (new export)
# ======================


def _safe_int(v: Any) -> int:
    try:
        if v is None or v == "":
            return 0
        return int(float(v))
    except Exception:
        return 0


def _safe_float(v: Any) -> float:
    try:
        if v is None or v == "":
            return 0.0
        return float(v)
    except Exception:
        return 0.0


def _map_compact_fields(row: Dict[str, Any]) -> Dict[str, Any]:
    def pick(*keys, default=""):
        for k in keys:
            val = row.get(k)
            if val not in (None, ""):
                return val
        return default

    return {
        "timestamp": row.get("timestamp"),
        "plantId": pick("plantId", "pd_id"),
        "plantLabel": pick("plantLabel", "pd_name"),
        "pd_pvTotalPower": _safe_int(row.get("pd_pvTotalPower")),
        "pd_ratedPower": _safe_int(row.get("pd_ratedPower")),
        "pd_todayPv": _safe_float(row.get("pd_todayPv")),
        "pd_monthPv": _safe_float(row.get("pd_monthPv")),
        "pd_yearPv": _safe_float(row.get("pd_yearPv")),
        "pd_accPv": _safe_float(row.get("pd_accPv")),
        "pd_totalReduceDeforestation": _safe_float(
            row.get("pd_totalReduceDeforestation")
        ),
        "pd_totalCo2Less": _safe_float(row.get("pd_totalCo2Less")),
        "pd_totalSpareCoal": _safe_float(row.get("pd_totalSpareCoal")),
        "pd_pvTodayIncome": _safe_int(row.get("pd_pvTodayIncome")),
        "pd_monthPvIncome": _safe_int(row.get("pd_monthPvIncome")),
        "pd_yearPvIncome": _safe_int(row.get("pd_yearPvIncome")),
        "pd_currency": pick("pd_currency", default="SYP"),
        "pd_countryName": pick("pd_countryName", default=""),
        "pd_cityName": pick("pd_cityName", default=""),
        "pd_status": pick("pd_status", default="N"),
        "ef_emsSoc": _safe_int(row.get("ef_emsSoc")),
        "ef_acTotalOutActPower": _safe_int(row.get("ef_acTotalOutActPower")),
        "ef_emsPower": _safe_int(row.get("ef_emsPower")),
        "ef_genPower": _safe_int(row.get("ef_genPower")),
        "ef_acTtlInPower": _safe_int(row.get("ef_acTtlInPower")),
        "ef_meterPower": _safe_int(row.get("ef_meterPower")),
        "ef_microInvTotalPower": _safe_int(row.get("ef_microInvTotalPower")),
        "ef_ctThreePhaseTotalPower": (
            _safe_int(row.get("ef_ctThreePhaseTotalPower"))
            or _safe_int(row.get("ef_acTotalOutActPower"))
            or 0
        ),
        "ef_deviceSn": pick("ef_deviceSn", default=""),
        "ef_deviceModel": pick("ef_deviceModel", default=""),
        "pd_installDateStr": pick("pd_installDateStr", default=""),
        "pd_timeZone": pick("pd_timeZone", default="UTC+02:00"),
        "pd_electricityPrice": _safe_int(row.get("pd_electricityPrice")),
        "ef_acRInVolt": _safe_float(row.get("ef_acRInVolt")),
    }


def _compact_header_order() -> List[str]:
    return [
        "timestamp",
        "plantId",
        "plantLabel",
        "pd_pvTotalPower",
        "pd_ratedPower",
        "pd_todayPv",
        "pd_monthPv",
        "pd_yearPv",
        "pd_accPv",
        "pd_totalReduceDeforestation",
        "pd_totalCo2Less",
        "pd_totalSpareCoal",
        "pd_pvTodayIncome",
        "pd_monthPvIncome",
        "pd_yearPvIncome",
        "pd_currency",
        "pd_countryName",
        "pd_cityName",
        "pd_status",
        "ef_emsSoc",
        "ef_acTotalOutActPower",
        "ef_emsPower",
        "ef_genPower",
        "ef_acTtlInPower",
        "ef_meterPower",
        "ef_microInvTotalPower",
        "ef_ctThreePhaseTotalPower",
        "ef_deviceSn",
        "ef_deviceModel",
        "pd_installDateStr",
        "pd_timeZone",
        "pd_electricityPrice",
        "ef_acRInVolt",
    ]


# ======================
# Scheduler
# ======================
scheduler = AsyncIOScheduler(
    job_defaults={
        "coalesce": True,
        "max_instances": 1,
        "misfire_grace_time": 60,
    }
)


@scheduler.scheduled_job("interval", seconds=FETCH_INTERVAL)
async def scheduled_job():
    tasks = []
    for pid, lbl in PLANTS:
        tasks.append(pull_once_for_plant(pid, lbl))
    for sn, lbl in BATTERIES:
        tasks.append(pull_once_for_battery(sn, lbl))

    # Run all pulls in parallel
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Log errors
    for i, res in enumerate(results):
        if isinstance(res, Exception):
            # We need to know which task failed
            is_plant = i < len(PLANTS)
            if is_plant:
                pid, lbl = PLANTS[i]
                print(
                    f"[{_now_tz().isoformat()}] Error pulling plant {lbl} ({pid}): {res}"
                )
            else:
                sn, lbl = BATTERIES[i - len(PLANTS)]
                print(
                    f"[{_now_tz().isoformat()}] Error pulling battery {lbl} ({sn}): {res}"
                )


# ======================
# API
# ======================
@app.get("/")
def status():
    today_paths = [
        {
            "plantId": pid,
            "label": lbl,
            "today_csv": str(_plant_daily_csv_path(pid, lbl)),
        }
        for pid, lbl in PLANTS
    ]
    battery_paths = [
        {
            "deviceSn": sn,
            "label": lbl,
            "today_csv": str(_battery_daily_csv_path(sn, lbl)),
        }
        for sn, lbl in BATTERIES
    ]
    return {
        "status": "running",
        "timezone": "Asia/Damascus",
        "now": _now_str(),
        "fetch_interval_seconds": FETCH_INTERVAL,
        "plants": today_paths,
        "batteries": battery_paths,
        # "data_dir": str(DATA_DIR),
        # "token_file": os.path.abspath(TOKEN_PATH),
    }


@app.post("/pull-now")
async def pull_now():
    results = {}
    for pid, lbl in PLANTS:
        results[lbl] = await pull_once_for_plant(pid, lbl)

    for sn, lbl in BATTERIES:
        results[lbl] = await pull_once_for_battery(sn, lbl)

    return {"message": "Pulled and saved (Syria time)", "results": results}


# -------- Original export (raw) --------
@app.get("/export")
async def export_data(
    plantId: Optional[str] = None,
    label: Optional[str] = None,
    minutes: Optional[int] = None,
    hours: Optional[int] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    fmt: str = "json",
    limit: int = 1000,
    dedupe: bool = True,
):
    try:
        start_dt, end_dt = _resolve_time_window(minutes, hours, start, end)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Bad time window: {e}")

    picks = _select_plants(plantId, label)
    if not picks:
        raise HTTPException(status_code=404, detail="No matching plant found")

    rows: List[dict] = []
    for pid, lbl in picks:
        for daily_path in _iter_daily_paths_in_window(pid, lbl, start_dt, end_dt):
            rows.extend(_filter_csv_by_time_from_path(daily_path, start_dt, end_dt))

    if dedupe:
        seen = set()
        unique: List[dict] = []
        for r in rows:
            key = (r.get("plantId"), r.get("timestamp"))
            if key not in seen:
                seen.add(key)
                unique.append(r)
        rows = unique

    rows.sort(key=lambda r: r.get("timestamp", ""))

    if fmt.lower() == "json":
        total = len(rows)
        if limit > 0:
            rows = rows[-limit:]
        return {
            "plantSelection": [{"plantId": pid, "label": lbl} for pid, lbl in picks],
            "start": start_dt.isoformat(),
            "end": end_dt.isoformat(),
            "count": len(rows),
            "total": total,
            "rows": rows,
        }

    # Legacy raw export logic below
    # (Removed duplicate/dead streaming comments)

    if fmt.lower() == "csv":
        if not rows:
            return {
                "plantSelection": [
                    {"plantId": pid, "label": lbl} for pid, lbl in picks
                ],
                "start": start_dt.isoformat(),
                "end": end_dt.isoformat(),
                "count": 0,
                "export_csv": None,
                "message": "No rows in the given window.",
            }
        header: List[str] = []
        for r in rows:
            for k in r.keys():
                if k not in header:
                    header.append(k)
        stamp = _now_tz().strftime("%Y%m%d_%H%M%S")
        tag = "ALL" if len(picks) > 1 else (picks[0][1])
        export_name = DATA_DIR / f"export_raw_{tag}_{stamp}.csv"

        # Optimization: Don't block event loop while writing
        await asyncio.to_thread(_write_csv_sync, export_name, header, rows)

        return {
            "plantSelection": [{"plantId": pid, "label": lbl} for pid, lbl in picks],
            "start": start_dt.isoformat(),
            "end": end_dt.isoformat(),
            "count": len(rows),
            "export_csv": str(export_name),
        }

    raise HTTPException(status_code=400, detail="fmt must be 'json' or 'csv'")


def _write_csv_sync(path, header, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=header)
        writer.writeheader()
        for r in rows:
            writer.writerow({k: r.get(k, "") for k in header})


# -------- New compact export (only requested fields) --------
@app.get("/export-compact")
async def export_compact(
    plantId: Optional[str] = None,
    label: Optional[str] = None,
    minutes: Optional[int] = None,
    hours: Optional[int] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    fmt: str = "json",
    limit: int = 1000,
    dedupe: bool = True,
):
    """
    Returns only the mapped fields specified by the user.
    Merges daily CSVs across the window into ONE output (json or csv).
    All times are interpreted and emitted in Syria time.
    """
    try:
        start_dt, end_dt = _resolve_time_window(minutes, hours, start, end)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Bad time window: {e}")

    picks = _select_plants(plantId, label)
    if not picks:
        raise HTTPException(status_code=404, detail="No matching plant found")

    raw_rows: List[dict] = []
    for pid, lbl in picks:
        for daily_path in _iter_daily_paths_in_window(pid, lbl, start_dt, end_dt):
            raw_rows.extend(_filter_csv_by_time_from_path(daily_path, start_dt, end_dt))

    if dedupe:
        seen = set()
        tmp: List[dict] = []
        for r in raw_rows:
            key = (r.get("plantId") or r.get("pd_id"), r.get("timestamp"))
            if key not in seen:
                seen.add(key)
                tmp.append(r)
        raw_rows = tmp

    raw_rows.sort(key=lambda r: r.get("timestamp", ""))

    # --- MERGE BATTERY DATA ---
    # Fetch battery data for the same window
    # Attempt to match battery row to plant row by time
    # This is a simple merge assuming one main battery or just grabbing the latest closest point.
    # Ideally we'd know which battery belongs to which plant, but simplistic time matching works for now.

    battery_rows = _get_battery_rows(start_dt, end_dt)
    # Index battery rows by timestamp for faster lookup?
    # Or just fuzzy match. Since alignment might not be perfect, let's just find the closest previous/next or exact match.
    # To be efficient, since both are sorted by time, we can walk.

    # But for now, simple O(N*M) or O(N) if we walk together.
    # Let's verify if we need strict plant->battery mapping.
    # "Battery_1" -> "Ground_Floor" (implied inverted logic? or just global battery data?)
    # The requirement is "replace the data with the new".

    # Let's create a lookup dict by truncated timestamp (minute resolution) for easier matching
    batt_lookup = {}
    for b in battery_rows:
        # Key by ISO timestamp (exact match preference)
        ts = b.get("timestamp")
        if ts:
            batt_lookup[ts] = b
            # Also key by 'YYYY-MM-DDTHH:MM' for minute-level fuzzy match
            batt_lookup[ts[:16]] = b

    # Map to compact schema with merge
    compact_rows = []
    for r in raw_rows:
        mapped = _map_compact_fields(r)

        # Merge battery data
        ts = r.get("timestamp", "")
        batt_row = batt_lookup.get(ts) or batt_lookup.get(ts[:16])

        if batt_row:
            # Inject new battery values
            mapped["ef_emsSoc"] = _safe_int(batt_row.get("data_battSoc"))
            mapped["ef_emsPower"] = _safe_int(batt_row.get("data_bmsPower"))
            # If map has battVolt? ef_battVolt usually exists?
            # Using data_battVolt for whatever field appropriate.
            # In compcat map, we only have ef_emsSoc, ef_emsPower from the list.
            # If there are other standard fields in the frontend that display voltage:
            # We should probably map them if they exist in _compact_header_order.

            # Note: ef_genPower is GEN power, likely not battery.
            # ef_deviceSn -> Battery SN
            # mapped["ef_deviceSn"] = batt_row.get("deviceSn") # Don't overwrite Inverter SN logic if it's used for something else, but here user asked to replace "battery number" maybe?
            # User said "replace with the battery number". Assuming they mean deviceSn.
            mapped["ef_deviceSn"] = batt_row.get("deviceSn")
            mapped["ef_deviceModel"] = batt_row.get("data_deviceModel")

            # Also pull Grid Voltage/Freq from battery snapshot if available
            # (though usually these are null on batteries and provided by inverters)
            if batt_row.get("data_acRInVolt") not in (None, "", 0, "0"):
                mapped["ef_acRInVolt"] = _safe_float(batt_row.get("data_acRInVolt"))

        compact_rows.append(mapped)

    total = len(compact_rows)
    if limit > 0:
        compact_rows = compact_rows[-limit:]

    if fmt.lower() == "json":
        return {
            "plantSelection": [{"plantId": pid, "label": lbl} for pid, lbl in picks],
            "start": start_dt.isoformat(),
            "end": end_dt.isoformat(),
            "count": len(compact_rows),
            "total": total,
            "rows": compact_rows,
        }

    if fmt.lower() == "csv":
        # Streaming logic for Compact fields (Known Schema)
        def _get_rows_gen():
            # Merge Plants
            def _get_plant_iterator(p_id, p_lbl):
                for daily_path in _iter_daily_paths_in_window(
                    p_id, p_lbl, start_dt, end_dt
                ):
                    yield from _yield_csv_rows_from_path(daily_path, start_dt, end_dt)

            p_iterators = [_get_plant_iterator(p, l) for p, l in picks]
            # Use 'timestamp' for merging
            merged_p = heapq.merge(*p_iterators, key=lambda r: r.get("timestamp", ""))

            # Streaming Dedupe
            if dedupe:
                seen = set()

                def _dedupe(it):
                    for r in it:
                        key = (r.get("plantId") or r.get("pd_id"), r.get("timestamp"))
                        if key not in seen:
                            seen.add(key)
                            yield r

                merged_p = _dedupe(merged_p)

            # Battery Data Loading (Still in memory for now as lookup is complex for streaming join)
            # Ideally we stream battery data too, but the join logic requires random access or synchronized streams.
            # Assuming battery data is small enough relative to plant data (usually 1:1 or less), we keep it as is?
            # Or we load battery data into time-keyed map.
            # To avoid huge memory, we could load battery data day-by-day? Too complex for now.
            # We'll use the pre-loaded battery lookup map.
            batt_lookup = {}
            # TODO: Optimize battery lookup to valid heavy memory usage.
            # For now, we load it. (Optimization: only load if needed).
            b_rows = _get_battery_rows(start_dt, end_dt)
            for b in b_rows:
                ts = b.get("timestamp")
                if ts:
                    batt_lookup[ts] = b
                    batt_lookup[ts[:16]] = b

            for r in merged_p:
                mapped = _map_compact_fields(r)
                # Merge battery
                ts = r.get("timestamp", "")
                batt_row = batt_lookup.get(ts) or batt_lookup.get(ts[:16])
                if batt_row:
                    mapped["ef_emsSoc"] = _safe_int(batt_row.get("data_battSoc"))
                    mapped["ef_emsPower"] = _safe_int(batt_row.get("data_bmsPower"))
                    mapped["ef_deviceSn"] = batt_row.get("deviceSn")
                    mapped["ef_deviceModel"] = batt_row.get("data_deviceModel")
                    if batt_row.get("data_acRInVolt") not in (None, "", 0, "0"):
                        mapped["ef_acRInVolt"] = _safe_float(
                            batt_row.get("data_acRInVolt")
                        )
                yield mapped

        # Generator for CSV lines
        def _csv_line_gen():
            header = _compact_header_order()
            yield ",".join(header) + "\n"

            output = io.StringIO()
            writer = csv.DictWriter(output, fieldnames=header)

            for row in _get_rows_gen():
                writer.writerow({k: row.get(k, "") for k in header})
                output.seek(0)
                line = output.read()
                output.seek(0)
                output.truncate(0)
                yield line

        stamp = _now_tz().strftime("%Y%m%d_%H%M%S")
        filename = f"export_compact_{stamp}.csv"
        return StreamingResponse(
            _csv_line_gen(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    raise HTTPException(status_code=400, detail="fmt must be 'json' or 'csv'")


# ======================
# New Battery Endpoints
# ======================
@app.get("/battery/summary")
def get_battery_summary(
    deviceSn: Optional[str] = None,
    label: Optional[str] = None,
    minutes: Optional[int] = None,
    hours: Optional[int] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: int = 1000,
):
    try:
        start_dt, end_dt = _resolve_time_window(minutes, hours, start, end)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Bad time window: {e}")

    picks = _select_batteries(deviceSn, label)
    raw_rows = _get_battery_rows(start_dt, end_dt, picks)

    summary_rows = [_map_battery_summary(r) for r in raw_rows]
    total = len(summary_rows)
    if limit > 0:
        summary_rows = summary_rows[-limit:]

    return {
        "selection": [{"deviceSn": sn, "label": lbl} for sn, lbl in picks],
        "start": start_dt.isoformat(),
        "end": end_dt.isoformat(),
        "count": len(summary_rows),
        "total": total,
        "rows": summary_rows,
    }


# ======================
# Grid Consumption / Pricing Ops
# ======================
# Cache for file structure to avoid scanning directory on every request
_DATE_MAP_CACHE = {
    "mtime": 0.0,
    "map": {},
}


def _get_cached_date_map() -> Dict[str, List[Path]]:
    """
    Returns a map of date_str -> [file_paths].
    Refreshes only if DATA_DIR mtime changed.
    """
    global _DATE_MAP_CACHE
    try:
        # Get directory stats
        stat = os.stat(DATA_DIR)
        curr_mtime = stat.st_mtime
    except OSError:
        return {}

    # If directory hasn't changed (much), return cached map
    # Using simple float comparison.
    if curr_mtime == _DATE_MAP_CACHE["mtime"] and _DATE_MAP_CACHE["map"]:
        return _DATE_MAP_CACHE["map"]

    # Rebuild map
    files = sorted(DATA_DIR.glob("*.csv"))
    plant_files = []
    for f in files:
        is_plant = False
        for pid, lbl in PLANTS:
            if pid in f.name:
                is_plant = True
                break
        if is_plant:
            plant_files.append(f)

    date_map: Dict[str, List[Path]] = {}
    for p in plant_files:
        try:
            parts = p.stem.split("_")
            d_str = parts[-1]
            date.fromisoformat(d_str)
            if d_str not in date_map:
                date_map[d_str] = []
            date_map[d_str].append(p)
        except Exception:
            continue

    _DATE_MAP_CACHE["mtime"] = curr_mtime
    _DATE_MAP_CACHE["map"] = date_map
    # print("[Stats] Refreshed file cache")
    return date_map


def _update_grid_stats() -> Dict[str, float]:
    """
    Scans all daily CSV files for Plants and computes daily kWh.
    Updates global GRID_STATS_PROGRESS.
    """
    global GRID_STATS_PROGRESS
    GRID_STATS_PROGRESS["status"] = "processing"
    GRID_STATS_PROGRESS["percent"] = 0
    GRID_STATS_PROGRESS["last_update"] = _now_str()

    if GRID_STATS_PATH.exists():
        try:
            with open(GRID_STATS_PATH, "r", encoding="utf-8") as f:
                stats = json.load(f)
        except Exception:
            stats = {}
    else:
        stats = {}

    today_str = _now_tz().date().isoformat()
    date_map = _get_cached_date_map()

    all_dates = sorted(date_map.keys())
    # Filter dates that actually need updating
    dates_to_process = [d for d in all_dates if d not in stats or d == today_str]

    GRID_STATS_PROGRESS["total_days"] = len(dates_to_process)
    GRID_STATS_PROGRESS["current_day"] = 0

    if not dates_to_process:
        GRID_STATS_PROGRESS["status"] = "ready"
        GRID_STATS_PROGRESS["percent"] = 100
        return stats

    updated = False
    for i, d_str in enumerate(dates_to_process):
        GRID_STATS_PROGRESS["current_day"] = i + 1
        GRID_STATS_PROGRESS["percent"] = int((i / len(dates_to_process)) * 100)

        # Log to console periodically or at specific intervals
        if i % 5 == 0 or i == len(dates_to_process) - 1:
            print(
                f"[Stats] Calculating grid usage: {GRID_STATS_PROGRESS['percent']}% ({i + 1}/{len(dates_to_process)} days)"
            )

        file_list = date_map[d_str]
        day_total_kwh = 0.0

        for fp in file_list:
            points: List[Tuple[float, float]] = []
            try:
                with open(fp, "r", newline="", encoding="utf-8") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        ts = row.get("timestamp")
                        pwr_str = row.get("ef_acTtlInPower")
                        if ts and pwr_str:
                            try:
                                dt = _parse_iso(ts)
                                w = float(pwr_str)
                                points.append((dt.timestamp(), w))
                            except:
                                pass

                if not points:
                    continue

                points.sort(key=lambda x: x[0])
                file_joules = 0.0
                for j in range(len(points) - 1):
                    t1, p1 = points[j]
                    t2, p2 = points[j + 1]
                    dt_sec = t2 - t1
                    if dt_sec > 1800:
                        continue
                    avg_p = (p1 + p2) / 2.0
                    file_joules += avg_p * dt_sec

                day_total_kwh += file_joules / 3600000.0
            except Exception as e:
                print(f"[Stats] Error processing {fp.name}: {e}")

        stats[d_str] = round(day_total_kwh, 4)
        updated = True

        # Save progress every 10 days to avoid full loss if crash
        if i % 10 == 0 and updated:
            with open(GRID_STATS_PATH, "w", encoding="utf-8") as f:
                json.dump(stats, f, indent=2)

    if updated:
        with open(GRID_STATS_PATH, "w", encoding="utf-8") as f:
            json.dump(stats, f, indent=2)

    GRID_STATS_PROGRESS["status"] = "ready"
    GRID_STATS_PROGRESS["percent"] = 100
    GRID_STATS_PROGRESS["last_update"] = _now_str()
    print(
        f"[Stats] Calculation complete: 100% ({len(dates_to_process)} days processed)"
    )
    return stats


async def update_grid_stats_background():
    """Wrapper to run grid stats update in a thread."""
    await asyncio.to_thread(_update_grid_stats)


# ======================
# Currency Exchange
# ======================
async def update_exchange_rates():
    """
    Fetches exchange rates from SYP to USD/SAR.
    Runs once an hour via scheduler.
    """
    global EXCHANGE_RATES, LAST_EXCHANGE_UPDATE

    if not API_KEY_EXCHANGE:
        print("[Exchange] check your .env, api_key_exchange is missing.")
        return

    # We want SYP -> USD and SYP -> SAR
    targets = ["USD", "SAR"]

    # Using 'convert' endpoint
    base_url = "https://api.getgeoapi.com/v2/currency/convert"

    async with httpx.AsyncClient(timeout=10) as client:
        for target in targets:
            params = {
                "api_key": API_KEY_EXCHANGE,
                "from": "SYP",
                "to": target,
                "amount": 1,
                "format": "json",
            }
            try:
                r = await client.get(base_url, params=params)
                r.raise_for_status()
                data = r.json()

                # Response structure:
                # {
                #   "status": "success",
                #   ...
                #   "rates": { "USD": { "rate": "0.000xyz", ... } }
                # }
                if data.get("status") == "success":
                    rates = data.get("rates", {})
                    target_data = rates.get(target)
                    if target_data:
                        rate_str = target_data.get("rate")
                        if rate_str:
                            EXCHANGE_RATES[target] = float(rate_str)
                            print(
                                f"[Exchange] Updated SYP -> {target}: {EXCHANGE_RATES[target]}"
                            )
                else:
                    print(
                        f"[Exchange] API Error for {target}: {data.get('error', {}).get('message')}"
                    )

            except Exception as e:
                print(f"[Exchange] Failed to update {target}: {e}")

    LAST_EXCHANGE_UPDATE = _now_tz()


def _convert_currency(amount_syp: float, target_currency: str) -> float:
    """
    Converts Old SYP amount to target currency.
    - NEW SYP: amount / 100
    - USD/SAR: (amount / 100) * rate_from_api
      Because API rates are based on the New SYP.
    """
    if target_currency == "SYP":
        return amount_syp

    if target_currency == "NEW SYP":
        return amount_syp / 100.0

    rate = EXCHANGE_RATES.get(target_currency, 0.0)
    if rate <= 0:
        print(f"[Exchange] Invalid rate for {target_currency}: {rate}")
        return 0.0

    # User said: divide by 100 then by (meaning multiply) the rate
    return (amount_syp / 100.0) * rate


def _convert_tiers(
    tiers: List[Dict[str, Any]], target_currency: str
) -> List[Dict[str, Any]]:
    """Helper to convert pricing tiers."""
    if target_currency == "SYP":
        return tiers

    new_tiers = []
    for t in tiers:
        nt = t.copy()
        # t["price"] is in base SYP (Old)
        # Convert it using the unified logic
        nt["price"] = round(_convert_currency(t["price"], target_currency), 4)
        new_tiers.append(nt)
    return new_tiers


def _calculate_bill(cycle_kwh: float) -> float:
    """
    Tiered pricing (Syrian Pounds):
    - First 300 kWh: 600 SYP/kWh
    - Above 300 kWh: 1400 SYP/kWh
    """
    if cycle_kwh <= 300:
        return cycle_kwh * 600
    else:
        # first 300 @ 600
        tier1 = 300 * 600
        # remainder @ 1400
        tier2 = (cycle_kwh - 300) * 1400
        return tier1 + tier2


@app.get("/stats/grid-consumption")
async def get_grid_stats_endpoint(
    period: str = "overview",  # overview, day, month, cycle, year
    date_str: Optional[str] = None,
    currency: str = "SYP",
):
    """
    Returns aggregated grid consumption (kWh) and Cost.
    Modes:
    - overview (default): Dashboard summary (Today, Month, Year, Total, Cycle Bill).
    - day: Stats for a specific day.
    - month: Breakdown of days in that month.
    - cycle: Breakdown of days in that 2-month cycle + Bill.
    - year: Breakdown of months in that year.

    Currency: SYP (default), USD, SAR.
    """
    currency = currency.upper()
    if currency not in CURRENCIES:
        raise HTTPException(
            status_code=400, detail=f"Currency must be one of {CURRENCIES}"
        )

    stats = await asyncio.to_thread(_update_grid_stats)

    if period == "overview" and GRID_STATS_PROGRESS["status"] == "processing":
        return {
            "status": "calculating",
            "progress": GRID_STATS_PROGRESS,
            "message": "Historical grid stats are being rebuilt. Please wait.",
        }
    if date_str:
        try:
            ref_date = date.fromisoformat(date_str)
        except ValueError:
            raise HTTPException(
                status_code=400, detail="Invalid date format YYYY-MM-DD"
            )
    else:
        ref_date = _now_tz().date()

    # Helpers
    def get_cycle_months(d: date) -> Tuple[str, str]:
        # Cycles: 1-2, 3-4, 5-6, 7-8, 9-10, 11-12
        sm = ((d.month - 1) // 2) * 2 + 1
        return (f"{d.year}-{sm:02d}", f"{d.year}-{sm + 1:02d}")

    def calc_bill(kwh: float) -> float:
        syp_val = _calculate_bill(kwh)
        return round(_convert_currency(syp_val, currency), 2)

    # --- Mode Handler ---

    if period == "day":
        ds = ref_date.isoformat()
        kwh = stats.get(ds, 0.0)
        return {
            "period": "day",
            "date": ds,
            "currency": currency,
            "kwh": round(kwh, 4),
            "bill": calc_bill(kwh),
        }

    elif period == "month":
        # Get all days in this month
        prefix = ref_date.strftime("%Y-%m")
        days = []
        total_kwh = 0.0

        # Sort keys to ensure day order
        for k in sorted(stats.keys()):
            if k.startswith(prefix):
                v = stats[k]
                days.append({"date": k, "kwh": v})
                total_kwh += v

        return {
            "period": "month",
            "ref_month": prefix,
            "currency": currency,
            "total_kwh": round(total_kwh, 4),
            "bill": calc_bill(total_kwh),
            "days": days,
        }

    elif period == "cycle":
        m1, m2 = get_cycle_months(ref_date)
        # Name
        start_dt = date.fromisoformat(f"{m1}-01")
        name = f"{start_dt.strftime('%b')}-{date(start_dt.year, start_dt.month + 1, 1).strftime('%b')}"

        days = []
        cycle_kwh = 0.0

        # We want all days in sorted order
        for k in sorted(stats.keys()):
            if k.startswith(m1) or k.startswith(m2):
                v = stats[k]
                days.append({"date": k, "kwh": v})
                cycle_kwh += v

        bill_syp = _calculate_bill(cycle_kwh)
        bill_conv = round(_convert_currency(bill_syp, currency), 2)

        # Tiers in base SYP
        tiers_syp = [
            {"limit": 300, "price": 600, "filled": min(cycle_kwh, 300)},
            {"limit": "∞", "price": 1400, "filled": max(0, cycle_kwh - 300)},
        ]

        return {
            "period": "cycle",
            "ref_date": ref_date.isoformat(),
            "cycle_name": name,
            "currency": currency,
            "total_kwh": round(cycle_kwh, 4),
            "bill": bill_conv,
            "tiers": _convert_tiers(tiers_syp, currency),
            "days": days,
        }

    elif period == "year":
        # Aggregate by month
        prefix = ref_date.strftime("%Y")
        monthly_map = {}  # "MM" -> kwh
        total_kwh = 0.0

        for k, v in stats.items():
            if k.startswith(prefix):
                m_key = k[5:7]  # YYYY-MM-DD
                monthly_map[m_key] = monthly_map.get(m_key, 0.0) + v
                total_kwh += v

        months = []
        for m in sorted(monthly_map.keys()):
            months.append({"month": f"{prefix}-{m}", "kwh": round(monthly_map[m], 4)})

        return {
            "period": "year",
            "ref_year": prefix,
            "currency": currency,
            "total_kwh": round(total_kwh, 4),
            "bill": calc_bill(total_kwh),
            "months": months,
        }

    else:
        # Default: Overview (original behavior)
        today = _now_tz().date()
        today_str = today.isoformat()
        today_kwh = stats.get(today_str, 0.0)

        # This Month
        month_prefix = today.strftime("%Y-%m")
        month_kwh = sum(v for k, v in stats.items() if k.startswith(month_prefix))

        # This Year
        year_prefix = today.strftime("%Y")
        year_kwh = sum(v for k, v in stats.items() if k.startswith(year_prefix))

        # Total Acc
        acc_kwh = sum(stats.values())

        # Cycle
        m1, m2 = get_cycle_months(today)
        cycle_kwh = sum(
            v for k, v in stats.items() if k.startswith(m1) or k.startswith(m2)
        )

        # Marginal Cost
        # Calculate full cycle cost
        cycle_bill_syp = _calculate_bill(cycle_kwh)
        # Calculate cost without today
        cycle_minus_today_bill_syp = _calculate_bill(max(0, cycle_kwh - today_kwh))

        today_cost_syp = cycle_bill_syp - cycle_minus_today_bill_syp

        # Convert all to target currency
        today_cost = round(_convert_currency(today_cost_syp, currency), 2)
        cycle_bill = round(_convert_currency(cycle_bill_syp, currency), 2)

        start_dt = date.fromisoformat(f"{m1}-01")
        c_name = f"{start_dt.strftime('%b')}-{date(today.year, start_dt.month + 1, 1).strftime('%b')}"

        tiers_syp = [
            {"limit": 300, "price": 600, "filled": min(cycle_kwh, 300)},
            {"limit": "∞", "price": 1400, "filled": max(0, cycle_kwh - 300)},
        ]

        return {
            "period": "overview",
            "timestamp": _now_str(),
            "currency": currency,
            "exchange_rate": EXCHANGE_RATES.get(currency, 1.0),
            "today": {
                "kwh": round(today_kwh, 2),
                "cost_marginal": today_cost,
                "bill_standalone": calc_bill(today_kwh),
            },
            "month": {
                "kwh": round(month_kwh, 2),
                "bill_standalone": calc_bill(month_kwh),
            },
            "cycle": {
                "name": c_name,
                "kwh": round(cycle_kwh, 2),
                "bill": cycle_bill,
                "tiers": _convert_tiers(tiers_syp, currency),
            },
            "year": {"kwh": round(year_kwh, 2), "bill_standalone": calc_bill(year_kwh)},
            "total": {"kwh": round(acc_kwh, 2), "bill_standalone": calc_bill(acc_kwh)},
        }


@app.get("/stats/cycles")
async def get_stats_cycles(limit: int = 5, currency: str = "SYP"):
    """
    Returns the last N billing cycles (2-month periods) with usage and costs.
    Currency: SYP (default), USD, SAR.
    """
    currency = currency.upper()
    if currency not in CURRENCIES:
        raise HTTPException(
            status_code=400, detail=f"Currency must be one of {CURRENCIES}"
        )

    stats = await asyncio.to_thread(_update_grid_stats)

    # Helper to get start month of a cycle
    def get_cycle_start(ds: str) -> str:
        # ds: YYYY-MM-DD
        dt = date.fromisoformat(ds)
        sm = ((dt.month - 1) // 2) * 2 + 1
        return f"{dt.year}-{sm:02d}"

    # Group kWh by cycle start month
    cycle_map = {}  # "YYYY-MM" -> kwh
    for ds, kwh in stats.items():
        cs = get_cycle_start(ds)
        cycle_map[cs] = cycle_map.get(cs, 0.0) + kwh

    # Sort by date descending
    sorted_cycles = sorted(cycle_map.keys(), reverse=True)

    output = []
    for cs in sorted_cycles[:limit]:
        usage = cycle_map[cs]
        cost_syp = _calculate_bill(usage)

        # Format name: e.g. "Jan-Feb 2024"
        start_date = date.fromisoformat(f"{cs}-01")
        m1_name = start_date.strftime("%b")
        # next month name
        m2_date = date(start_date.year, start_date.month + 1, 1)
        m2_name = m2_date.strftime("%b")

        tiers_syp = [
            {"limit": 300, "price": 600, "filled": min(usage, 300)},
            {"limit": "∞", "price": 1400, "filled": max(0, usage - 300)},
        ]

        output.append(
            {
                "cycle_start": cs,
                "name": f"{m1_name}-{m2_name} {start_date.year}",
                "currency": currency,
                "kwh": round(usage, 4),
                "bill": round(_convert_currency(cost_syp, currency), 2),
                "tiers": _convert_tiers(tiers_syp, currency),
            }
        )

    return {"count": len(output), "requested_limit": limit, "cycles": output}


@app.get("/battery/details")
def get_battery_details(
    deviceSn: Optional[str] = None,
    label: Optional[str] = None,
    minutes: Optional[int] = None,
    hours: Optional[int] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: int = 1000,
):
    try:
        start_dt, end_dt = _resolve_time_window(minutes, hours, start, end)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Bad time window: {e}")

    picks = _select_batteries(deviceSn, label)
    raw_rows = _get_battery_rows(start_dt, end_dt, picks)

    detail_rows = [_map_battery_details(r) for r in raw_rows]
    total = len(detail_rows)
    if limit > 0:
        detail_rows = detail_rows[-limit:]

    return {
        "selection": [{"deviceSn": sn, "label": lbl} for sn, lbl in picks],
        "start": start_dt.isoformat(),
        "end": end_dt.isoformat(),
        "count": len(detail_rows),
        "total": total,
        "rows": detail_rows,
    }
