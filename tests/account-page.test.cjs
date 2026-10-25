/* Guards for account.html — run with `npm test`.

   The page holds a live login session on amefys.com, so:
     * no inline script and a CSP that only allows our own scripts — any
       injected script on this page could read the session;
     * account.js never writes HTML (textContent only);
     * it must share the account and session with the phone BP page — same
       API route, publishable key and storageKey as the built /bp bundle. If
       /bp changes one of them, this test fails instead of the two pages
       silently drifting apart (a second login, or a different project). */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const html = fs.readFileSync(path.join(root, 'account.html'), 'utf8')
const js = fs.readFileSync(path.join(root, 'assets', 'account.js'), 'utf8')
const bpDir = path.join(root, 'bp', 'assets')
const bpBundle = fs.readdirSync(bpDir).filter((f) => /^index-.*\.js$/.test(f))
  .map((f) => fs.readFileSync(path.join(bpDir, f), 'utf8')).join('\n')

const constant = (name) => {
  const m = js.match(new RegExp(name + " = '([^']+)'"))
  assert.ok(m, name + ' not found in account.js')
  return m[1]
}

test('CSP allows only our own scripts and the API route', () => {
  const m = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)
  assert.ok(m, 'CSP meta missing')
  assert.match(m[1], /script-src 'self';/)
  assert.match(m[1], /connect-src 'self' https:\/\/api\.amefys\.com;/)
  assert.doesNotMatch(m[1], /script-src[^;]*unsafe/)
})

test('no inline scripts on the page', () => {
  const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || []
  assert.deepStrictEqual(inline, [])
  assert.doesNotMatch(html, /\son[a-z]+="/, 'inline event handler')
})

test('account.js never writes HTML', () => {
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/)
})

test('same API route, key and session storage as the phone BP page', () => {
  assert.ok(bpBundle.length > 0, 'built /bp bundle not found')
  const url = constant('SUPABASE_URL')
  assert.strictEqual(url, 'https://api.amefys.com')
  for (const name of ['SUPABASE_URL', 'PUBLISHABLE_KEY', 'STORAGE_KEY']) {
    assert.ok(bpBundle.includes(constant(name)), name + ' differs from /bp')
  }
  assert.doesNotMatch(js + html, /https?:\/\/[^'" ]*supabase\.co\b/)
})

test('auth e-mails come back to a page on the redirect allow-list', () => {
  assert.strictEqual(constant('AUTH_REDIRECT'), 'https://amefys.com/bp/')
})

test('vendored supabase-js is pinned and present', () => {
  const m = html.match(/src="(assets\/vendor\/supabase\/supabase-js-\d+\.\d+\.\d+\.js)"/)
  assert.ok(m, 'pinned supabase-js script tag missing')
  assert.ok(fs.existsSync(path.join(root, m[1])), m[1] + ' missing')
})

test('every element account.js looks up exists on the page', () => {
  const ids = new Set([...js.matchAll(/\$\('([a-z-]+)'\)|show\('([a-z-]+)'|text\('([a-z-]+)'/g)]
    .map((m) => m[1] || m[2] || m[3]))
  for (const id of ids) assert.match(html, new RegExp('id="' + id + '"'), '#' + id + ' missing')
})

test('page is kept out of search results', () => {
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/)
})

test('signing out here leaves the desktop app and other devices signed in', () => {
  const calls = js.match(/auth\.signOut\([^)]*\)/g) || []
  assert.ok(calls.length > 0, 'signOut call not found')
  for (const c of calls) assert.match(c, /scope: 'local'/, c)
})

// amefys.cn's copy of this page talks to the cn backend from P2 on (amefys repo,
// scripts/cn/mirror-site.ts pointAccountAtCn), whose purchase codes start AMC-; a moved
// account keeps its AMF- one. The page must show either, not report a bad code.
test('account.js shows purchase codes of both editions', () => {
  const m = /\/\^(AM[^/]*)\$\/\.test\(r\.data\)/.exec(js)
  assert.ok(m, 'purchase-code check not found')
  const re = new RegExp(`^${m[1]}$`)
  assert.ok(re.test('AMF-7K3Q9X') && re.test('AMC-7K3Q9X'))
  assert.ok(!re.test('AMX-7K3Q9X'))
})
