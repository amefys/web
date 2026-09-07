/* Regression tests for assets/waline-turnstile-prewarm.js — run with
   `npm test` (plain `node --test`, no dependencies).

   What this locks down: Waline starts the whole Turnstile dance (load
   api.js → ready → render → wait for the token) only after the visitor
   presses submit, which cost tens of seconds from mainland China. The
   pre-warm script does that work while the visitor types and hands the
   cached token over on demand — without ever pre-defining
   window.turnstile (the b6ca2bd hang) and without breaking submits when
   the pre-warm itself fails. */

const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')

const MODULE_PATH = path.join(__dirname, '..', 'assets', 'waline-turnstile-prewarm.js')
const prewarm = require(MODULE_PATH)

const SITE_KEY = '0xTESTKEY'

/** Minimal DOM/window doubles: enough for script injection + a container. */
function makeEnv({ clock = { t: 1_000_000 } } = {}) {
  const appended = []
  const elements = {}
  const timeouts = []
  const intervals = []

  const makeEl = () => ({
    id: '',
    style: { cssText: '' },
    appendChild(child) { appended.push(child); return child },
  })

  const doc = {
    head: makeEl(),
    body: makeEl(),
    documentElement: makeEl(),
    createElement() { return makeEl() },
    getElementById(id) { return elements[id] || null },
  }

  const win = {
    AMEFYS_TURNSTILE_KEY: SITE_KEY,
    setTimeout(fn) { timeouts.push(fn); return timeouts.length },
    setInterval(fn) { intervals.push(fn); return intervals.length },
  }

  return {
    win,
    doc,
    appended,
    flushTimeouts: () => { while (timeouts.length) timeouts.shift()() },
    runInterval: () => intervals.forEach((fn) => fn()),
    clock,
    now: () => clock.t,
  }
}

/** A stand-in for the object challenges.cloudflare.com/api.js installs. */
function makeTurnstile({ solves = true } = {}) {
  const calls = { render: [], reset: [], ready: 0 }
  let nextId = 0
  let nextToken = 0
  const api = {
    // Cloudflare's real ready() refuses to run when api.js was loaded with
    // async/defer, which is exactly how the pre-warm loads it.
    ready() { calls.ready++; throw new Error('[Cloudflare Turnstile] Remove async/defer …') },
    render(container, params) {
      calls.render.push({ container, params })
      const id = `w${nextId++}`
      // Every challenge yields its own single-use token, as Cloudflare does.
      if (solves && params.callback) params.callback(`tok-${++nextToken}`)
      return id
    },
    reset(id) { calls.reset.push(id) },
  }
  return { api, calls }
}

function boot(env, turnstile, opts = {}) {
  const handle = prewarm.install(env.win, env.doc, { now: env.now, ...opts })
  env.win.turnstile = turnstile.api
  env.win.__amefysTurnstileReady()
  return handle
}

test('never pre-defines window.turnstile before api.js runs (b6ca2bd regression)', () => {
  const env = makeEnv()
  prewarm.install(env.win, env.doc, { now: env.now })
  assert.strictEqual('turnstile' in env.win, false)
})

test('injects api.js with an explicit onload callback', () => {
  const env = makeEnv()
  prewarm.install(env.win, env.doc, { now: env.now })
  const script = env.appended.find((el) => el.src)
  assert.ok(script, 'a script element must be appended')
  assert.match(script.src, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/)
  assert.match(script.src, /onload=__amefysTurnstileReady/)
  assert.match(script.src, /render=explicit/)
  assert.strictEqual(typeof env.win.__amefysTurnstileReady, 'function')
})

test('loads api.js synchronously so turnstile.ready() keeps working', () => {
  const env = makeEnv()
  prewarm.install(env.win, env.doc, { now: env.now })
  const script = env.appended.find((el) => el.src)
  // A dynamically created <script> is async by default; Cloudflare then kills
  // turnstile.ready() page-wide, and @waline/client calls ready() on submit —
  // every comment failed with an alert() until this was set to false.
  assert.strictEqual(script.async, false, 'api.js must not be async')
  assert.notStrictEqual(script.defer, true, 'api.js must not be defer')
})

test('a refused turnstile.ready() still runs the callback (no alert on submit)', () => {
  const env = makeEnv()
  const turnstile = makeTurnstile()
  boot(env, turnstile)

  let ran = false
  assert.doesNotThrow(() => env.win.turnstile.ready(() => { ran = true }))
  assert.strictEqual(ran, true, 'Waline must still get past ready() and submit')
  assert.strictEqual(turnstile.calls.ready, 1, 'the native ready() is tried first')
})

test('a working turnstile.ready() is left alone', () => {
  const env = makeEnv()
  const turnstile = makeTurnstile()
  turnstile.api.ready = function (fn) { turnstile.calls.ready++; fn() }
  boot(env, turnstile)

  let count = 0
  env.win.turnstile.ready(() => { count++ })
  assert.strictEqual(count, 1, 'the callback runs exactly once, not twice')
})

test('does nothing without a site key', () => {
  const env = makeEnv()
  delete env.win.AMEFYS_TURNSTILE_KEY
  assert.strictEqual(prewarm.install(env.win, env.doc, { now: env.now }), null)
  assert.strictEqual(env.appended.length, 0)
})

test('renders an off-screen widget as soon as Turnstile is ready', () => {
  const env = makeEnv()
  const turnstile = makeTurnstile()
  const handle = boot(env, turnstile)
  assert.strictEqual(
    turnstile.calls.ready,
    0,
    'turnstile.ready() throws for an async-loaded api.js — the ?onload= callback already means ready',
  )
  assert.strictEqual(turnstile.calls.render.length, 1)
  const { params, container } = turnstile.calls.render[0]
  assert.strictEqual(params.sitekey, SITE_KEY)
  assert.strictEqual(params.action, 'social', 'must match the action @waline/client uses')
  assert.match(container.style.cssText, /-9999px/, 'off-screen, not display:none')
  assert.ok(handle.isFresh(), 'the token from the pre-warm is cached')
})

test('hands the cached token to Waline instead of running a new challenge', () => {
  const env = makeEnv()
  const turnstile = makeTurnstile()
  boot(env, turnstile)
  const rendersBefore = turnstile.calls.render.length

  let handed = null
  const ret = env.win.turnstile.render('.wl-captcha-container', { callback: (t) => { handed = t } })

  assert.strictEqual(handed, null, 'the callback fires asynchronously, like a real challenge')
  env.flushTimeouts()
  assert.strictEqual(handed, 'tok-1')
  assert.strictEqual(ret, null, 'Waline ignores the return value')
  assert.strictEqual(
    turnstile.calls.render.length,
    rendersBefore,
    'no second widget is rendered for Waline',
  )
  assert.deepStrictEqual(turnstile.calls.reset, ['w0'], 'the pre-warm refreshes for the next submit')
})

test('a token is never handed out twice', () => {
  const env = makeEnv()
  // reset() does not re-solve in this double, so the cache stays empty after
  // the first hand-off — exactly the state a fast second submit would hit.
  const turnstile = makeTurnstile()
  boot(env, turnstile)

  const first = []
  env.win.turnstile.render('.wl-captcha-container', { callback: (t) => first.push(t) })
  env.flushTimeouts()

  const second = []
  env.win.turnstile.render('.wl-captcha-container', { callback: (t) => second.push(t) })
  env.flushTimeouts()

  assert.deepStrictEqual(first, ['tok-1'], 'the pre-warmed token is used once')
  assert.deepStrictEqual(second, ['tok-2'], 'the next submit gets a brand new token')
  assert.strictEqual(turnstile.calls.render.length, 2, 'because Waline renders its own widget')
  assert.strictEqual(turnstile.calls.render[1].container, '.wl-captcha-container')
})

test('an expired token is not reused', () => {
  const env = makeEnv()
  const turnstile = makeTurnstile()
  boot(env, turnstile)
  env.clock.t += prewarm.TOKEN_TTL + 1

  let handed = null
  env.win.turnstile.render('.wl-captcha-container', { callback: (t) => { handed = t } })
  env.flushTimeouts()

  assert.strictEqual(handed, 'tok-2', 'the stale token is dropped for a fresh one')
  assert.strictEqual(turnstile.calls.render.length, 2, 'but it comes from a fresh challenge')
  assert.strictEqual(turnstile.calls.render[1].container, '.wl-captcha-container')
})

test('other callers are never intercepted', () => {
  const env = makeEnv()
  const turnstile = makeTurnstile()
  boot(env, turnstile)

  const id = env.win.turnstile.render('#somewhere-else', { callback() {} })
  assert.strictEqual(turnstile.calls.render.length, 2)
  assert.strictEqual(id, 'w1', 'the native return value is preserved')
})

test('a failed pre-warm leaves Waline’s own flow untouched', () => {
  const env = makeEnv()
  const turnstile = makeTurnstile({ solves: false })
  boot(env, turnstile)

  let handed = null
  env.win.turnstile.render('.wl-captcha-container', { callback: (t) => { handed = t } })
  env.flushTimeouts()

  assert.strictEqual(handed, null)
  assert.strictEqual(turnstile.calls.render.length, 2, 'Waline renders its own widget')
})

test('the background timer re-arms a spent token', () => {
  const env = makeEnv()
  const turnstile = makeTurnstile()
  boot(env, turnstile)
  env.win.turnstile.render('.wl-captcha-container', { callback() {} })
  env.flushTimeouts()
  turnstile.calls.reset.length = 0

  env.runInterval()
  assert.deepStrictEqual(turnstile.calls.reset, ['w0'], 'a spent cache triggers another challenge')
})

/* The English page has been forgotten twice already (b6ca2bd, ee9c9c8). */
const fs = require('node:fs')

for (const page of ['guestbook.html', 'en/guestbook.html']) {
  test(`${page}: loads the pre-warm script and publishes the site key first`, () => {
    const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8')
    const keyAt = html.indexOf('window.AMEFYS_TURNSTILE_KEY =')
    const scriptAt = html.indexOf('waline-turnstile-prewarm.js')
    assert.ok(keyAt > -1, 'the site key must be published on window')
    assert.ok(scriptAt > -1, 'the pre-warm script must be loaded')
    assert.ok(keyAt < scriptAt, 'the key has to be defined before the script that reads it')
    assert.match(html, /const TURNSTILE_SITE_KEY = window\.AMEFYS_TURNSTILE_KEY/,
      'Waline and the pre-warm must share one site key')
  })

  test(`${page}: the guestbook scripts are cache-busted`, () => {
    const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8')
    // Cloudflare serves this site with `cache-control: max-age=14400`, so a
    // returning visitor keeps running the old file for four hours unless the
    // URL changes. Bump ?v= whenever either script is edited.
    assert.match(html, /waline-turnstile-prewarm\.js\?v=\d+/, 'the pre-warm script needs a ?v=')
    assert.match(html, /waline-captcha\.js\?v=\d+/, 'the captcha patch needs a ?v=')
  })
}
