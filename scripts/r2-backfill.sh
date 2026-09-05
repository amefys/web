#!/usr/bin/env bash
# One-off: copy an existing GitHub Release's installers into the R2 bucket so
# /dl/* serves it from R2 before/without a CI run. Needs:
#   CLOUDFLARE_API_TOKEN   (Workers R2 Storage: Edit on the account)
#   CLOUDFLARE_ACCOUNT_ID
#   node/npx (wrangler is fetched on demand)
#
# Usage:
#   scripts/r2-backfill.sh v0.22.1          # uploads v0.22.1/* and writes latest.json
#   scripts/r2-backfill.sh v0.23.0-beta.0   # uploads and writes beta.json
#   POINTER=none scripts/r2-backfill.sh v0.21.2   # upload only, leave pointers alone
set -euo pipefail

TAG="${1:?usage: r2-backfill.sh <tag>}"
BUCKET="${R2_BUCKET:-amefys-dl}"
: "${CLOUDFLARE_API_TOKEN:?}" "${CLOUDFLARE_ACCOUNT_ID:?}"
FILES=(AMEFYS-Setup.exe AMEFYS-Setup.exe.blockmap latest.yml AMEFYS.dmg AMEFYS.dmg.blockmap latest-mac.yml)

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

for f in "${FILES[@]}"; do
  url="https://github.com/amefys/web/releases/download/$TAG/$f"
  echo "→ $f"
  if ! curl -sSL --retry 3 -o "$work/$f" "$url"; then echo "   (missing on GitHub, skipped)"; continue; fi
  npx --yes wrangler@3 r2 object put "$BUCKET/$TAG/$f" --file "$work/$f" --remote
done

pointer="${POINTER:-auto}"
if [[ "$pointer" == auto ]]; then
  if [[ "$TAG" == *-beta* || "$TAG" == *-rc* ]]; then pointer=beta; else pointer=latest; fi
fi
if [[ "$pointer" != none ]]; then
  echo "{\"tag\":\"$TAG\"}" > "$work/$pointer.json"
  npx --yes wrangler@3 r2 object put "$BUCKET/$pointer.json" --file "$work/$pointer.json" \
    --content-type application/json --cache-control 'public, max-age=60' --remote
  echo "→ $pointer.json now points at $TAG"
fi
echo "done"
