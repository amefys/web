/* Regression tests for assets/waline-session.js — run with `npm test`.

   The bug being locked down (2026-10-17, first test comment under a blog
   post): the maintainer had logged in to the guestbook with #admin on
   2026-09-07. The server's JWT lives 30 days, so by mid-October the token
   in localStorage.WALINE_USER was dead — but @waline/client only checks that
   a token *exists*. It hid the nick / mail inputs, posted with the stored
   account's email and the dead token, the server saw an anonymous comment
   using a registered email and refused it ("该邮箱已注册，请先登录再留言").
   With login: 'disable' the avatar / logout button is hidden as well, so
   the visitor could neither see nor leave that stale session. */

const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')

const { loginMode, readUser, tokenExpired } = require(path.join(__dirname, '..', 'assets', 'waline-session.js'))

const NOW = 1_792_200_000 // seconds

function jwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`
}

function storage(init = {}) {
  const data = { ...init }
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    data,
  }
}

function win({ local = {}, session = {}, hash = '' } = {}) {
  return { localStorage: storage(local), sessionStorage: storage(session), location: { hash } }
}

const user = (token) => JSON.stringify({ display_name: 'AMEFYS', email: 'owner@example.com', token })

test('an expired stored session is cleared, so the nick / mail inputs come back', () => {
  const w = win({ local: { WALINE_USER: user(jwt({ id: 1, exp: NOW - 60 })) } })
  assert.strictEqual(loginMode(w, NOW), 'disable')
  assert.strictEqual(w.localStorage.data.WALINE_USER, 'null', 'same value @waline/client writes on logout')
})

test('an expired session in sessionStorage is cleared too', () => {
  const w = win({ session: { WALINE_USER: user(jwt({ id: 1, exp: NOW - 1 })) } })
  assert.strictEqual(loginMode(w, NOW), 'disable')
  assert.strictEqual(w.sessionStorage.data.WALINE_USER, 'null')
})

test('a live session turns login on, so the visitor sees who they are posting as and can log out', () => {
  const w = win({ local: { WALINE_USER: user(jwt({ id: 1, exp: NOW + 3600 })) } })
  assert.strictEqual(loginMode(w, NOW), 'enable')
  assert.notStrictEqual(w.localStorage.data.WALINE_USER, 'null')
})

test('a token that cannot be decoded is treated as dead', () => {
  const w = win({ local: { WALINE_USER: user('not-a-jwt') } })
  assert.strictEqual(loginMode(w, NOW), 'disable')
  assert.strictEqual(w.localStorage.data.WALINE_USER, 'null')
})

test('no stored user: login stays off for visitors (registration is closed)', () => {
  assert.strictEqual(loginMode(win(), NOW), 'disable')
  assert.strictEqual(loginMode(win({ local: { WALINE_USER: 'null' } }), NOW), 'disable')
  assert.strictEqual(loginMode(win({ local: { WALINE_USER: '{}' } }), NOW), 'disable')
})

test('#admin still opens the login button for the maintainer', () => {
  assert.strictEqual(loginMode(win({ hash: '#admin' }), NOW), 'enable')
})

test('storage that throws (private mode) never breaks the page', () => {
  const bad = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.strictEqual(loginMode({ localStorage: bad, sessionStorage: bad, location: { hash: '' } }, NOW), 'disable')
})

test('helpers', () => {
  assert.strictEqual(tokenExpired(jwt({ id: 1 }), NOW), false, 'no exp claim: let the server decide')
  assert.strictEqual(readUser(storage({ WALINE_USER: '{bad json' })), null)
})

test('both comment surfaces run the check before Waline starts', () => {
  const fs = require('node:fs')
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
  assert.match(read('assets/blog-comments.js'), /AmefysWalineSession\.mode/)
  for (const page of ['guestbook.html', 'en/guestbook.html']) {
    const html = read(page)
    assert.match(html, /waline-session\.js/, `${page} loads the session check`)
    assert.match(html, /login: window\.AmefysWalineSession\.mode/, `${page} takes its login mode from it`)
    const session = html.indexOf('waline-session.js')
    const client = html.indexOf('vendor/waline/waline.js')
    assert.ok(session > 0 && session < client, `${page}: the session check loads before the Waline module`)
  }
})

test('in a browser it clears the stale session at load time, before Waline can read it', () => {
  const vm = require('node:vm')
  const fs = require('node:fs')
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'waline-session.js'), 'utf8')
  const w = win({ local: { WALINE_USER: user(jwt({ id: 1, exp: 1 })) } })
  w.atob = (s) => Buffer.from(s, 'base64').toString('binary')
  vm.runInNewContext(src, { window: w, atob: w.atob })
  assert.strictEqual(w.localStorage.data.WALINE_USER, 'null', 'cleared by merely loading the script')
  assert.strictEqual(w.AmefysWalineSession.mode, 'disable')
})

test('blog comments: the session script is awaited before the Waline module is imported', () => {
  const js = require('node:fs').readFileSync(path.join(__dirname, '..', 'assets', 'blog-comments.js'), 'utf8')
  const session = js.indexOf("addScript('/assets/waline-session.js")
  const imp = js.indexOf("import('/assets/vendor/waline/waline.js')")
  assert.ok(session > 0 && imp > session)
})
