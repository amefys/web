#!/usr/bin/env bash
# Upload worker/pack-stats.js to Cloudflare with its bindings via the API.
#   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… worker/deploy-pack-stats.sh
#
# Binding: KV namespace `amefys-pack-stats` as PACK_STATS. It MUST be listed
# here — a PUT without it silently drops the binding and every /p/* request
# starts throwing, with the existing counts stranded in an unbound namespace.
#
# Run this after touching the PACKS array in pack-stats.js. The array is the
# allowlist for /p/track, so a slug missing from the deployed copy has its
# downloads dropped on the floor rather than counted (that is how the six
# taunt packs went uncounted from 2026-06-07 to 2026-09-10).
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?}" "${CLOUDFLARE_ACCOUNT_ID:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"
KV_ID="${PACK_STATS_KV_ID:-2dbcc8790b55458a88e2a0b9d417dbad}"  # amefys-pack-stats
META="{\"main_module\":\"pack-stats.js\",\"compatibility_date\":\"2026-05-20\",\"bindings\":[{\"type\":\"kv_namespace\",\"name\":\"PACK_STATS\",\"namespace_id\":\"$KV_ID\"}]}"
curl -sS -X PUT "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/pack-stats" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F "metadata=$META;type=application/json" \
  -F "pack-stats.js=@$HERE/pack-stats.js;type=application/javascript+module" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("deployed" if d.get("success") else json.dumps(d.get("errors"), ensure_ascii=False))'
