#!/usr/bin/env bash
# Upload worker/dl-proxy.js to Cloudflare with its bindings via the API.
#   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… worker/deploy-dl-proxy.sh
# Bindings: R2 bucket `amefys-dl` as DL, Analytics Engine dataset `amefys_dl`
# as DL_STATS (download telemetry; see countDownload() in dl-proxy.js).
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?}" "${CLOUDFLARE_ACCOUNT_ID:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"
META='{"main_module":"dl-proxy.js","compatibility_date":"2026-05-19","bindings":[{"type":"r2_bucket","name":"DL","bucket_name":"amefys-dl"},{"type":"analytics_engine","name":"DL_STATS","dataset":"amefys_dl"}]}'
curl -sS -X PUT "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/dl-proxy" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F "metadata=$META;type=application/json" \
  -F "dl-proxy.js=@$HERE/dl-proxy.js;type=application/javascript+module" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("deployed" if d.get("success") else json.dumps(d.get("errors"), ensure_ascii=False))'
