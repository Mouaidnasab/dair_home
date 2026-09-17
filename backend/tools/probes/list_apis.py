import urllib.request
import re
import ssl
import json

ctx = ssl.create_default_context()

url = "https://api.github.com/repos/caiocevan-beep/FelicitySolarCom/git/trees/main?recursive=1"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req, context=ctx) as response:
        data = json.loads(response.read().decode('utf-8'))
        for t in data.get('tree', []):
            if t['path'].endswith('.js') or t['path'].endswith('.py') or t['path'].endswith('.ts') or t['path'].endswith('.json'):
                print("Checking:", t['path'])
                dl = f"https://raw.githubusercontent.com/caiocevan-beep/FelicitySolarCom/main/{t['path']}"
                try:
                    r = urllib.request.urlopen(urllib.request.Request(dl, headers={'User-Agent': 'Mozilla/5.0'}), context=ctx)
                    content = r.read().decode('utf-8')
                    match = re.findall(r'http[s]?://[^"\'\s]+', content)
                    for m in match:
                        if 'shine-api' in m or 'felicity' in m.lower():
                            print("  FOUND API:", m)
                except Exception as ee:
                    pass
except Exception as e:
    pass
