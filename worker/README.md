# Cloudflare Workers · setup

Two workers live here. Both bind a route on `amefys.com/...` in the
Cloudflare dashboard; they are not auto-deployed by CI (yet).

## 1. `dl-proxy.js` — `/dl/*` installer downloads (R2 → GitHub fallback)

Serves the installers from an R2 bucket and falls back to proxying the
GitHub Release when an object is missing. See the file header for the URL
contract. The edge cache alone cannot do this job: Cloudflare caps a
cacheable object at 100 MB on Free/Pro, and both installers are bigger,
so before R2 every download streamed from GitHub's US origin.

### Bindings required

R2 bucket bound as **`DL`**.

1. Dashboard → **R2 Object Storage** → **Create bucket** → name
   `amefys-dl`, location hint APAC (closest to most users).
2. **Workers & Pages** → **dl-proxy** → **Settings** → **Bindings** →
   **Add** → R2 bucket → variable name `DL`, bucket `amefys-dl`.
3. Paste the current `dl-proxy.js` → **Save and Deploy**.

### Uploads

`amefys` repo's `release.yml` uploads every published release to
`amefys-dl/<tag>/*` with wrangler and rewrites the channel pointer
(`latest.json` for stable, `beta.json` for -beta/-rc). It needs two repo
secrets on `amefys/amefys`:

| secret | value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | an API token with **Account · Workers R2 Storage · Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | the account id (R2 overview page / any dashboard URL) |

Without them the step is skipped and downloads keep working through the
GitHub fallback.

Backfill releases that predate the upload step with the same credentials:

```
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… \
  scripts/r2-backfill.sh v0.22.1          # stable → also writes latest.json
  scripts/r2-backfill.sh v0.23.0-beta.0   # pre-release → writes beta.json
```

Bucket `amefys-dl` (APAC) and the `DL` binding were created via the API on
2026-09-05; both releases above were backfilled the same day.

### Verify

```
curl -sI https://amefys.com/dl/AMEFYS-Setup.exe | grep -i 'x-amefys-source\|accept-ranges'
# → X-AMEFYS-Source: r2   Accept-Ranges: bytes      (github = fallback path)
```

## 2. `pack-stats.js` — `/p/*` quick-reply pack telemetry

Powers the "热门下载榜" on `amefys.com/packs/`. Tracks per-pack
download counts in CF KV and exposes them via `/p/stats.json`.

### Bindings required

KV namespace bound as **`PACK_STATS`**.

1. Cloudflare dashboard → **Workers & Pages** → **KV** → **Create**
   namespace named `amefys-pack-stats`.
2. **Workers & Pages** → **pack-stats** worker → **Settings** →
   **Variables and Secrets** → **KV Namespace Bindings** → **Add
   binding** → name = `PACK_STATS`, namespace = `amefys-pack-stats`.

### Route

`amefys.com/p/*` on the `amefys.com` zone (Workers → pack-stats →
Triggers → Routes → Add route).

### Deploy steps

```
# In CF dashboard:
# Workers & Pages → Create application → Create Worker → name "pack-stats"
# Edit code → paste contents of pack-stats.js → Save and Deploy
# Add KV binding + Route per above.
```

### Verify

```
curl https://amefys.com/p/stats.json
# → {"counts":{"essentials":0,"cn-tactics":0,...},"updatedAt":...}

curl -I "https://amefys.com/p/track?p=essentials"
# → HTTP/2 204
```

After a few downloads via the gallery, refresh `amefys.com/packs/` —
the orange "🔥 本周热门下载" band appears at the top of the grid
and the top 3 cards get rank medals (🥇/🥈/🥉).

The gallery JS handles the worker not being deployed yet: `stats.json`
404 → leaderboard band stays hidden, no medals shown, downloads still
work normally via GitHub Pages.
