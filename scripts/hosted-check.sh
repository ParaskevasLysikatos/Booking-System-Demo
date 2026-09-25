#!/usr/bin/env bash
# Hosted demo smoke check (TICKET-028): wakes the free Render API up and
# checks that the site, the API and the database all work together.
# Runs in GitHub Actions ("Hosted demo check" -> Run workflow) or anywhere
# with bash, curl and python3:   bash scripts/hosted-check.sh
set -euo pipefail

API="${API_URL:-https://booking-demo-api.onrender.com}"
SITE="${SITE_URL:-https://booking-demo-g4aw.onrender.com}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

ok()   { echo "OK    $1"; echo "- ✅ $1" >> "$SUMMARY"; }
fail() { echo "FAIL  $1" >&2; echo "- ❌ $1" >> "$SUMMARY"; echo "::error::$1"; exit 1; }
json() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

echo "## Hosted demo check" >> "$SUMMARY"
echo "Site: $SITE  |  API: $API"

# 1. Wake the API up and wait for the database round-trip. A sleeping free
#    instance takes ~50 s to answer, so retry for up to ~3 minutes.
start=$(date +%s)
for attempt in $(seq 1 12); do
  body=$(curl -sS --max-time 60 -H 'Accept: application/json' "$API/api/health/" 2>/dev/null || true)
  db=$(printf '%s' "$body" | json "d.get('database')" 2>/dev/null || true)
  [ "$db" = "connected" ] && break
  [ "$attempt" -eq 12 ] && fail "API health never reported the database as connected (last answer: ${body:-none})"
  echo "      API not ready yet (attempt $attempt), retrying in 10 s..."
  sleep 10
done
ok "API awake, database connected (took $(( $(date +%s) - start )) s)"

# 2. Real data comes back.
count=$(curl -sS --max-time 30 -H 'Accept: application/json' "$API/api/properties/?page_size=1" | json "d['count']") \
  || fail "API property list didn't answer with JSON"
[ "$count" -gt 0 ] || fail "API lists no properties"
ok "API lists $count properties"

# 3. The site is up, and deep links are rewritten to index.html.
for path in / /listings/1 /admin/bookings; do
  page=$(curl -sS --max-time 30 -w '\n%{http_code}' "$SITE$path")
  code=${page##*$'\n'}
  [ "$code" = "200" ] && [[ "$page" == *"<app-root"* ]] || fail "Site $path answered $code without the Angular app"
done
ok "Site serves the Angular app, deep links included"

# 4. The API lets the site call it (CORS preflight, as a logged-in request sends it).
allow=$(curl -sS --max-time 30 -o /dev/null -D - -X OPTIONS "$API/api/properties/" \
  -H "Origin: $SITE" -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization' \
  | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}')
[ "$allow" = "$SITE" ] || fail "CORS: the API doesn't allow $SITE (got '${allow:-nothing}') - check CORS_ALLOWED_ORIGINS in render.yaml"
ok "CORS allows the site"

# 5. The site's security headers are in place.
xfo=$(curl -sS --max-time 30 -o /dev/null -D - "$SITE/" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-frame-options"{print $2}')
[ "$xfo" = "DENY" ] || fail "Site is missing X-Frame-Options: DENY (got '${xfo:-nothing}')"
ok "Security headers present"

echo "All good - the hosted demo is awake for the next ~15 minutes."
echo "**All good** - the API stays awake for ~15 minutes after this." >> "$SUMMARY"
