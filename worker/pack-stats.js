/**
 * amefys.com /p/* — Cloudflare Worker for quick-reply pack download
 * tracking + leaderboard.
 *
 * Why this exists:
 *   GitHub Pages serves the static /packs/<slug>.amefys-replies.json
 *   files directly with zero analytics. To power the "热门下载榜" on
 *   /packs/ we need a counter that survives across edge requests; CF KV
 *   is the cheapest fit (free tier handles tens of millions of reads/mo
 *   and 100k writes/day).
 *
 * Endpoints:
 *
 *   GET /p/track?p=<slug>
 *     Fire-and-forget beacon called from each pack-card download button.
 *     Increments PACK_STATS[slug] by 1. Always returns 204 (no body)
 *     so it's safe to call with fetch({keepalive: true}) right before
 *     the actual download navigation.
 *
 *   GET /p/stats.json
 *     Returns the full counts map as JSON. The gallery page fetches
 *     this on load, sorts, and decorates the top 3 cards with rank
 *     medals. 60s edge cache so KV reads don't blow up.
 *
 * Bindings required (set on the Worker in the CF dashboard):
 *   - KV namespace `PACK_STATS` (Settings → Variables → KV Namespace
 *     Bindings → Add binding)
 *
 * Route to install (Workers → pack-stats → Triggers → Routes):
 *   - amefys.com/p/*
 *
 * The actual .json downloads keep going through GitHub Pages /packs/
 * — we only proxy the beacon + stats endpoints. This keeps the worker
 * footprint tiny and the download itself zero-latency.
 */

// Keep this in sync with the files in amefys-web/packs/.
// New slug? Add here and the leaderboard will start counting it.
const PACKS = [
  'essentials',
  'cn-tactics',
  'intl-en',
  'banter-cn',
  'numbers-meme',
  'timings',
  'ru-friendly',
  'sea-international'
]

const CORS_HEADERS = {
  'access-control-allow-origin': 'https://amefys.com',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-max-age': '86400'
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    // ── /p/stats.json — aggregated counts ────────────────────────────
    if (url.pathname === '/p/stats.json') {
      const counts = {}
      // KV reads are eventually consistent, but for a leaderboard
      // refreshed every minute that's fine. Parallelise to keep
      // p99 under ~50ms.
      const pairs = await Promise.all(
        PACKS.map(async (slug) => [slug, parseInt((await env.PACK_STATS.get(slug)) || '0', 10)])
      )
      for (const [slug, n] of pairs) counts[slug] = n
      return new Response(JSON.stringify({ counts, updatedAt: Date.now() }), {
        headers: {
          ...CORS_HEADERS,
          'content-type': 'application/json',
          'cache-control': 'public, max-age=60, stale-while-revalidate=300'
        }
      })
    }

    // ── /p/track — fire-and-forget beacon ────────────────────────────
    if (url.pathname === '/p/track') {
      const slug = url.searchParams.get('p')
      if (slug && PACKS.includes(slug)) {
        ctx.waitUntil(
          (async () => {
            const cur = parseInt((await env.PACK_STATS.get(slug)) || '0', 10)
            await env.PACK_STATS.put(slug, String(cur + 1))
          })()
        )
      }
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    return new Response('Not found', { status: 404, headers: CORS_HEADERS })
  }
}
