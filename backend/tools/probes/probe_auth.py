import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")
import httpx
import base64
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import serialization

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

FELICITY_PUB_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnAJE68pjWZmtSg6ZJs9FZugJXC6bBSluTW6mJttOLOaljrdErVnM5DNN+YFzpB9pAysTErjY1bnSVuEwQSwptnqUji7Ch2qMj2n+0eCp8p6vtSh7/tFr2ul8nDRtkoswLANAIwtUk/G85ipMpmY1W642LImnEJmGkkddlbjbjxJTZWR5hc/d9cPWb+AR77LxFFrMik3c+44v1kQlIPFP6EjIbOvt/Lv7fHWD9JI/YzN4y1gK7C/VQdNGuikQyNg+5W3rg9ecYf9I5uLAQwY/hxeI3lbNsErebqKe2EbJ8AwcNIC0lDBz53Sq0ML89QapEuy3fB+upuctxLULVDCbNwIDAQAB"

def _encrypt_password(password: str) -> str:
    pem = f"-----BEGIN PUBLIC KEY-----\n{FELICITY_PUB_KEY}\n-----END PUBLIC KEY-----\n"
    pub_key = serialization.load_pem_public_key(pem.encode("utf-8"))
    encrypted = pub_key.encrypt(password.encode("utf-8"), padding.PKCS1v15())
    return base64.b64encode(encrypted).decode("utf-8")

payload = {
    "userName": os.environ["FELICITY_USER"],
    "password": _encrypt_password(os.environ["FELICITY_PASS"]),
    "version": "1.0"
}

r = httpx.post("https://shine-api.felicitysolar.com/userlogin", json=payload, headers=BASE_HEADERS)
print("Status:", r.status_code)
print("Body:", r.text)
