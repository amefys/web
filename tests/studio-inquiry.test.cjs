// studio-inquiry Worker (2026-10-17): the /studio/ contact form.
// The one rule that matters most: an inquiry is stored before the email is
// attempted, so an email failure never loses it.
const test = require('node:test')
const assert = require('node:assert/strict')

const load = () => import('../worker/studio-inquiry.js')

function kv() {
  const data = new Map()
  return {
    data,
    async get(k) { return data.has(k) ? data.get(k).v : null },
    async put(k, v, opts) { data.set(k, { v, opts }) }
  }
}

function fakeFetch({ turnstile = true, resend = 200 } = {}) {
  const calls = []
  const f = async (url, init = {}) => {
    calls.push({ url, init })
    if (url.includes('turnstile')) return new Response(JSON.stringify({ success: turnstile }))
    if (url.includes('resend.com')) {
      if (resend instanceof Error) throw resend
      return new Response('{}', { status: resend })
    }
    return new Response('nope', { status: 404 })
  }
  return { f, calls }
}

const GOOD = { name: '张先生', contact: 'zhang@example.com', background: '三人团队做 SaaS', problem: '国内登录时好时坏', budget: '1 万–10 万元', when: '一个月内', turnstile: 'tok' }
const ENV = (over = {}) => ({ INQUIRIES: kv(), TURNSTILE_SECRET: 's', RESEND_API_KEY: 'r', RESEND_FROM: 'AMEFYS 工作室 <studio@amefys.com>', NOTIFY_TO: 'amefys@gmail.com', ...over })
const req = (body, { method = 'POST', ip = '203.0.113.9', origin } = {}) =>
  new Request('https://amefys.com/api/studio', {
    method,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(origin ? { origin } : {}) },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
  })
const inquiries = (env) => [...env.INQUIRIES.data.keys()].filter((k) => k.startsWith('inq:'))

test('a valid inquiry is stored and emailed', async () => {
  const { handle } = await load()
  const env = ENV(); const { f, calls } = fakeFetch()
  const res = await handle(req(GOOD), env, { fetch: f, now: Date.parse('2026-10-17T03:00:00Z') })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true, email: 'sent' })
  assert.equal(inquiries(env).length, 1)
  const stored = JSON.parse(env.INQUIRIES.data.get(inquiries(env)[0]).v)
  assert.equal(stored.problem, '国内登录时好时坏')
  const mail = JSON.parse(calls.find((c) => c.url.includes('resend')).init.body)
  assert.deepEqual(mail.to, ['amefys@gmail.com'])
  assert.equal(mail.reply_to, 'zhang@example.com', 'replying goes straight to the client')
  assert.match(mail.text, /想解决的问题：\n国内登录时好时坏/)
})

test('an email failure still keeps the inquiry and tells the visitor it was received', async () => {
  const { handle } = await load()
  for (const resend of [500, new Error('network')]) {
    const env = ENV(); const { f } = fakeFetch({ resend })
    const res = await handle(req(GOOD), env, { fetch: f })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).ok, true)
    assert.equal(inquiries(env).length, 1)
  }
})

test('without a Resend key the inquiry is only stored', async () => {
  const { handle } = await load()
  const env = ENV({ RESEND_API_KEY: undefined }); const { f, calls } = fakeFetch()
  const res = await handle(req(GOOD), env, { fetch: f })
  assert.equal((await res.json()).email, 'skipped')
  assert.equal(calls.filter((c) => c.url.includes('resend')).length, 0)
  assert.equal(inquiries(env).length, 1)
})

test('a failed Turnstile check stores nothing', async () => {
  const { handle } = await load()
  const env = ENV(); const { f } = fakeFetch({ turnstile: false })
  const res = await handle(req(GOOD), env, { fetch: f })
  assert.equal(res.status, 403)
  assert.equal(env.INQUIRIES.data.size, 0)
})

test('missing fields, oversize fields, the honeypot and bad JSON are refused before Turnstile', async () => {
  const { handle } = await load()
  const cases = [
    [{ ...GOOD, problem: ' ' }, 'missing'],
    [{ ...GOOD, background: 'x'.repeat(1501) }, 'too_long'],
    [{ ...GOOD, website: 'http://spam' }, 'bad_request'],
    ['{not json', 'bad_request']
  ]
  for (const [body, error] of cases) {
    const env = ENV(); const { f, calls } = fakeFetch()
    const res = await handle(req(body), env, { fetch: f })
    assert.equal(res.status, 400)
    assert.equal((await res.json()).error, error)
    assert.equal(calls.length, 0, 'no Turnstile or Resend call for a request that fails validation')
  }
})

test('more than five submissions an hour from one IP are refused', async () => {
  const { handle, PER_HOUR } = await load()
  const env = ENV(); const { f } = fakeFetch()
  const now = Date.parse('2026-10-17T03:00:00Z')
  for (let i = 0; i < PER_HOUR; i++) assert.equal((await handle(req(GOOD), env, { fetch: f, now })).status, 200)
  assert.equal((await handle(req(GOOD), env, { fetch: f, now })).status, 429)
  assert.equal((await handle(req(GOOD, { ip: '198.51.100.1' }), env, { fetch: f, now })).status, 200, 'other visitors are unaffected')
})

test('only POST is accepted', async () => {
  const { handle } = await load()
  const res = await handle(req(null, { method: 'GET' }), ENV(), { fetch: fakeFetch().f })
  assert.equal(res.status, 405)
})

test('the amefys.cn mirror may post cross-origin; other origins get no CORS grant', async () => {
  const { handle } = await load()
  const { f } = fakeFetch()
  const pre = await handle(req(null, { method: 'OPTIONS', origin: 'https://amefys.cn' }), ENV(), { fetch: f })
  assert.equal(pre.status, 204)
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://amefys.cn')
  assert.match(pre.headers.get('access-control-allow-methods'), /POST/)
  assert.match(pre.headers.get('access-control-allow-headers'), /content-type/)

  const env = ENV()
  const ok = await handle(req(GOOD, { origin: 'https://amefys.cn' }), env, { fetch: f })
  assert.equal(ok.status, 200)
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://amefys.cn')
  assert.equal(ok.headers.get('vary'), 'Origin')
  const refused = await handle(req({}, { origin: 'https://amefys.cn' }), env, { fetch: f })
  assert.equal(refused.headers.get('access-control-allow-origin'), 'https://amefys.cn', 'errors are readable too')

  const evil = await handle(req(null, { method: 'OPTIONS', origin: 'https://evil.example' }), ENV(), { fetch: f })
  assert.equal(evil.status, 405)
  assert.equal(evil.headers.get('access-control-allow-origin'), null)
  const same = await handle(req(GOOD), ENV(), { fetch: f })
  assert.equal(same.headers.get('access-control-allow-origin'), null, 'same-origin posts are unchanged')
})

test('the page posts to the Worker and keeps the email fallback', () => {
  const fs = require('node:fs'); const path = require('node:path')
  const html = fs.readFileSync(path.join(__dirname, '..', 'studio', 'index.html'), 'utf8')
  assert.match(html, /fetch\('\/api\/studio'/)
  assert.match(html, /name="website"/, 'honeypot field present')
  assert.match(html, /mailto:amefys@gmail\.com/, 'email address stays on the page as a fallback')
  for (const [k, max] of Object.entries({ name: 40, contact: 80, background: 1500, problem: 1500 })) {
    assert.match(html, new RegExp(`name="${k}"[^>]*maxlength="${max}"`), `${k} maxlength matches the Worker`)
  }
})
