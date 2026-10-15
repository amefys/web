#!/usr/bin/env bash
# Upload worker/site-stats.js (the homepage numbers, hourly cron) via the API.
#   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… SUPABASE_URL=… SUPABASE_SERVICE_KEY=… \
#     worker/deploy-site-stats.sh
# Binding: R2 bucket `amefys-cdn` as CDN (writes stats.json + stats/state.json).
# Secrets pushed on every deploy: SUPABASE_URL, SUPABASE_SERVICE_KEY, CF_API_TOKEN
# (the deploying token doubles as the Analytics Engine reader; it needs
# Account → Account Analytics: Read). Schedule: minute 7 of every hour.
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?}" "${CLOUDFLARE_ACCOUNT_ID:?}" "${SUPABASE_URL:?}" "${SUPABASE_SERVICE_KEY:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"
API="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/site-stats"
AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
ok() { python3 -c 'import sys,json; d=json.load(sys.stdin); print(sys.argv[1], "ok" if d.get("success") else json.dumps(d.get("errors"), ensure_ascii=False))' "$1"; }

META=$(printf '{"main_module":"site-stats.js","compatibility_date":"2026-10-01","bindings":[{"type":"r2_bucket","name":"CDN","bucket_name":"amefys-cdn"},{"type":"plain_text","name":"CF_ACCOUNT_ID","text":"%s"}]}' "$CLOUDFLARE_ACCOUNT_ID")
curl -sS -X PUT "$API" "${AUTH[@]}" \
  -F "metadata=$META;type=application/json" \
  -F "site-stats.js=@$HERE/site-stats.js;type=application/javascript+module" | ok upload

secret() {
  python3 -c 'import json,sys; print(json.dumps({"name": sys.argv[1], "text": sys.argv[2], "type": "secret_text"}))' "$1" "$2" \
    | curl -sS -X PUT "$API/secrets" "${AUTH[@]}" -H 'Content-Type: application/json' --data @- | ok "secret $1"
}
secret SUPABASE_URL "$SUPABASE_URL"
secret SUPABASE_SERVICE_KEY "$SUPABASE_SERVICE_KEY"
secret CF_API_TOKEN "$CLOUDFLARE_API_TOKEN"

curl -sS -X PUT "$API/schedules" "${AUTH[@]}" -H 'Content-Type: application/json' \
  --data '[{"cron":"7 * * * *"}]' | ok schedule
