// SEO pages must be findable by Chinese searches (2026-10-04 audit): the Axe
// page said "Axe" everywhere and never 斧王, so 「斧王出装」 could not match it.
const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const DATA = resolve(__dirname, '../_generator/data')
const heroes = JSON.parse(readFileSync(resolve(DATA, 'heroes.json'), 'utf8'))
const items = JSON.parse(readFileSync(resolve(DATA, 'items.json'), 'utf8'))
const load = () => import('../_generator/build.mjs')
const extract = () => import('../_generator/extract-names.mjs')

const hero = (n) => heroes.find((h) => h.internalName === n)
const item = (n) => items.find((i) => i.internalName === n)
const title = (html) => html.match(/<title>(.*?)<\/title>/)[1]
const h1 = (html) => html.match(/<h1>(.*?)<\/h1>/)[1]

test('hero pages lead with the official Chinese name and carry the nickname', async () => {
  const { renderHeroPage } = await load()
  const html = renderHeroPage(hero('npc_dota_hero_axe'), new Set(['blink']))
  assert.match(title(html), /^斧王出装与克制（Axe）/)
  assert.equal(h1(html), '斧王出装与克制')
  assert.match(html, /也叫斧子/)
  assert.match(html, /先手/)
  assert.doesNotMatch(html, /Initiator/)
  // Item names in the build tables are Chinese too.
  assert.match(html, /<a href="\/items\/blink.html">闪烁匕首<\/a>/)
})

test('item pages lead with the Chinese name and the nicknames players search', async () => {
  const { renderItemPage } = await load()
  const html = renderItemPage(item('item_blink'))
  assert.match(title(html), /^闪烁匕首（Blink Dagger）给谁出/)
  assert.match(html, /也叫跳刀、闪现/)
  const bkb = renderItemPage(item('item_black_king_bar'))
  assert.match(bkb, /也叫BKB/)
})

test('component items get a Chinese category, not the raw tag', async () => {
  const { renderItemPage } = await load()
  const html = renderItemPage(item('item_blink'))
  assert.doesNotMatch(html, /component/)
})

test('Dagon levels get distinct titles', async () => {
  const { renderItemPage } = await load()
  const dagons = items.filter((i) => /^item_dagon(_\d)?$/.test(i.internalName))
  const titles = dagons.map((i) => title(renderItemPage(i)))
  assert.ok(titles.length > 1)
  assert.equal(new Set(titles).size, titles.length)
})

test('every hero has a Chinese name', async () => {
  const { zhName } = await load()
  const missing = heroes.filter((h) => zhName(h.internalName, null) === null)
  assert.deepEqual(missing.map((h) => h.internalName), [])
})

test('nicknames skip pinyin and ambiguous abbreviations', async () => {
  const { pickNicknames } = await extract()
  const blocked = new Set(['bs'])
  const e = {
    names: { zh: '黑皇杖' },
    aliases: { zh: ['bkb', 'heihuang', '黑皇', 'bs', '黑皇杖'], en: ['bkb', 'bs'] }
  }
  assert.deepEqual(pickNicknames(e, blocked), ['BKB', '黑皇'])
})

test('an item page already in the sitemap survives a data refresh', async () => {
  const { shouldEmitItem } = await load()
  const unbuilt = items.find(
    (i) => i.internalName === 'item_dagon_5'
  )
  assert.equal(shouldEmitItem(unbuilt, new Set()), false)
  assert.equal(shouldEmitItem(unbuilt, new Set(['dagon-5'])), true)
})

// 2026-10-04: hero pages carry counters and partners from the BP draft pack.
const pack = JSON.parse(readFileSync(resolve(DATA, 'draft-pack.json'), 'utf8'))
const loadMu = () => import('../_generator/matchups.mjs')

test('matchups: each list is signed right, thick enough and at most 5 long', async () => {
  const { matchupReader, MIN_GAMES, LIST_SIZE } = await loadMu()
  const read = matchupReader(pack)
  for (const h of heroes) {
    const m = read(h.internalName)
    assert.ok(m, `${h.internalName} missing from the pack`)
    for (const [list, sign] of [[m.counters, 1], [m.counteredBy, -1], [m.partners, 1]]) {
      assert.ok(list.length <= LIST_SIZE)
      for (const p of list) {
        assert.ok(sign * p.pp > 0, `${h.internalName} ${p.hero} ${p.pp}`)
        assert.ok(p.games >= MIN_GAMES)
        assert.notEqual(p.hero, h.internalName)
      }
    }
    // Sorted strongest first.
    const pps = m.counters.map((p) => p.pp)
    assert.deepEqual(pps, [...pps].sort((a, b) => b - a))
  }
})

test('matchups: the hero page shows them with links and puts them in the description', async () => {
  const { renderHeroPage } = await load()
  const { matchupReader } = await loadMu()
  const top = matchupReader(pack)('npc_dota_hero_axe').counters[0]
  const html = renderHeroPage(hero('npc_dota_hero_axe'), new Set())
  assert.match(html, /<h2>斧王克制谁、怕谁、和谁搭<\/h2>/)
  const slug = top.hero.replace('npc_dota_hero_', '').replace(/_/g, '-')
  assert.match(html, new RegExp(`href="/heroes/${slug}.html"`))
  assert.match(html, /<meta name="description" content="[^"]*克制[^"]*怕/)
  assert.match(html, /href="\/bp\/"/)
})

test('matchups: game counts read naturally and the capped value is not a fake exact number', async () => {
  const { formatGames, formatPp, GAMES_CAP } = await loadMu()
  assert.equal(formatGames(32767), '3.3 万局')
  assert.equal(formatGames(3157), '3,200 局')
  assert.equal(formatGames(GAMES_CAP), '6.3 万局以上')
  assert.equal(formatPp(5.25), '+5.3')
  assert.equal(formatPp(-2), '-2.0')
})

test('hero and item pages carry a BreadcrumbList that parses', async () => {
  const { renderHeroPage, renderItemPage } = await load()
  for (const html of [renderHeroPage(hero('npc_dota_hero_axe'), new Set()), renderItemPage(item('item_blink'))]) {
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
    assert.ok(m, 'no JSON-LD')
    const ld = JSON.parse(m[1])
    assert.equal(ld['@type'], 'BreadcrumbList')
    assert.equal(ld.itemListElement.length, 3)
    assert.equal(ld.itemListElement[0].item, 'https://amefys.com/')
  }
})
