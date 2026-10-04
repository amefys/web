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
  assert.match(title(html), /^斧王出装攻略（Axe）/)
  assert.equal(h1(html), '斧王出装攻略')
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
