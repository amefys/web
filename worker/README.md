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

### Download telemetry (2026-09-06)

`countDownload()` writes one Analytics Engine data point per installer fetch
(tag / file / channel / source / country — no IPs) into dataset `amefys_dl`,
bound as `DL_STATS`. Redeploy with both bindings via
`CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… worker/deploy-dl-proxy.sh`.
The amefys repo's `npm run ops` dashboard reads it through the SQL API
(token needs Account Analytics: Read).

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

First time only, in the CF dashboard: **Workers & Pages → Create
application → Create Worker → name `pack-stats`**, then add the KV binding
and the route per above.

Every deploy after that goes through the script, which re-declares the KV
binding on each PUT:

```
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… worker/deploy-pack-stats.sh
```

The token needs **Account · Workers Scripts · Edit**.

**Run it whenever `PACKS` in `pack-stats.js` changes.** That array is the
allowlist for `/p/track`: a slug that is missing from the *deployed* copy
has its downloads dropped and still gets a `204`, so nothing anywhere
reports an error — the pack simply never appears on the leaderboard. The
six taunt packs shipped 2026-06-07 went uncounted until 2026-09-10 for
exactly this reason, because the deploy was a manual dashboard step that
nobody remembered to repeat.

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

## `studio-inquiry.js` — `/api/studio`, the /studio/ contact form (2026-10-17)

POST JSON from `studio/index.html`. Order: validate → Turnstile (widget
**amefys studio**, invisible, domains amefys.com + amefys.cn) → per-IP limit (5/hour) →
store in KV → email via Resend. The inquiry is stored before the email is
tried, so an email failure never loses it.

- KV namespace `studio-inquiries` bound as `INQUIRIES` (keys `inq:<ISO time>:<rand>`,
  kept 400 days; `rl:<hour>:<ip>` counters expire after 1 hour).
- Route `amefys.com/api/studio` → `studio-inquiry` (created via the API on 2026-10-17).
- Secrets: `TURNSTILE_SECRET` (read it back from the widget via the API when
  redeploying), `RESEND_API_KEY` (optional; without it inquiries are only stored).
- Deploy: `worker/deploy-studio-inquiry.sh` (needs `KV_ID`; secrets are kept across uploads,
  pass `TURNSTILE_SECRET` / `RESEND_API_KEY` only to change them).
- CORS: only `https://amefys.cn` (the mainland mirror on ali-99) may post cross-origin
  (`ALLOWED_ORIGINS`); it posts here directly so the per-IP limit and Turnstile see the visitor.

Read stored inquiries: `wrangler kv key list --namespace-id <KV_ID> --prefix inq:`
then `wrangler kv key get --namespace-id <KV_ID> <key>`.

## `donor-wall.js` — `cdn.amefys.com/donors.json`, the wall on donate.html (2026-10-24)

Hourly cron (minute 17). Reads afdian (`query-sponsor` + `query-order`, signed with the API
token) and the WeChat list the ops panel keeps in KV, writes `donors.json` to the `amefys-cdn`
bucket. `assets/donor-wall.js` on both donate pages reads it; if it fails, the wall stays hidden.

- **Public file has no amounts, plans, payer ids or addresses.** Only donation plans count
  (`DONATION_PLAN_IDS` + free-amount orders) — membership and goods buyers never agreed to be
  listed. A new donation tier on afdian has to be added to `DONATION_PLAN_IDS` (the ops panel
  lists skipped plans, so a missing one shows up there).
- Default afdian nickname / avatar → anonymous tile; WeChat names masked unless confirmed.
- KV `donor-wall` (binding `DONORS`) holds `manual`, `hidden`, `afdian-cache`; it is not in the
  CDN bucket because everything there is public.
- Admin endpoint on workers.dev (`/admin/state|manual|hide|refresh`, bearer `ADMIN_KEY`, any
  other request 404s) — used by the ops panel's 捐助墙 card in the `amefys` repo.
- Cache rule: `donors.json` shares the 5-minute rule with `stats.json`.

```
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… KV_ID=… \
  AFDIAN_USER_ID=… AFDIAN_API_TOKEN=… ADMIN_KEY=… worker/deploy-donor-wall.sh
```
