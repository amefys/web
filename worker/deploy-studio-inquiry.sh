#!/usr/bin/env bash
# Upload worker/studio-inquiry.js (the /studio/ contact form) via the API.
#   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… KV_ID=… [TURNSTILE_SECRET=…] [RESEND_API_KEY=…] \
#     worker/deploy-studio-inquiry.sh
# Binding: KV namespace `studio-inquiries` as INQUIRIES (KV_ID = its id).
# Route: amefys.com/api/studio (created once in the zone, see worker/README.md).
# Secrets: TURNSTILE_SECRET (widget "amefys studio"), RESEND_API_KEY (without it inquiries
# are stored in KV but not emailed). Both are kept across uploads (keep_bindings), so a code-only
# redeploy can leave them unset; pass one only to set or change it.
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?}" "${CLOUDFLARE_ACCOUNT_ID:?}" "${KV_ID:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"
API="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/studio-inquiry"
AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
ok() { python3 -c 'import sys,json; d=json.load(sys.stdin); print(sys.argv[1], "ok" if d.get("success") else json.dumps(d.get("errors"), ensure_ascii=False))' "$1"; }

META=$(python3 -c 'import json,sys; print(json.dumps({"main_module":"studio-inquiry.js","compatibility_date":"2026-10-01","keep_bindings":["secret_text"],"bindings":[
  {"type":"kv_namespace","name":"INQUIRIES","namespace_id":sys.argv[1]},
  {"type":"plain_text","name":"RESEND_FROM","text":"AMEFYS 工作室 <studio@amefys.com>"},
  {"type":"plain_text","name":"NOTIFY_TO","text":"amefys@gmail.com"}]}))' "$KV_ID")
curl -sS -X PUT "$API" "${AUTH[@]}" \
  -F "metadata=$META;type=application/json" \
  -F "studio-inquiry.js=@$HERE/studio-inquiry.js;type=application/javascript+module" | ok upload

secret() {
  python3 -c 'import json,sys; print(json.dumps({"name": sys.argv[1], "text": sys.argv[2], "type": "secret_text"}))' "$1" "$2" \
    | curl -sS -X PUT "$API/secrets" "${AUTH[@]}" -H 'Content-Type: application/json' --data @- | ok "secret $1"
}
if [ -n "${TURNSTILE_SECRET:-}" ]; then secret TURNSTILE_SECRET "$TURNSTILE_SECRET"; else echo "TURNSTILE_SECRET unchanged"; fi
if [ -n "${RESEND_API_KEY:-}" ]; then secret RESEND_API_KEY "$RESEND_API_KEY"; else echo "RESEND_API_KEY unchanged"; fi
