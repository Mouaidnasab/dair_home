import urllib.request
import json
import ssl

ctx = ssl.create_default_context()

url = 'https://api.github.com/search/code?q="shine-api.felicitysolar.com"'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req, context=ctx) as response:
        data = json.loads(response.read().decode())
        for item in data.get('items', []):
            print(item['html_url'])
except Exception as e:
    print(e)
