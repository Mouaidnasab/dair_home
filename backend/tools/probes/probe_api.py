import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")
import asyncio
import httpx
import sys

from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import serialization
import base64

PUB_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnAJE68pjWZmtSg6ZJs9FZugJXC6bBSluTW6mJttOLOaljrdErVnM5DNN+YFzpB9pAysTErjY1bnSVuEwQSwptnqUji7Ch2qMj2n+0eCp8p6vtSh7/tFr2ul8nDRtkoswLANAIwtUk/G85ipMpmY1W642LImnEJmGkkddlbjbjxJTZWR5hc/d9cPWb+AR77LxFFrMik3c+44v1kQlIPFP6EjIbOvt/Lv7fHWD9JI/YzN4y1gK7C/VQdNGuikQyNg+5W3rg9ecYf9I5uLAQwY/hxeI3lbNsErebqKe2EbJ8AwcNIC0lDBz53Sq0ML89QapEuy3fB+upuctxLULVDCbNwIDAQAB"

def _e(pwd):
    pem = f"-----BEGIN PUBLIC KEY-----\n{PUB_KEY}\n-----END PUBLIC KEY-----\n"
    pub_key = serialization.load_pem_public_key(pem.encode("utf-8"))
    enc = pub_key.encrypt(pwd.encode("utf-8"), padding.PKCS1v15())
    return base64.b64encode(enc).decode("utf-8")

async def test():
    async with httpx.AsyncClient() as client:
        # login
        h = {"Content-Type": "application/json", "Origin": "https://shine.felicityess.com", "Referer": "https://shine.felicityess.com/"}
        p = {"userName": os.environ["FELICITY_USER"], "password": _e(os.environ["FELICITY_PASS"]), "version": "1.0"}
        r = await client.post("https://shine-api.felicitysolar.com/userlogin", json=p, headers=h)
        tok = r.json().get('data', {}).get('token') or r.json().get('token')
        if not tok: print("NO TOKEN"); return
        
        h["Authorization"] = f"Bearer_{tok}"

        # brute force historical endpoint
        urls = [
            "/plant/history",
            "/plant/get_history",
            "/plant/energyDay",
            "/device/get_history_data",
            "/device/history",
            "/stats/history",
            "/plant/energyFlowDay",
            "/plant/plantEnergy"
        ]
        
        for u in urls:
            p = {"plantId": "11160008309715425", "dateStr": "2026-04-19", "deviceSn": "072604830025322349"}
            res = await client.post(f"https://shine-api.felicitysolar.com{u}", json=p, headers=h)
            try:
                print(u, res.status_code, res.json().get('code', res.text[:20]))
            except:
                print(u, res.status_code)
                
asyncio.run(test())
