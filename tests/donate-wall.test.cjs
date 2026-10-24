// Donor wall on the donate pages (assets/donor-wall.js, 2026-10-24). Whatever
// donors.json does — fail, return junk, list nobody — the page must look as it
// did before; and donor-typed text must never become markup.
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const ROOT = resolve(__dirname, '..')
const SCRIPT = readFileSync(resolve(ROOT, 'assets/donor-wall.js'), 'utf8')
const NOW = Date.parse('2026-10-24T08:00:00Z')

class Node {
  constructor(tag) {
    this.tagName = tag
    this.children = []
    this.attrs = {}
    this.style = {}
    this.hidden = false
    this.className = ''
    this._text = ''
    this.parentNode = null
  }
  set textContent(v) { this._text = String(v); this.children = [] }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join('') }
  set innerHTML(_) { throw new Error('innerHTML must not be used') }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c }
  replaceChild(n, old) { const i = this.children.indexOf(old); this.children[i] = n; n.parentNode = this }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return this.attrs[k] ?? null }
  closest(sel) {
    for (let n = this; n; n = n.parentNode) if (sel === '[data-wall-block]' && n.attrs['data-wall-block'] !== undefined) return n
    return null
  }
  all() { return [this, ...this.children.flatMap((c) => c.all())] }
}

function page(lang = 'zh') {
  const byId = {}
  const mk = (id, parent, block) => {
    const n = new Node('div')
    if (block) n.attrs['data-wall-block'] = ''
    if (parent) parent.appendChild(n)
    byId[id] = n
    return n
  }
  const section = mk('wall')
  section.hidden = true
  mk('wall-total', section)
  mk('wall-new', mk('tier-new', section, true))
  mk('wall-old', mk('tier-old', section, true))
  byId['wall-posts'] = mk('wall-posts', section, true)
  const html = new Node('html')
  html.attrs.lang = lang
  return {
    byId,
    document: {
      documentElement: html,
      getElementById: (id) => byId[id] || null,
      createElement: (t) => new Node(t)
    }
  }
}

async function run(reply, lang) {
  const { byId, document } = page(lang)
  const RealDate = Date
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [NOW])) }
    static now() { return NOW }
  }
  const fetch = async () => {
    if (reply instanceof Error) throw reply
    if (reply === 404) return { ok: false, json: async () => ({}) }
    return { ok: true, json: async () => (typeof reply === 'function' ? reply() : reply) }
  }
  vm.runInNewContext(SCRIPT, { document, fetch, Date: FakeDate, location: { hash: '' }, setTimeout, clearTimeout, AbortController, Array, Number, String, Math })
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r))
  return byId
}

const WALL = {
  total: 4,
  donors: [
    { name: null, avatar: null, since: '2026-10', via: 'afdian' },
    { name: '晚风', avatar: 'https://pic1.afdiancdn.com/user/a/avatar.jpg', since: '2026-10', via: 'afdian' },
    { name: '柠*', avatar: null, since: '2026-09', via: 'wechat' },
    { name: '<img src=x onerror=alert(1)>', avatar: 'https://evil.example/x.png', since: '2026-08', via: 'afdian' }
  ],
  posts: [
    { name: null, avatar: null, via: 'afdian', at: '2026-10-24', msg: '加油' },
    { name: '柠*', avatar: null, via: 'wechat', at: '2026-10-23', msg: '<script>alert(1)</script>' },
    { name: 'x', avatar: null, via: 'afdian', at: '2026-10-01', msg: '' }
  ]
}

test('renders tiles, notes and the count, and only then shows the section', async () => {
  const ids = await run(WALL)
  assert.equal(ids.wall.hidden, false)
  assert.equal(ids['wall-total'].textContent, '4')
  assert.equal(ids['wall-new'].children.length, 2)
  assert.equal(ids['wall-old'].children.length, 2)
  assert.equal(ids['wall-new'].children[0].textContent, '☕匿名朋友')
  assert.equal(ids['wall-new'].children[1].attrs['data-tip'], '2026 年 10 月起 · 爱发电')
  const posts = ids['wall-posts'].children
  assert.equal(posts.length, 2, 'empty notes are skipped')
  assert.match(posts[0].textContent, /匿名朋友今天爱发电加油/)
  assert.match(posts[1].textContent, /昨天微信/)
})

test('donor-typed text stays text; avatars outside afdian CDN are not loaded', async () => {
  const ids = await run(WALL)
  const nodes = ids.wall.all()
  const imgs = nodes.filter((n) => n.tagName === 'img')
  assert.deepEqual(imgs.map((i) => i.src), ['https://pic1.afdiancdn.com/user/a/avatar.jpg'])
  assert.equal(imgs[0].referrerPolicy, 'no-referrer')
  assert.ok(nodes.some((n) => n._text.startsWith('<img src=x onerror=')), 'name rendered as plain text (and cut to 20)')
  assert.ok(nodes.some((n) => n._text === '<script>alert(1)</script>'), 'note rendered as plain text')
})

for (const [label, reply] of [['network error', new Error('offline')], ['HTTP 404', 404], ['junk', 'oops'], ['null', null], ['nobody yet', { total: 0, donors: [], posts: [] }], ['bad shape', { donors: 'x' }]]) {
  test(`stays hidden on ${label}`, async () => {
    const ids = await run(reply)
    assert.equal(ids.wall.hidden, true)
  })
}

test('an empty tier or an empty notes list is hidden, not shown as a bare heading', async () => {
  const ids = await run({ total: 1, donors: [{ name: 'Kael', avatar: null, since: '2026-06', via: 'afdian' }], posts: [] })
  assert.equal(ids.wall.hidden, false)
  assert.equal(ids['tier-new'].hidden, true)
  assert.equal(ids['tier-old'].hidden, false)
  assert.equal(ids['wall-posts'].hidden, true)
})

test('English page uses English labels', async () => {
  const ids = await run(WALL, 'en')
  assert.equal(ids['wall-new'].children[0].textContent, '☕Anonymous')
  assert.equal(ids['wall-new'].children[1].attrs['data-tip'], 'Since Oct 2026 · Afdian')
  assert.match(ids['wall-posts'].children[1].textContent, /yesterdayWeChat/)
})

test('both donate pages carry the wall and load the shared script and styles', () => {
  for (const f of ['donate.html', 'en/donate.html']) {
    const html = readFileSync(resolve(ROOT, f), 'utf8')
    assert.match(html, /<section class="s" id="wall" hidden>/, f)
    for (const id of ['wall-total', 'wall-new', 'wall-old', 'wall-posts']) assert.ok(html.includes(`id="${id}"`), `${f} #${id}`)
    assert.ok(html.includes('/assets/donor-wall.js'), f)
    assert.ok(html.includes('/assets/donor-wall.css'), f)
  }
})

// 2026-10-24: features may not all stay free, so the donate pages describe what
// a donation is, not what the product will always be.
test('donate pages make no "always free" promise', () => {
  const banned = /一直免费|永远免费|永久免费|一直<em>免费|功能一个都不会少|不设付费墙|stays <em>free|every single feature|no paywall/
  for (const f of ['donate.html', 'en/donate.html']) {
    const m = readFileSync(resolve(ROOT, f), 'utf8').match(banned)
    assert.equal(m, null, `${f}: ${m && m[0]}`)
  }
})
