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
 *   https://amefys.com/dl/beta/AMEFYS-Setup.exe
 *       -> the newest published *pre-release* (tag with -beta / -rc) on
 *          github.com/amefys/web, resolved via the Releases API. Stable
 *          users never see it: /dl/<file> keeps following releases/latest,
 *          which GitHub defines as the newest non-prerelease.
 *
 * Caching policy:
 *   - Versioned URL [/dl/v0.1.17/*]   -> 30 days, immutable
 *   - Latest URL    [/dl/<filename>]  -> 1 hour, so a new release the CI
 *                                        warms with curl gets seen quickly
 *   - Beta URL      [/dl/beta/<file>]  -> 10 minutes; the tag lookup itself
 *                                        is cached for 10 minutes too
 */

const GH_OWNER = 'amefys'
const GH_REPO = 'web'

// Newest published pre-release tag (drafts excluded), or null. The
// unauthenticated Releases API allows 60 requests/hour per IP; the 10-minute
// edge cache below keeps a busy beta well inside that.
async function latestPrereleaseTag() {
  const api = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases?per_page=20`
  const res = await fetch(api, {
    headers: { 'User-Agent': 'amefys-dl-proxy', Accept: 'application/vnd.github+json' },
    cf: { cacheTtl: 600, cacheEverything: true }
  })
  if (!res.ok) return null
  const releases = await res.json()
  const beta = releases.find((r) => r.prerelease && !r.draft)
  return beta ? beta.tag_name : null
}

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
    } else if (parts[1] === 'beta') {
      const tag = await latestPrereleaseTag()
      if (!tag) return new Response('No beta release', { status: 404 })
      ghPath = `releases/download/${tag}/${encodeURIComponent(parts[2])}`
      ttl = 600 // 10 minutes — a beta may be replaced within the day
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
