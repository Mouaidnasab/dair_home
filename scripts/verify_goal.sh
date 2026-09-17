#!/usr/bin/env bash
# Acceptance checks for docs/GOAL.md. Exit 0 only when every check passes.
# Checks may be added; never removed or weakened.
set -u
cd "$(dirname "$0")/.."
ROOT=$(pwd)
PY=${PY:-backend/.venv/bin/python}
pass=0; fail=0
check() { # check "name" command...
  local name=$1; shift
  if ( "$@" ) >/tmp/verify_goal_last.log 2>&1; then
    echo "  ok   $name"; pass=$((pass+1))
  else
    echo "  FAIL $name"; sed 's/^/         /' /tmp/verify_goal_last.log | tail -5; fail=$((fail+1))
  fi
}
absent() { # absent PATTERN PATH... : no match in the paths that exist
  local pat=$1; shift; local paths=(); for p in "$@"; do [ -e "$p" ] && paths+=("$p"); done
  [ ${#paths[@]} -eq 0 ] && return 0
  ! grep -rlIE "$pat" "${paths[@]}" --include='*.py' --include='*.ts' --include='*.tsx' --include='*.toml' \
      --exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=dist --exclude-dir=.git
}

echo "== Phase 0: hygiene + topology"
check "no scratch scripts at repo root" bash -c '! ls test_*.py list_apis.py search_*.py 2>/dev/null | grep -q .'
check "no hardcoded Felicity login in code" absent '"userName":[[:space:]]*"[^"]+@' .
check "TLS verification on" absent 'verify=False' backend
check "discover tool exists" test -f backend/tools/discover.py
check "discovery output committed" test -s backend/tools/discovery_output.json
check "topology covers every discovered SN" bash -c "$PY - <<'PY'
import json, re, sys
d = json.dumps(json.load(open('backend/tools/discovery_output.json')))
sns = set(re.findall(r'\\b\\d{17,18}\\b', d))
t = open('backend/topology.toml').read()
missing = sorted(sn for sn in sns if sn not in t)
print('discovered', len(sns), 'missing', missing); sys.exit(1 if (missing or not sns) else 0)
PY"
check "topology has garden zone" grep -qiE 'zone *= *"garden"' backend/topology.toml
check "all 5 portal devices in topology" bash -c 'for sn in 020308004825320226 020308004825320563 072604830025322349 020308004825441198 072604820026022401; do grep -q "$sn" backend/topology.toml || { echo "missing $sn"; exit 1; }; done'
check "shared battery has two zones" bash -c 'grep -A6 072604830025322349 backend/topology.toml | grep -qE "first" && grep -A6 072604830025322349 backend/topology.toml | grep -qE "ground"'

echo "== Phase 1-4: backend"
for m in config felicity collector store rollups retention api cli; do
  check "module app/$m.py" test -f "backend/app/$m.py"
done
check "main.py is thin (<40 lines)" bash -c '[ "$(wc -l < backend/main.py)" -lt 40 ]'
check "collector writes no CSV" bash -c 'test -f backend/app/collector.py && ! grep -qE "csv\\.|\\.csv" backend/app/collector.py'
check "numbered SQL migrations" bash -c 'ls backend/app/migrations/[0-9][0-9][0-9]_*.sql >/dev/null'
for t in test_write_budget test_dedupe test_migrate_csv test_retention test_api_series test_grid_import test_normalize; do
  check "test file $t.py" test -f "backend/tests/$t.py"
done
check "pytest green" bash -c "cd backend && $ROOT/$PY -m pytest -q"
if [ -d backend/data ] && ls backend/data/*.csv >/dev/null 2>&1; then
  TMPDB=$(mktemp -d)
  check "migrate real CSVs with parity" bash -c "cd backend && $ROOT/$PY -m app.cli migrate-csv --src data --db $TMPDB/m.sqlite3 --verify"
  check "migration idempotent" bash -c "cd backend && $ROOT/$PY -m app.cli migrate-csv --src data --db $TMPDB/m.sqlite3 --verify"
  check "retention dry-run" bash -c "cd backend && $ROOT/$PY -m app.cli retention --db $TMPDB/m.sqlite3 --dry-run"
fi

echo "== Phase 5: frontend"
check "Node server removed" test ! -d server
check "no debugger statements" absent 'debugger;' client/src
check "unused deps dropped" bash -c '! grep -qE "\"(@aws-sdk/client-s3|framer-motion|mysql2|axios|drizzle-orm|@trpc/server|@tanstack/react-query|express)\"" package.json'
check "ui components <= 12" bash -c '[ "$(ls client/src/components/ui | wc -l)" -le 12 ]'
check "ComponentShowcase removed" test ! -f client/src/pages/ComponentShowcase.tsx
check "client uses /api/v1 only" bash -c 'grep -q "/api/v1/" client/src/lib/api.ts && ! grep -qE "export-compact|/api/energy/|/stats/" client/src/lib/api.ts'
check "garden strings en+ar" bash -c 'grep -qi garden client/src/locales/en/translation.json && grep -qi garden client/src/locales/ar/translation.json'
check "tsc" bash -c "test -x node_modules/.bin/tsc || { echo run pnpm install; exit 1; }; node_modules/.bin/tsc --noEmit"
check "client build + main chunk <=350KB" bash -c 'test -x node_modules/.bin/vite || { echo run pnpm install; exit 1; }; node_modules/.bin/vite build >/tmp/vb.log 2>&1 || exit 1; f=$(ls -S dist/public/assets/*.js | head -1); s=$(wc -c < "$f"); echo "$f $s"; [ "$s" -le 358400 ]'
check "no import cycles between built chunks; entry chunk does not load charts" python3 - <<'PY'
import glob, os, re, sys
files = {os.path.basename(f): open(f).read() for f in glob.glob("dist/public/assets/*.js")}
deps = {f: set(re.findall(r'from\s*"\./([^"]+\.js)"', src)) for f, src in files.items()}
def reach(start):
    seen, stack = set(), [start]
    while stack:
        for d in deps.get(stack.pop(), ()):
            if d not in seen:
                seen.add(d); stack.append(d)
    return seen
cycles = [f for f in deps if f in reach(f)]
entry = [f for f in files if f.startswith("index-")]
eager_charts = [f for f in entry if any(d.startswith("charts") for d in reach(f))]
print("cycles:", cycles, "entry loads charts:", eager_charts)
sys.exit(1 if cycles or eager_charts or not entry else 0)
PY

echo "== Phase 6: deploy"
check "compose has mem_limit + log rotation" bash -c 'grep -q mem_limit deploy/docker-compose.yml && grep -q max-size deploy/docker-compose.yml && grep -q tmpfs deploy/docker-compose.yml'
check "runtime image has no node" bash -c 'tail -n +"$(grep -n "^FROM" Dockerfile | tail -1 | cut -d: -f1)" Dockerfile | grep -q "python:3.12-slim" && ! tail -n +"$(grep -n "^FROM" Dockerfile | tail -1 | cut -d: -f1)" Dockerfile | grep -q node_modules'
check "DEPLOY.md" test -f docs/DEPLOY.md

echo "== Goal checklist"
check "all GOAL.md boxes checked" bash -c '! grep -n "^- \[ \]" docs/GOAL.md'

echo "SUMMARY: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
