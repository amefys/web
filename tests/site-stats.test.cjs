// site-stats Worker (2026-10-15): the homepage numbers. Every source may fail;
// a failure must keep the last good value, never blank or shrink it.
const test = require('node:test')
const assert = require('node:assert/strict')

const load = () => import('../worker/site-stats.js')
const NOW = Date.parse('2026-10-15T04:00:00Z')
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'k', CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'acc' }

function fakeFetch(routes) {
  const calls = []
  const f = async (url, init = {}) => {
    calls.push({ url, body: init.body })
    for (const [match, reply] of routes) {
      if (url.includes(match)) {
        const r = typeof reply === 'function' ? reply(url, init) : reply
        if (r instanceof Error) throw r
        return new Response(JSON.stringify(r.body), { status: r.status || 200, headers: r.headers || {} })
      }
    }
    return new Response('nope', { status: 404 })
  }
  return { f, calls }
}

const PACK = { ranked: { matches: 3683479 }, turbo: { matches: 2272836 } }
const ok = () => [
  ['/auth/v1/admin/users', { body: { users: [] }, headers: { 'x-total-count': '1764' } }],
  ['/analytics_engine/sql', { body: { data: [{ n: 2994 }] } }],
  ['/releases?per_page=100&page=1', { body: [{ published_at: '2026-10-14T10:00:00Z' }, { published_at: '2026-05-17T08:00:00Z' }, { draft: true }] }],
  ['/draft/index.json', { body: { latest: { path: 'packs/p1.json', builtAt: '2026-10-14T09:12:38Z', window: { from: '2026-10-07', to: '2026-10-13' } } } }],
  ['/draft/packs/p1.json', { body: PACK }]
]

test('a first run gathers all four numbers', async () => {
  const { collect } = await load()
  const { f } = fakeFetch(ok())
  const { stats, state, errors } = await collect({ fetch: f, now: NOW, state: null, env: ENV })
  assert.deepEqual(errors, [])
  assert.equal(stats.users, 1764)
  assert.equal(stats.downloads, 2994)
  assert.deepEqual(stats.releases, { count: 2, first: '2026-05-17', last: '2026-10-14' })
  assert.equal(stats.bp.matches, 5956315)
  assert.equal(state.downloads.through, new Date(NOW - 10 * 60 * 1000).toISOString())
})

test('downloads carry forward: a later run adds only the new window, so the 90-day retention never shrinks the total', async () => {
  const { collect } = await load()
  const routes = ok()
  routes[1] = ['/analytics_engine/sql', { body: { data: [{ n: 7 }] } }]
  const { f, calls } = fakeFetch(routes)
  const prev = { downloads: { total: 2994, through: '2026-10-15T02:50:00.000Z' } }
  const { stats } = await collect({ fetch: f, now: NOW, state: prev, env: ENV })
  assert.equal(stats.downloads, 3001)
  const sql = calls.find((c) => c.url.includes('analytics_engine')).body
  assert.match(sql, /timestamp > toDateTime\('2026-10-15 02:50:00'\)/)
  assert.match(sql, /timestamp <= toDateTime\('2026-10-15 03:50:00'\)/)
})

test('a failed source keeps its previous value and is reported', async () => {
  const { collect } = await load()
  const routes = ok()
  routes[0] = ['/auth/v1/admin/users', { status: 500, body: {} }]
  routes[2] = ['/releases', new Error('rate limited')]
  const { f } = fakeFetch(routes)
  const prev = { users: 1700, releases: { count: 100, first: '2026-05-17', last: '2026-10-10' } }
  const { stats, errors } = await collect({ fetch: f, now: NOW, state: prev, env: ENV })
  assert.equal(stats.users, 1700)
  assert.equal(stats.releases.count, 100)
  assert.equal(errors.length, 2)
})

test('an unchanged data pack is not downloaded again', async () => {
  const { collect } = await load()
  const { f, calls } = fakeFetch(ok())
  const prev = { bp: { path: 'packs/p1.json', matches: 5956315, ranked: 3683479, turbo: 2272836 } }
  await collect({ fetch: f, now: NOW, state: prev, env: ENV })
  assert.equal(calls.filter((c) => c.url.includes('/draft/packs/')).length, 0)
})

test('stats.json carries aggregates only', async () => {
  const { collect } = await load()
  const { f } = fakeFetch(ok())
  const { stats } = await collect({ fetch: f, now: NOW, state: null, env: ENV })
  assert.deepEqual(Object.keys(stats).sort(), ['asOf', 'bp', 'downloads', 'releases', 'schema', 'users'])
  assert.doesNotMatch(JSON.stringify(stats), /supabase|token|@/i)
})
