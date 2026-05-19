# Cloudflare Workers · setup

Two workers live here. Both bind a route on `amefys.com/...` in the
Cloudflare dashboard; they are not auto-deployed by CI (yet).

## 1. `dl-proxy.js` — `/dl/*` installer reverse-proxy

Already deployed. Caches GitHub release assets at the CF edge so the
public download URLs (`amefys.com/dl/AMEFYS-Setup.exe`) hit warm cache
worldwide instead of the slow GitHub origin. See file header for the
URL contract and cache policy.

No bindings required.

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
