#!/usr/bin/env bash
# Keep the free Render API awake (TICKET-028): it sleeps after 15 minutes
# without traffic, so ping its health check every 10 minutes for a while.
# Run hosted-check.sh first (the workflow does) so it starts awake and verified.
#   KEEP_AWAKE_MINUTES (default 180)   PING_EVERY_SECONDS (default 600)
set -euo pipefail

API="${API_URL:-https://booking-demo-api.onrender.com}"
MINUTES="${KEEP_AWAKE_MINUTES:-180}"
EVERY="${PING_EVERY_SECONDS:-600}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
athens() { TZ=Europe/Athens date '+%H:%M'; }

end=$(( $(date +%s) + MINUTES * 60 ))
echo "Keeping $API awake until $(TZ=Europe/Athens date -d "@$end" '+%H:%M') Athens time (ping every $(( EVERY >= 60 ? EVERY / 60 : EVERY ))$([ "$EVERY" -ge 60 ] && echo " min" || echo " s"))."
echo "## Keep demo awake" >> "$SUMMARY"
echo "Awake from $(athens) until $(TZ=Europe/Athens date -d "@$end" '+%H:%M') (Athens time). Cancel this run to stop early." >> "$SUMMARY"

pings=0; failed=0; in_a_row=0
while :; do
  left=$(( end - $(date +%s) ))
  [ "$left" -le 0 ] && break
  sleep $(( left < EVERY ? left : EVERY ))
  # curl prints 000 itself when there's no answer at all
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 90 "$API/api/health/" 2>/dev/null) || true
  pings=$((pings + 1))
  if [ "$code" = "200" ]; then
    in_a_row=0
    echo "$(athens)  ping $pings: OK"
  else
    failed=$((failed + 1)); in_a_row=$((in_a_row + 1))
    echo "::warning::$(athens) ping $pings: API answered ${code:-nothing}"
    if [ "$in_a_row" -ge 3 ]; then
      echo "- ❌ $(athens): the API failed 3 pings in a row" >> "$SUMMARY"
      echo "::error::The API failed 3 pings in a row - check Render's dashboard/logs"
      exit 1
    fi
  fi
done

echo "Done: $pings pings, $failed failed."
echo "- ✅ Kept awake until $(athens): $pings pings, $failed failed" >> "$SUMMARY"
