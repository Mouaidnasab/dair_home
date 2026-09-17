import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")
import asyncio
import httpx
import sys
import json
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
        h = {"Content-Type": "application/json", "Origin": "https://shine.felicityess.com", "Referer": "https://shine.felicityess.com/"}
        p = {"userName": os.environ["FELICITY_USER"], "password": _e(os.environ["FELICITY_PASS"]), "version": "1.0"}
        r = await client.post("https://shine-api.felicitysolar.com/userlogin", json=p, headers=h)
        tok = r.json().get('data', {}).get('token') or r.json().get('token')
        h["Authorization"] = f"Bearer_{tok}"

        p_list = {"dateStr":"2026-04-20 18:59:33","deviceSn":"020308004825320563","deviceType":"OG","pageNum":1,"pageSize":2000}
        res2 = await client.post("https://shine-api.felicitysolar.com/storageRealtimeData/list_storageRealtimeData_new", json=p_list, headers=h)
        data = res2.json()
        dataList = data.get('data', {}).get('dataList', [])
        print(f"Code: {data.get('code')}")
        print(f"Length of dataList: {len(dataList)}")
        if len(dataList) > 0:
            print("First item timestamp:", dataList[0].get('createTimeStr'))
            print("Last item timestamp:", dataList[-1].get('createTimeStr'))

asyncio.run(test())
