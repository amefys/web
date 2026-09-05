#!/usr/bin/env bash
# One-off: copy existing GitHub Release installers into the R2 bucket so
# /dl/* is served from R2 before the next CI release. Needs:
#   R2_ACCOUNT_ID  R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY   (R2 API token, Object Read & Write)
#   gh CLI authenticated with read access to amefys/web
#   aws CLI (any version; only used as an S3 client)
#
# Usage:
#   scripts/r2-backfill.sh v0.22.1          # uploads v0.22.1/* and writes latest.json
#   scripts/r2-backfill.sh v0.23.0-beta.0   # uploads and writes beta.json
#   POINTER=none scripts/r2-backfill.sh v0.21.2   # upload only, leave pointers alone
set -euo pipefail

TAG="${1:?usage: r2-backfill.sh <tag>}"
BUCKET="${R2_BUCKET:-amefys-dl}"
: "${R2_ACCOUNT_ID:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "→ downloading $TAG assets from github.com/amefys/web"
gh release download "$TAG" --repo amefys/web --dir "$work" --clobber

echo "→ uploading to r2://$BUCKET/$TAG/"
aws s3 sync "$work/" "s3://$BUCKET/$TAG/" --endpoint-url "$ENDPOINT" --no-progress

pointer="${POINTER:-auto}"
if [[ "$pointer" == auto ]]; then
  if [[ "$TAG" == *-beta* || "$TAG" == *-rc* ]]; then pointer=beta; else pointer=latest; fi
fi
if [[ "$pointer" != none ]]; then
  echo "{\"tag\":\"$TAG\"}" > "$work/$pointer.json"
  aws s3 cp "$work/$pointer.json" "s3://$BUCKET/$pointer.json" --endpoint-url "$ENDPOINT" \
    --content-type application/json --cache-control 'public, max-age=60'
  echo "→ $pointer.json now points at $TAG"
fi
echo "done"
