// Homepage live numbers (index.html inline script, 2026-10-15). Whatever
// cdn.amefys.com/stats.json does — fail, time out, return junk — the page must
// look exactly as it would without the script: live blocks hidden, the BP copy
// untouched, no "NaN" / "undefined" anywhere.
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const HTML = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8')
const SCRIPT = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('stats.json'))
const NOW = Date.parse('2026-10-15T06:00:00Z')

// Just enough DOM for the script: every tag carrying data-stat / data-part /
// data-stat-text / data-live, with its class, hidden flag and text.
function fakeDom() {
  const els = []
  for (const m of HTML.matchAll(/<(\w+)((?:\s[^>]*)?\s(?:data-stat|data-part|data-stat-text|data-live)\b[^>]*)>([^<]*)/g)) {
    const attrs = m[2]
    const attr = (n) => (attrs.match(new RegExp('\\s' + n + '="([^"]*)"')) || [])[1]
    els.push({
      cls: (attr('class') || '').split(/\s+/),
      stat: attr('data-stat'), part: attr('data-part'), statText: attr('data-stat-text'),
      hidden: /\shidden\b/.test(attrs), textContent: m[3], removed: false,
      remove() { this.removed = true }
    })
  }
  const live = () => els.filter((e) => !e.removed)
  const match = (sel) => {
    let m
    if ((m = sel.match(/^\[data-(stat|part|stat-text)="([^"]+)"\]$/))) {
      const key = { stat: 'stat', part: 'part', 'stat-text': 'statText' }[m[1]]
      return live().filter((e) => e[key] === m[2])
    }
    if ((m = sel.match(/^\.([\w-]+)$/))) return live().filter((e) => e.cls.includes(m[1]))
    throw new Error('unsupported selector ' + sel)
  }
  return { els, document: { querySelectorAll: match, querySelector: (s) => match(s)[0] || null } }
}

async function run(fetchImpl) {
  const { els, document } = fakeDom()
  const errors = []
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [NOW])) } static now() { return NOW } }
  const ctx = vm.createContext({
    document, fetch: fetchImpl, Date: FakeDate, Math, String, Promise,
    window: {}, setTimeout: () => 0, console: { error: (e) => errors.push(e) }
  })
  vm.runInContext(SCRIPT, ctx)
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
  return { els, errors, by: (cls) => els.find((e) => e.cls.includes(cls)) }
}

const json = (body, status = 200) => async () => ({ ok: status < 400, json: async () => body })
const GOOD = {
  schema: 1, users: 1766, downloads: 3001,
  releases: { count: 103, first: '2026-05-17', last: '2026-10-14' },
  bp: { matches: 5956315, ranked: 3683479, turbo: 2272836, builtAt: '2026-10-14T09:12:38Z' }
}

function assertUntouched(page) {
  for (const cls of ['stats-proof', 'bp-stat', 'final-proof']) assert.equal(page.by(cls).hidden, true, cls + ' must stay hidden')
  assert.equal(page.els.find((e) => e.statText === 'ranked').textContent, '几百万局')
}
function assertNoJunk(page) {
  for (const e of page.els) if (!e.removed) assert.doesNotMatch(String(e.textContent), /NaN|undefined|null|Invalid/, JSON.stringify(e))
}

test('the script exists and the markup starts hidden', () => {
  assert.ok(SCRIPT)
  const { els } = fakeDom()
  for (const cls of ['stats-proof', 'bp-stat', 'final-proof']) assert.equal(els.find((e) => e.cls.includes(cls)).hidden, true, cls)
  assert.match(HTML, /\[data-live\]\[hidden\]\s*\{\s*display:\s*none\s*!important/)
})

for (const [name, f] of [
  ['network error', async () => { throw new TypeError('Failed to fetch') }],
  ['HTTP 500', json(null, 500)],
  ['invalid JSON', async () => ({ ok: true, json: async () => { throw new SyntaxError('bad') } })],
  ['unknown schema', json({ ...GOOD, schema: 2 })],
  ['JSON that is not an object', json('oops')],
  ['empty object', json({ schema: 1 })]
]) {
  test(`${name}: the page stays exactly as it was`, async () => {
    const page = await run(f)
    assertUntouched(page)
    assertNoJunk(page)
  })
}

test('good data fills all three blocks', async () => {
  const page = await run(json(GOOD))
  assert.equal(page.by('stats-proof').hidden, false)
  assert.equal(page.by('final-proof').hidden, false)
  assert.equal(page.by('bp-stat').hidden, false)
  assert.equal(page.els.find((e) => e.stat === 'users').textContent, '1,700+')
  assert.equal(page.els.find((e) => e.statText === 'ranked').textContent, ' 368 万局')
  assertNoJunk(page)
})

test('bp with missing or tiny parts keeps the BP copy and hides the badge — no "NaN 万局"', async () => {
  for (const bp of [
    { matches: 5956315 },
    { matches: 5956315, ranked: 3683479, turbo: 2272836, builtAt: 'garbage' },
    { matches: 5956315, ranked: 3000, turbo: 2272836, builtAt: '2026-10-14T09:12:38Z' },
    { matches: '5956315', ranked: '3683479', turbo: '2272836', builtAt: '2026-10-14T09:12:38Z' }
  ]) {
    const page = await run(json({ ...GOOD, bp }))
    assert.equal(page.by('bp-stat').hidden, true, JSON.stringify(bp))
    assert.equal(page.els.find((e) => e.statText === 'ranked').textContent, '几百万局', JSON.stringify(bp))
    assert.equal(page.by('stats-proof').hidden, false, 'other numbers still show')
    assertNoJunk(page)
  }
})

test('releases with bad dates drop that part instead of printing NaN', async () => {
  const page = await run(json({ ...GOOD, releases: { count: 103, first: 'x', last: 'y' } }))
  assert.equal(page.by('stats-proof').hidden, false)
  assert.ok(page.els.filter((e) => e.part === 'releases' || e.part === 'updated').every((e) => e.removed))
  assertNoJunk(page)
})

test('non-numeric users / downloads are dropped, not printed', async () => {
  const page = await run(json({ ...GOOD, users: 'lots', downloads: -5 }))
  assert.ok(page.els.filter((e) => e.part === 'users' || e.part === 'downloads').every((e) => e.removed))
  assert.equal(page.by('final-proof').hidden, true)
  assertNoJunk(page)
})

test('when the first part is dropped, its leading separator dot is hidden by CSS', () => {
  assert.match(HTML, /\.stats-proof\s*>\s*\.sep:first-child\s*\{\s*display:\s*none/)
})
