#!/usr/bin/env bash
# Upload worker/donor-wall.js (the donate page's wall, hourly cron + admin endpoint) via the API.
#   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… KV_ID=… \
#     [AFDIAN_USER_ID=… AFDIAN_API_TOKEN=…] [ADMIN_KEY=…] worker/deploy-donor-wall.sh
# Bindings: R2 bucket `amefys-cdn` as CDN (writes donors.json), KV namespace `donor-wall` as
# DONORS (KV_ID = its id; WeChat list, hidden list, last afdian read — kept out of the public bucket).
# Var DONATION_PLAN_IDS: afdian plans that count as donations (comma-separated; free-amount
# orders always count). Add a plan here when a new donation tier is created on afdian.
# Secrets are kept across uploads (keep_bindings); pass one only to set or change it.
# The admin endpoint is on workers.dev; the ops panel calls it with ADMIN_KEY.
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?}" "${CLOUDFLARE_ACCOUNT_ID:?}" "${KV_ID:?}"
DONATION_PLAN_IDS="${DONATION_PLAN_IDS:-d415338ac9eb11f1bb1952540025c377}"
HERE="$(cd "$(dirname "$0")" && pwd)"
API="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/donor-wall"
AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
ok() { python3 -c 'import sys,json; d=json.load(sys.stdin); print(sys.argv[1], "ok" if d.get("success") else json.dumps(d.get("errors"), ensure_ascii=False))' "$1"; }

META=$(python3 -c 'import json,sys; print(json.dumps({"main_module":"donor-wall.js","compatibility_date":"2026-10-01","keep_bindings":["secret_text"],"bindings":[
  {"type":"r2_bucket","name":"CDN","bucket_name":"amefys-cdn"},
  {"type":"kv_namespace","name":"DONORS","namespace_id":sys.argv[1]},
  {"type":"plain_text","name":"DONATION_PLAN_IDS","text":sys.argv[2]}]}))' "$KV_ID" "$DONATION_PLAN_IDS")
curl -sS -X PUT "$API" "${AUTH[@]}" \
  -F "metadata=$META;type=application/json" \
  -F "donor-wall.js=@$HERE/donor-wall.js;type=application/javascript+module" | ok upload

secret() {
  python3 -c 'import json,sys; print(json.dumps({"name": sys.argv[1], "text": sys.argv[2], "type": "secret_text"}))' "$1" "$2" \
    | curl -sS -X PUT "$API/secrets" "${AUTH[@]}" -H 'Content-Type: application/json' --data @- | ok "secret $1"
}
for name in AFDIAN_USER_ID AFDIAN_API_TOKEN ADMIN_KEY; do
  if [ -n "${!name:-}" ]; then secret "$name" "${!name}"; else echo "$name unchanged"; fi
done

curl -sS -X PUT "$API/schedules" "${AUTH[@]}" -H 'Content-Type: application/json' \
  --data '[{"cron":"17 * * * *"}]' | ok schedule
curl -sS -X POST "$API/subdomain" "${AUTH[@]}" -H 'Content-Type: application/json' \
  --data '{"enabled":true}' | ok workers.dev
