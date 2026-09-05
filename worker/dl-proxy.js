/**
 * amefys.com /dl/* — installer downloads.
 *
 * Storage order:
 *   1. Cloudflare R2 bucket (binding `DL`, keys `<tag>/<filename>`). Served
 *      straight from Cloudflare's own network: no origin hop, free egress,
 *      Range requests for resumable downloads, and no cache-size ceiling.
 *   2. GitHub Releases on amefys/web, proxied, when the object is not in R2
 *      yet (older releases, or a release whose R2 upload step was skipped).
 *
 * Why R2 and not just the edge cache: Cloudflare's cache caps a single
 * object at 100 MB on the Free/Pro plans. AMEFYS-Setup.exe is ~114 MB and
 * the universal DMG ~234 MB, so the old cache-the-GitHub-response design
 * never actually cached anything — every download streamed from GitHub's US
 * origin through the edge at a few hundred KB/s (measured 2026-09-05).
 *
 * URL contract [as seen from the browser]:
 *   /dl/AMEFYS-Setup.exe            -> newest stable   (R2 `latest.json` → <tag>/<file>;
 *                                      fallback github releases/latest/download/<file>)
 *   /dl/beta/AMEFYS-Setup.exe       -> newest pre-release (R2 `beta.json`;
 *                                      fallback: Releases API, first non-draft prerelease)
 *   /dl/v0.23.0/AMEFYS-Setup.exe    -> that tag       (R2 <tag>/<file>;
 *                                      fallback github releases/download/<tag>/<file>)
 *
 * Pointer files, written by amefys' release.yml after every publish:
 *   latest.json  {"tag":"v0.23.0"}         — stable releases only
 *   beta.json    {"tag":"v0.24.0-beta.0"}  — -beta / -rc releases only
 *
 * Bindings: R2 bucket bound as `DL` (see README). Without the binding the
 * worker degrades to the GitHub proxy path.
 */

const GH_OWNER = 'amefys'
const GH_REPO = 'web'
const TAG_RE = /^v\d+\.\d+\.\d+(-[\w.]+)?$/
const POINTER_TTL_S = 60

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] !== 'dl' || parts.length < 2 || parts.length > 3) {
      return new Response('Not found', { status: 404 })
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 })
    }

    const file = parts[parts.length - 1]
    let channel // 'latest' | 'beta' | <tag>
    if (parts.length === 2) channel = 'latest'
    else if (parts[1] === 'beta') channel = 'beta'
    else if (TAG_RE.test(parts[1])) channel = parts[1]
    else return new Response('Invalid tag', { status: 400 })

    // ── 1. R2 ────────────────────────────────────────────────────────
    if (env.DL) {
      const tag = TAG_RE.test(channel) ? channel : await pointerTag(env.DL, channel)
      if (tag) {
        const r2 = await serveFromR2(env.DL, `${tag}/${file}`, request, channel, file)
        if (r2) return r2
      }
    }

    // ── 2. GitHub fallback ───────────────────────────────────────────
    return serveFromGitHub(channel, file, request, ctx)
  }
}

/** Resolve `latest` / `beta` to a tag via the pointer object in R2. */
async function pointerTag(bucket, channel) {
  const obj = await bucket.get(`${channel}.json`)
  if (!obj) return null
  try {
    const { tag } = await obj.json()
    return TAG_RE.test(tag) ? tag : null
  } catch {
    return null
  }
}

async function serveFromR2(bucket, key, request, channel, file) {
  const object = await bucket.get(key, {
    range: request.headers, // honours Range → resumable downloads
    onlyIf: request.headers // honours If-None-Match / If-Modified-Since
  })
  if (!object) return null

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Content-Disposition', `attachment; filename="${file}"`)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-AMEFYS-Source', 'r2')
  if (!headers.has('Content-Type')) headers.set('Content-Type', contentType(file))
  // Versioned objects are immutable; channel aliases move on every release.
  headers.set(
    'Cache-Control',
    TAG_RE.test(channel) ? 'public, max-age=2592000, immutable' : 'public, max-age=300'
  )

  // `body` is undefined when onlyIf matched (304) — object.size etc. still set.
  if (object.body === undefined) {
    return new Response(null, { status: 304, headers })
  }
  // R2 reports `range` even for a full read; only answer 206 when the client
  // actually asked for a range, otherwise plain downloads would see a partial
  // status (observed as 206 on every GET/HEAD, 2026-09-05).
  if (object.range && request.headers.has('Range')) {
    const { offset, length } = normaliseRange(object.range, object.size)
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`)
    headers.set('Content-Length', String(length))
    return new Response(request.method === 'HEAD' ? null : object.body, { status: 206, headers })
  }
  headers.set('Content-Length', String(object.size))
  return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers })
}

function normaliseRange(range, size) {
  if ('suffix' in range) return { offset: size - range.suffix, length: range.suffix }
  const offset = range.offset ?? 0
  const length = range.length ?? size - offset
  return { offset, length }
}

function contentType(file) {
  if (file.endsWith('.yml') || file.endsWith('.yaml')) return 'text/yaml; charset=utf-8'
  if (file.endsWith('.json')) return 'application/json; charset=utf-8'
  if (file.endsWith('.dmg')) return 'application/x-apple-diskimage'
  if (file.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable'
  return 'application/octet-stream'
}

/**
 * GitHub proxy — the pre-R2 path, kept as fallback. Objects over 100 MB are
 * never cached at the edge on this plan, so this is slow by nature; it only
 * has to be correct.
 */
async function serveFromGitHub(channel, file, request, ctx) {
  let ghPath, ttl
  if (channel === 'latest') {
    ghPath = `releases/latest/download/${encodeURIComponent(file)}`
    ttl = 3600
  } else if (channel === 'beta') {
    const tag = await latestPrereleaseTag()
    if (!tag) return new Response('No beta release', { status: 404 })
    ghPath = `releases/download/${tag}/${encodeURIComponent(file)}`
    ttl = 600
  } else {
    ghPath = `releases/download/${channel}/${encodeURIComponent(file)}`
    ttl = 30 * 24 * 3600
  }
  const ghUrl = `https://github.com/${GH_OWNER}/${GH_REPO}/${ghPath}`

  const cache = caches.default
  const cacheKey = new Request(new URL(request.url).toString(), { method: 'GET' })
  const cached = await cache.match(cacheKey)
  if (cached) return cached

  // cacheTtlByStatus, not cacheTtl: a plain cacheTtl also pins error
  // responses, so one request for a not-yet-published tag poisoned that
  // versioned URL with a 404 for 30 days (v0.23.0-beta.0, 2026-09-04).
  const range = request.headers.get('Range')
  const upstream = await fetch(ghUrl, {
    cf: { cacheTtlByStatus: { '200-299': ttl, '404': 30, '500-599': 0 }, cacheEverything: true },
    redirect: 'follow',
    headers: range ? { Range: range } : {}
  })
  if (!upstream.ok) {
    return new Response(`Upstream ${upstream.status}`, { status: upstream.status })
  }

  const headers = new Headers(upstream.headers)
  headers.set('Cache-Control', `public, max-age=${ttl}${TAG_RE.test(channel) ? ', immutable' : ''}`)
  headers.set('Content-Disposition', `attachment; filename="${file}"`)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-AMEFYS-Source', 'github')
  const response = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  })
  // Only full responses are cacheable; put() silently no-ops above the
  // plan's object-size limit, which is exactly why R2 exists.
  if (upstream.status === 200) ctx.waitUntil(cache.put(cacheKey, response.clone()))
  return response
}

// Newest published pre-release tag (drafts excluded), or null. Unauthenticated
// Releases API allows 60 requests/hour per IP; the 10-minute cache keeps a
// busy beta well inside that.
async function latestPrereleaseTag() {
  const api = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases?per_page=20`
  const res = await fetch(api, {
    headers: { 'User-Agent': 'amefys-dl-proxy', Accept: 'application/vnd.github+json' },
    cf: { cacheTtlByStatus: { '200-299': POINTER_TTL_S * 10, '400-599': 0 }, cacheEverything: true }
  })
  if (!res.ok) return null
  const releases = await res.json()
  const beta = releases.find((r) => r.prerelease && !r.draft)
  return beta ? beta.tag_name : null
}
