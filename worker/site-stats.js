/**
 * site-stats — the numbers on the homepage (2026-10-15).
 *
 * A cron Worker (hourly). It gathers four public, aggregate numbers and writes
 * them to the CDN bucket as `stats.json`, served at https://cdn.amefys.com/stats.json
 * (5-minute cache rule). The homepage only reads that file — no credential ever
 * reaches a browser.
 *
 *   users      registered accounts            Supabase Auth (service key, Worker secret)
 *   downloads  installer downloads, all-time  Analytics Engine `amefys_dl` (written by
 *                                             dl-proxy.js); AE keeps only ~90 days, so the
 *                                             total is carried forward in stats/state.json
 *                                             and each run adds the new window
 *   releases   count, first and last date     GitHub releases of amefys/web
 *   bp         matches behind BP picks        the latest draft data pack on the CDN
 *
 * Every source is optional: a failed read keeps the previous value, so the page
 * never shows a blank or a drop caused by an outage. Only aggregates are stored.
 *
 * Deploy: worker/deploy-site-stats.sh. Bindings: R2 `amefys-cdn` as CDN.
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_KEY, CF_API_TOKEN (Account Analytics: Read);
 * var CF_ACCOUNT_ID.
 */

export const STATS_KEY = 'stats.json'
export const STATE_KEY = 'stats/state.json'
const CDN = 'https://cdn.amefys.com'
const INSTALLERS = "('AMEFYS-Setup.exe','AMEFYS.dmg')"
/** Analytics Engine ingestion lags a little; never count the last few minutes. */
const AE_LAG_MS = 10 * 60 * 1000

/** `2026-10-15 03:00:00` — the DateTime literal Analytics Engine SQL wants (UTC). */
export function aeTime(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

async function json(fetch, url, init) {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return res.json()
}

export async function countUsers(fetch, supabaseUrl, key) {
  const res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/admin/users?page=1&per_page=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  })
  if (!res.ok) throw new Error(`users → HTTP ${res.status}`)
  const header = Number(res.headers.get('x-total-count'))
  if (Number.isFinite(header) && header > 0) return header
  const body = await res.json()
  const n = Number(body && body.total)
  if (!Number.isFinite(n)) throw new Error('users → no total')
  return n
}

/** Downloads in (since, until]; `since` null = everything Analytics Engine still has. */
export async function countDownloads(fetch, account, token, sinceMs, untilMs) {
  const lower = sinceMs == null ? '' : ` AND timestamp > toDateTime('${aeTime(sinceMs)}')`
  const sql =
    `SELECT SUM(_sample_interval * double1) AS n FROM amefys_dl WHERE blob2 IN ${INSTALLERS}` +
    `${lower} AND timestamp <= toDateTime('${aeTime(untilMs)}') FORMAT JSON`
  const body = await json(fetch, `https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
    body: sql
  })
  const row = body && body.data && body.data[0]
  return row && row.n != null ? Math.round(Number(row.n)) : 0
}

export async function readReleases(fetch) {
  const all = []
  for (let page = 1; page <= 5; page++) {
    const rows = await json(fetch, `https://api.github.com/repos/amefys/web/releases?per_page=100&page=${page}`, {
      headers: { 'User-Agent': 'amefys-site-stats', Accept: 'application/vnd.github+json' }
    })
    all.push(...rows)
    if (rows.length < 100) break
  }
  const dates = all.filter((r) => !r.draft && r.published_at).map((r) => r.published_at).sort()
  if (!dates.length) throw new Error('releases → none')
  return { count: dates.length, first: dates[0].slice(0, 10), last: dates[dates.length - 1].slice(0, 10) }
}

/** The latest pack's match counts; skips the 200 KB download when the pack has not moved. */
export async function readBp(fetch, prev) {
  const index = await json(fetch, `${CDN}/draft/index.json`)
  const latest = index && index.latest
  if (!latest || !latest.path) throw new Error('bp → no latest pack')
  if (prev && prev.path === latest.path) return prev
  const pack = await json(fetch, `${CDN}/draft/${latest.path}`)
  const ranked = Number(pack.ranked && pack.ranked.matches) || 0
  const turbo = Number(pack.turbo && pack.turbo.matches) || 0
  return {
    path: latest.path,
    matches: ranked + turbo,
    ranked,
    turbo,
    from: latest.window && latest.window.from,
    to: latest.window && latest.window.to,
    builtAt: latest.builtAt
  }
}

/**
 * One run. Pure apart from `fetch`: takes the previous state, returns the new
 * state and the public stats. `errors` lists the sources that failed (kept as-is).
 */
export async function collect({ fetch, now, state, env }) {
  const prev = state || {}
  const next = { ...prev }
  const errors = []
  const attempt = async (name, job) => {
    try {
      await job()
    } catch (err) {
      errors.push(`${name}: ${err && err.message ? err.message : err}`)
    }
  }

  await Promise.all([
    attempt('users', async () => {
      next.users = await countUsers(fetch, env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
    }),
    attempt('downloads', async () => {
      const until = now - AE_LAG_MS
      const d = prev.downloads
      const since = d && d.through ? Date.parse(d.through) : null
      if (since != null && since >= until) return
      const added = await countDownloads(fetch, env.CF_ACCOUNT_ID, env.CF_API_TOKEN, since, until)
      next.downloads = { total: (d ? d.total : 0) + added, through: new Date(until).toISOString() }
    }),
    attempt('releases', async () => {
      next.releases = await readReleases(fetch)
    }),
    attempt('bp', async () => {
      next.bp = await readBp(fetch, prev.bp)
    })
  ])

  const stats = {
    schema: 1,
    asOf: new Date(now).toISOString(),
    users: next.users ?? null,
    downloads: next.downloads ? next.downloads.total : null,
    releases: next.releases ?? null,
    bp: next.bp
      ? { matches: next.bp.matches, ranked: next.bp.ranked, turbo: next.bp.turbo, from: next.bp.from, to: next.bp.to, builtAt: next.bp.builtAt }
      : null
  }
  return { state: next, stats, errors }
}

async function run(env) {
  let state = null
  const obj = await env.CDN.get(STATE_KEY)
  if (obj) state = await obj.json()
  const { state: next, stats, errors } = await collect({ fetch, now: Date.now(), state, env })
  await env.CDN.put(STATE_KEY, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' } })
  await env.CDN.put(STATS_KEY, JSON.stringify(stats), {
    httpMetadata: { contentType: 'application/json', cacheControl: 'public, max-age=300' }
  })
  if (errors.length) console.log('site-stats: kept previous values for', errors)
  return { stats, errors }
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(run(env))
  }
}
