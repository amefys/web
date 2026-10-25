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
const HEROES_SRC = readFileSync(resolve(ROOT, 'assets/donor-heroes.js'), 'utf8')
const loadHeroes = () => { const w = {}; vm.runInNewContext(HEROES_SRC, { window: w }); return JSON.parse(JSON.stringify(w.AMEFYS_DONOR_HEROES)) }
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
  const more = new Node('button')
  more.hidden = true
  byId['wall-more'] = more
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

async function run(reply, lang, heroes = null, narrow = false) {
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
  vm.runInNewContext(SCRIPT, { window: { AMEFYS_DONOR_HEROES: heroes, matchMedia: (q) => ({ matches: narrow && q === '(max-width: 520px)' }) }, document, fetch, Date: FakeDate, location: { hash: '' }, setTimeout, clearTimeout, AbortController, Array, Number, String, Math })
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r))
  return byId
}

const WALL = {
  total: 4,
  donors: [
    { name: null, avatar: null, since: '2026-10', via: 'afdian', notes: [{ at: '2026-10-24', msg: '加油' }] },
    { name: '晚风', avatar: 'https://pic1.afdiancdn.com/user/a/avatar.jpg', since: '2026-10', via: 'afdian', notes: [] },
    { name: '柠*', avatar: null, since: '2026-09', via: 'wechat', notes: [{ at: '2026-10-23', msg: '<script>alert(1)</script>' }, { at: '2026-09-02', msg: '' }] },
    { name: '<img src=x onerror=alert(1)>', avatar: 'https://evil.example/x.png', since: '2026-08', via: 'afdian' }
  ]
}

const notesOf = (card) => card.all().filter((n) => n.className === 'donor-note')

test('one card per donor with avatar, name, join line and their own notes; count shown last', async () => {
  const ids = await run(WALL)
  assert.equal(ids.wall.hidden, false)
  assert.equal(ids['wall-total'].textContent, '4')
  assert.equal(ids['wall-new'].children.length, 2)
  assert.equal(ids['wall-old'].children.length, 2)
  const [anon, wanfeng] = ids['wall-new'].children
  assert.equal(anon.className, 'donor is-anon')
  assert.equal(anon.textContent, '☕匿名朋友10 月加入 · 爱发电加油今天')
  assert.equal(notesOf(wanfeng).length, 0, 'a donor without notes is just the card head')
  assert.match(wanfeng.textContent, /^晚风10 月加入 · 爱发电$/)
  const lemon = ids['wall-old'].children[0]
  assert.equal(notesOf(lemon).length, 1, 'empty notes are skipped')
  assert.match(lemon.textContent, /微信<script>alert\(1\)<\/script>昨天$/)
  assert.equal(notesOf(ids['wall-old'].children[1]).length, 0, 'a schema-1 file (no notes field) still renders')
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

test('a card shows at most three notes, each cut to 60 characters', async () => {
  const long = '好'.repeat(80)
  const notes = [1, 2, 3, 4].map((i) => ({ at: '2026-10-2' + i, msg: i === 1 ? long : 'n' + i }))
  const ids = await run({ total: 1, donors: [{ name: 'Kael', avatar: null, since: '2026-10', via: 'afdian', notes }] })
  const shown = notesOf(ids['wall-new'].children[0])
  assert.equal(shown.length, 3)
  assert.equal(shown[0].children[0].textContent, '好'.repeat(60))
})

for (const [label, reply] of [['network error', new Error('offline')], ['HTTP 404', 404], ['junk', 'oops'], ['null', null], ['nobody yet', { total: 0, donors: [] }], ['bad shape', { donors: 'x' }]]) {
  test(`stays hidden on ${label}`, async () => {
    const ids = await run(reply)
    assert.equal(ids.wall.hidden, true)
  })
}

test('an empty tier is hidden, not shown as a bare heading', async () => {
  const ids = await run({ total: 1, donors: [{ name: 'Kael', avatar: null, since: '2026-06', via: 'afdian', notes: [] }] })
  assert.equal(ids.wall.hidden, false)
  assert.equal(ids['tier-new'].hidden, true)
  assert.equal(ids['tier-old'].hidden, false)
})

test('English page uses English labels', async () => {
  const ids = await run(WALL, 'en')
  assert.equal(ids['wall-new'].children[0].textContent, '☕AnonymousJoined Oct · Afdian加油today')
  assert.match(ids['wall-old'].children[0].textContent, /Joined Sep · WeChat.*yesterday$/)
})

test('both donate pages carry the wall and load the shared script and styles', () => {
  for (const f of ['donate.html', 'en/donate.html']) {
    const html = readFileSync(resolve(ROOT, f), 'utf8')
    assert.match(html, /<section class="s" id="wall" hidden>/, f)
    for (const id of ['wall-total', 'wall-new', 'wall-old']) assert.ok(html.includes(`id="${id}"`), `${f} #${id}`)
    assert.ok(!html.includes('wall-posts'), `${f}: notes live on each card now, not in a separate list`)
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

test('a custom avatar shows even when the name is anonymous; a broken one falls back to the cup', async () => {
  const ids = await run({ total: 1, donors: [{ name: null, avatar: 'https://pic1.afdiancdn.com/user/b/avatar.jpg', since: '2026-10', via: 'afdian', notes: [] }] })
  const head = ids['wall-new'].children[0].children[0]
  const img = head.all().find((n) => n.tagName === 'img')
  assert.equal(img.src, 'https://pic1.afdiancdn.com/user/b/avatar.jpg')
  assert.match(head.textContent, /^匿名朋友/)
  img.onerror()
  assert.equal(head.children[0].textContent, '☕')
})

// 2026-10-25: each card is thanked by a hero, in that hero's own chat wheel line.
const H = [
  { id: 'axe', name: { zh: '斧王', en: 'Axe' }, line: { zh: '斧王非常喜欢这个。', en: 'Axe likes this very much.' } },
  { id: 'pudge', name: { zh: '帕吉', en: 'Pudge' }, line: { zh: '多亏了你。', en: "That's a bit of all right." } },
  { id: 'sven', name: { zh: '斯温', en: 'Sven' }, line: { zh: '你是我真正的伙伴。', en: 'You are a true friend.' } }
]
const donor = (name, seed) => ({ name, avatar: null, since: '2026-09', via: 'afdian', seed, notes: [] })
const heroOf = (card) => card.all().find((n) => n.className === 'donor-hero').children[1].textContent

test('each card shows its hero art and the hero thank-you line, in the page language', async () => {
  const ids = await run({ total: 1, donors: [donor('Kael', 0)] }, 'zh', H)
  const card = ids['wall-old'].children[0]
  assert.equal(card.children[0].className, 'donor-art')
  assert.equal(card.children[0].children[0].src, 'https://cdn.amefys.com/hero-art/v2/portraits/axe.webp')
  assert.match(card.textContent, /斧王斧王非常喜欢这个。$/)
  const en = await run({ total: 1, donors: [donor('Kael', 0)] }, 'en', H)
  assert.match(en['wall-old'].children[0].textContent, /AxeAxe likes this very much\.$/)
})

test('heroes go to the oldest donors first: a new donor never takes someone else\'s hero', async () => {
  const before = await run({ total: 2, donors: [donor('B', 0), donor('A', 0)] }, 'zh', H)
  assert.deepEqual(before['wall-old'].children.map(heroOf), ['帕吉', '斧王'], 'same seed → next free hero')
  const after = await run({ total: 3, donors: [donor('C', 0), donor('B', 0), donor('A', 0)] }, 'zh', H)
  assert.deepEqual(after['wall-old'].children.map(heroOf), ['斯温', '帕吉', '斧王'])
})

test('more donors than heroes: heroes repeat instead of breaking', async () => {
  const ids = await run({ total: 4, donors: [donor('D', 0), donor('C', 0), donor('B', 0), donor('A', 0)] }, 'zh', H)
  assert.deepEqual(ids['wall-old'].children.map(heroOf), ['斧王', '斯温', '帕吉', '斧王'])
})

test('no hero list (script failed to load) → plain cards, wall still shows', async () => {
  const ids = await run({ total: 1, donors: [donor('Kael', 5)] }, 'zh', null)
  assert.equal(ids.wall.hidden, false)
  const card = ids['wall-old'].children[0]
  assert.equal(card.all().some((n) => n.className === 'donor-art' || n.className === 'donor-hero'), false)
})

test('a broken hero picture leaves an empty banner, not a broken image', async () => {
  const ids = await run({ total: 1, donors: [donor('Kael', 0)] }, 'zh', H)
  const art = ids['wall-old'].children[0].children[0]
  art.children[0].onerror()
  assert.equal(art.className, 'donor-art is-empty')
})

test('generated hero list: official names and chat wheel lines in both languages, no duplicates', () => {
  const heroes = loadHeroes()
  assert.ok(heroes.length >= 20, `only ${heroes.length} heroes`)
  assert.equal(new Set(heroes.map((h) => h.id)).size, heroes.length)
  for (const h of heroes) {
    assert.match(h.id, /^[a-z_]+$/)
    for (const k of ['zh', 'en']) {
      assert.ok(typeof h.name[k] === 'string' && h.name[k], `${h.id} name.${k}`)
      assert.ok(typeof h.line[k] === 'string' && h.line[k], `${h.id} line.${k}`)
    }
  }
  assert.match(HEROES_SRC, /^\/\/ Generated by scripts\/donor-heroes\.mjs/, 'lines come from the game files, never typed by hand')
  const axe = heroes.find((h) => h.id === 'axe')
  assert.deepEqual(axe && axe.line, { zh: '斧王非常喜欢这个。', en: 'Axe likes this very much.' })
})

test('both donate pages load the hero list before the wall script and credit Valve', () => {
  for (const f of ['donate.html', 'en/donate.html']) {
    const html = readFileSync(resolve(ROOT, f), 'utf8')
    const a = html.indexOf('/assets/donor-heroes.js')
    const b = html.indexOf('/assets/donor-wall.js')
    assert.ok(a > 0 && a < b, `${f}: donor-heroes.js must come first`)
    assert.match(html, /© Valve/, f)
  }
})

const crowd = (n, since = () => '2026-10') => ({ total: n, donors: Array.from({ length: n }, (_, i) => ({ name: 'D' + i, avatar: null, since: since(i), via: 'afdian', seed: i, notes: [] })) })
const shownCards = (ids) => ['wall-new', 'wall-old'].flatMap((id) => ids[id].children).filter((c) => !c.hidden)

test('a long wall folds after two rows; the button shows the rest', async () => {
  const ids = await run(crowd(30))
  assert.equal(shownCards(ids).length, 8)
  assert.equal(ids['wall-more'].hidden, false)
  assert.equal(ids['wall-more'].textContent, '展开其余 22 位朋友')
  ids['wall-more'].onclick()
  assert.equal(shownCards(ids).length, 30)
  assert.equal(ids['wall-more'].hidden, true)
})

test('phones fold sooner', async () => {
  const ids = await run(crowd(30), 'zh', null, true)
  assert.equal(shownCards(ids).length, 6)
  assert.equal(ids['wall-more'].textContent, '展开其余 24 位朋友')
})

test('no fold for a wall that is only a card or two past the limit', async () => {
  const ids = await run(crowd(10))
  assert.equal(shownCards(ids).length, 10)
  assert.equal(ids['wall-more'].hidden, true)
})

test('a tier folded away entirely hides its heading until the button is pressed', async () => {
  const ids = await run(crowd(20, (i) => (i < 12 ? '2026-10' : '2026-08')))
  assert.equal(ids['tier-old'].hidden, true)
  assert.equal(ids['wall-more'].textContent, '展开其余 12 位朋友')
  ids['wall-more'].onclick()
  assert.equal(ids['tier-old'].hidden, false)
})

test('English fold button', async () => {
  const ids = await run(crowd(30), 'en')
  assert.equal(ids['wall-more'].textContent, 'Show 22 more')
})

test('both donate pages carry the fold button, and folded cards really disappear', () => {
  for (const f of ['donate.html', 'en/donate.html']) {
    assert.match(readFileSync(resolve(ROOT, f), 'utf8'), /<button type="button" class="wall-more" id="wall-more" hidden><\/button>/)
  }
  // .donor sets display:flex, which would beat the plain [hidden] attribute.
  assert.match(readFileSync(resolve(ROOT, 'assets/donor-wall.css'), 'utf8'), /#wall \[hidden\] \{ display: none !important; \}/)
})

test('the join line drops this year, keeps an earlier one', async () => {
  const one = (since) => ({ total: 1, donors: [{ name: 'K', avatar: null, since, via: 'wechat', notes: [] }] })
  assert.match((await run(one('2025-12')))['wall-old'].children[0].textContent, /2025 年 12 月加入 · 微信$/)
  assert.match((await run(one('2025-12'), 'en'))['wall-old'].children[0].textContent, /Joined Dec 2025 · WeChat$/)
})
