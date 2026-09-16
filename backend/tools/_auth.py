"""Shared login helper for the reverse-engineering tools. Credentials come from backend/.env only."""
import base64
import os
from pathlib import Path

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import padding
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

API = "https://shine-api.felicitysolar.com"
PUB_KEY = (
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnAJE68pjWZmtSg6ZJs9FZugJXC6bBSluTW6mJttOLOaljrdErVnM5DNN+YFzpB9pAysTErjY1bnSVuEwQSwptnqUji7Ch2qMj2n+0eCp8p6vtSh7/tFr2ul8nDRtkoswLANAIwtUk/G85ipMpmY1W642LImnEJmGkkddlbjbjxJTZWR5hc/d9cPWb+AR77LxFFrMik3c+44v1kQlIPFP6EjIbOvt/Lv7fHWD9JI/YzN4y1gK7C/VQdNGuikQyNg+5W3rg9ecYf9I5uLAQwY/hxeI3lbNsErebqKe2EbJ8AwcNIC0lDBz53Sq0ML89QapEuy3fB+upuctxLULVDCbNwIDAQAB"
)
HEADERS = {
    "Content-Type": "application/json",
    "Origin": "https://shine.felicityess.com",
    "Referer": "https://shine.felicityess.com/",
    "lang": "en_US",
    "source": "WEB",
}


def encrypt_password(pwd: str) -> str:
    pem = f"-----BEGIN PUBLIC KEY-----\n{PUB_KEY}\n-----END PUBLIC KEY-----\n"
    key = serialization.load_pem_public_key(pem.encode())
    return base64.b64encode(key.encrypt(pwd.encode(), padding.PKCS1v15())).decode()


async def login(client: httpx.AsyncClient) -> dict:
    """Log in and return headers carrying the Bearer_ token."""
    user = os.environ["FELICITY_USER"]
    pwd = os.environ["FELICITY_PASS"]
    r = await client.post(
        f"{API}/userlogin",
        json={"userName": user, "password": encrypt_password(pwd), "version": "1.0"},
        headers=HEADERS,
    )
    r.raise_for_status()
    body = r.json()
    data = body.get("data")
    tok = data.get("token") if isinstance(data, dict) else data
    if not tok:
        raise RuntimeError(f"login failed: code={body.get('code')} {body.get('message')}")
    return {**HEADERS, "Authorization": tok if tok.startswith("Bearer_") else f"Bearer_{tok}"}
