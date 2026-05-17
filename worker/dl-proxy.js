/**
 * amefys.com /dl/* — Cloudflare Worker reverse-proxy for GitHub
 * release assets.
 *
 * Why this exists:
 *   GitHub release assets are served from release-assets.githubusercontent.com,
 *   which Cloudflare cannot accelerate via the amefys.com zone proxy
 *   (different hostname). Mainland China users see 30s-90s downloads for
 *   the 100 MB installer. This worker terminates downloads at amefys.com,
 *   pulls the asset body from GitHub once, then keeps it warm on the CF
 *   edge so every subsequent download anywhere in the world is fast.
 *
 * URL contract [as seen from the browser]:
 *   https://amefys.com/dl/AMEFYS-Setup.exe
 *       -> github.com/amefys/web/releases/latest/download/AMEFYS-Setup.exe
 *   https://amefys.com/dl/AMEFYS.dmg
 *       -> github.com/amefys/web/releases/latest/download/AMEFYS.dmg
 *   https://amefys.com/dl/v0.1.17/AMEFYS-Setup.exe
 *       -> github.com/amefys/web/releases/download/v0.1.17/AMEFYS-Setup.exe
 *
 * Caching policy:
 *   - Versioned URL [/dl/v0.1.17/*]   -> 30 days, immutable
 *   - Latest URL    [/dl/<filename>]  -> 1 hour, so a new release the CI
 *                                        warms with curl gets seen quickly
 */

const GH_OWNER = 'amefys'
const GH_REPO = 'web'

export default {
  async fetch(request, _env, ctx) {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)

    // Expected shapes:
    //   ['dl', 'AMEFYS.dmg']                       -> latest
    //   ['dl', 'v0.1.17', 'AMEFYS-Setup.exe']      -> versioned
    if (parts[0] !== 'dl' || parts.length < 2 || parts.length > 3) {
      return new Response('Not found', { status: 404 })
    }

    let ghPath, ttl
    if (parts.length === 2) {
      ghPath = `releases/latest/download/${encodeURIComponent(parts[1])}`
      ttl = 3600 // 1 hour
    } else {
      const tag = parts[1]
      const file = parts[2]
      if (!/^v\d+\.\d+\.\d+(-[\w.]+)?$/.test(tag)) {
        return new Response('Invalid tag', { status: 400 })
      }
      ghPath = `releases/download/${tag}/${encodeURIComponent(file)}`
      ttl = 30 * 24 * 3600 // 30 days
    }

    const ghUrl = `https://github.com/${GH_OWNER}/${GH_REPO}/${ghPath}`

    // CF cache key has to be a Request matching exactly across calls.
    const cache = caches.default
    const cacheKey = new Request(url.toString(), { method: 'GET' })

    let response = await cache.match(cacheKey)
    if (!response) {
      // Fetch from GitHub. fetch() follows redirects by default, so the
      // final body is the asset itself, not the 302 to release-assets.
      const upstream = await fetch(ghUrl, {
        cf: { cacheTtl: ttl, cacheEverything: true },
        redirect: 'follow'
      })

      if (!upstream.ok) {
        return new Response(`Upstream ${upstream.status}`, { status: upstream.status })
      }

      // Rewrite Cache-Control so browsers + CF intermediaries also cache.
      const headers = new Headers(upstream.headers)
      headers.set('Cache-Control', `public, max-age=${ttl}${parts.length === 3 ? ', immutable' : ''}`)
      // Pretty filename in the Save As dialog.
      const fname = parts[parts.length - 1]
      headers.set('Content-Disposition', `attachment; filename="${fname}"`)
      // Hint CDN intermediaries.
      headers.set('X-Content-Type-Options', 'nosniff')

      response = new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers
      })
      // Stash a clone in the edge cache for the next visitor.
      ctx.waitUntil(cache.put(cacheKey, response.clone()))
    }

    return response
  }
}
