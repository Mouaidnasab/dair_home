"""Felicity Shine cloud client (reverse engineered). TLS verification stays on."""
from __future__ import annotations

import asyncio
import base64
import logging
import os
from datetime import date, datetime
from pathlib import Path
from typing import Any

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import padding

log = logging.getLogger(__name__)

API = "https://shine-api.felicitysolar.com"
PUB_KEY = (
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnAJE68pjWZmtSg6ZJs9FZugJXC6bBSluTW6mJttOLOaljrdErVnM5DNN+YFzpB9pAysTErjY1bnSVuEwQSwptnqUji7Ch2qMj2n+0eCp8p6vtSh7/tFr2ul8nDRtkoswLANAIwtUk/G85ipMpmY1W642LImnEJmGkkddlbjbjxJTZWR5hc/d9cPWb+AR77LxFFrMik3c+44v1kQlIPFP6EjIbOvt/Lv7fHWD9JI/YzN4y1gK7C/VQdNGuikQyNg+5W3rg9ecYf9I5uLAQwY/hxeI3lbNsErebqKe2EbJ8AwcNIC0lDBz53Sq0ML89QapEuy3fB+upuctxLULVDCbNwIDAQAB"
)
HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "Origin": "https://shine.felicityess.com",
    "Referer": "https://shine.felicityess.com/",
    "lang": "en_US",
    "source": "WEB",
}
AUTH_FAILED_CODES = {998}


class FelicityError(RuntimeError):
    pass


def encrypt_password(password: str) -> str:
    pem = f"-----BEGIN PUBLIC KEY-----\n{PUB_KEY}\n-----END PUBLIC KEY-----\n"
    key = serialization.load_pem_public_key(pem.encode())
    return base64.b64encode(key.encrypt(password.encode(), padding.PKCS1v15())).decode()


class FelicityClient:
    def __init__(self, user: str, password: str, token_path: Path, http: httpx.AsyncClient | None = None):
        self.user = user
        self.password = password
        self.token_path = Path(token_path)
        self.http = http or httpx.AsyncClient(timeout=20, headers=HEADERS)
        self._token: str | None = None
        self._login_lock = asyncio.Lock()

    async def aclose(self) -> None:
        await self.http.aclose()

    # ---------- auth ----------
    def _load_token(self) -> str | None:
        if self._token is None and self.token_path.exists():
            self._token = self.token_path.read_text().strip() or None
        return self._token

    async def _login(self, stale: str | None) -> str:
        async with self._login_lock:
            # Another request may already have refreshed the token while we waited.
            if self._token and self._token != stale:
                return self._token
            r = await self.http.post(
                f"{API}/userlogin",
                json={"userName": self.user, "password": encrypt_password(self.password), "version": "1.0"},
            )
            r.raise_for_status()
            body = r.json()
            data = body.get("data")
            token = data.get("token") if isinstance(data, dict) else data
            if not isinstance(token, str) or not token:
                raise FelicityError(f"login failed: code={body.get('code')} {body.get('message')}")
            self._token = token.strip()
            self.token_path.parent.mkdir(parents=True, exist_ok=True)
            self.token_path.write_text(self._token)
            os.chmod(self.token_path, 0o600)
            log.info("felicity: logged in")
            return self._token

    async def _request(self, method: str, path: str, **kw: Any) -> dict:
        token = self._load_token() or await self._login(None)
        for attempt in (1, 2):
            auth = token if token.startswith("Bearer_") else f"Bearer_{token}"
            r = await self.http.request(method, f"{API}{path}", headers={"Authorization": auth}, **kw)
            body: dict = {}
            try:
                body = r.json()
            except ValueError:
                pass
            expired = r.status_code in (401, 403) or body.get("code") in AUTH_FAILED_CODES or "token has expired" in str(body.get("message", "")).lower()
            if expired and attempt == 1:
                token = await self._login(token)
                continue
            r.raise_for_status()
            if body.get("code") != 200:
                raise FelicityError(f"{path}: code={body.get('code')} {body.get('message')}")
            return body
        raise FelicityError(f"{path}: authentication failed")

    # ---------- endpoints ----------
    async def snapshot(self, sn: str, device_type: str) -> dict:
        body = await self._request(
            "POST", "/device/get_device_snapshot",
            json={"deviceSn": sn, "deviceType": device_type, "dateStr": datetime.now().strftime("%Y-%m-%d %H:%M:%S")},
        )
        return body.get("data") or {}

    async def history(self, sn: str, device_type: str, day: date) -> list[dict]:
        """5-minute samples for one day (the cloud keeps months of these)."""
        rows: list[dict] = []
        page = 1
        while True:
            body = await self._request(
                "POST", "/storageRealtimeData/list_storageRealtimeData_new",
                json={"dateStr": f"{day.isoformat()} 12:00:00", "deviceSn": sn, "deviceType": device_type, "pageNum": page, "pageSize": 1000},
            )
            data = body.get("data") or {}
            rows += data.get("dataList") or []
            if page >= int(data.get("totalPage") or 1):
                return rows
            page += 1

    async def plants(self) -> list[dict]:
        return await self._paged("/plant/list_plant")

    async def devices(self) -> list[dict]:
        return await self._paged("/device/list_device_all_type")

    async def _paged(self, path: str) -> list[dict]:
        items: list[dict] = []
        page = 1
        while True:
            data = (await self._request("POST", path, json={"pageNum": page, "pageSize": 50})).get("data") or {}
            items += data.get("dataList") or []
            if page >= int(data.get("totalPage") or 1):
                return items
            page += 1
