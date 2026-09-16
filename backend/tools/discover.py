"""List every plant and device on the Felicity account.

Usage:  python tools/discover.py [--save]
--save writes a PII-free summary to tools/discovery_output.json.
"""
import asyncio
import json
import sys
from datetime import datetime
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _auth import API, login  # noqa: E402

OUT = Path(__file__).resolve().parent / "discovery_output.json"
PLANT_KEYS = ("id", "plantName", "plantType", "onGridType", "status", "timeZone")
DEVICE_KEYS = ("deviceSn", "deviceType", "alias", "deviceModel", "plantId", "plantName", "status", "timeZone", "reportFreq")


async def _paged(client, headers, path):
    items, page = [], 1
    while True:
        r = await client.post(f"{API}{path}", json={"pageNum": page, "pageSize": 50}, headers=headers)
        r.raise_for_status()
        data = r.json().get("data") or {}
        items += data.get("dataList") or []
        if page >= int(data.get("totalPage") or 1):
            return items
        page += 1


async def discover() -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        headers = await login(client)
        plants = await _paged(client, headers, "/plant/list_plant")
        devices = await _paged(client, headers, "/device/list_device_all_type")
        # The list omits clock settings; the per-device snapshot carries timeZone and reportFreq.
        for d in devices:
            r = await client.post(
                f"{API}/device/get_device_snapshot",
                json={"deviceSn": d["deviceSn"], "deviceType": d["deviceType"], "dateStr": datetime.now().strftime("%Y-%m-%d %H:%M:%S")},
                headers=headers,
            )
            snap = r.json().get("data") or {}
            d["timeZone"] = snap.get("timeZone")
            d["reportFreq"] = snap.get("reportFreq")
    return {
        "plants": [{k: p.get(k) for k in PLANT_KEYS} for p in plants],
        "devices": [{k: d.get(k) for k in DEVICE_KEYS} for d in devices],
    }


def main():
    result = asyncio.run(discover())
    for p in result["plants"]:
        print(f"PLANT  {p['id']}  {p['plantName']}")
    for d in result["devices"]:
        print(f"DEVICE {d['deviceSn']}  {d['deviceType']:<3} {d['deviceModel'] or '':<10} alias={d['alias']!r:<22} tz={d['timeZone']} every={d['reportFreq']}s plant={d['plantName']} ({d['plantId']})")
    if "--save" in sys.argv:
        OUT.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
        print(f"saved {OUT}")


if __name__ == "__main__":
    main()
