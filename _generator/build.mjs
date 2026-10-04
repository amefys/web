#!/usr/bin/env node
/**
 * Generates SEO-friendly static pages for every Dota 2 hero + the
 * commonly-built items, plus a sitemap. Outputs into the repo root
 * (`amefys-web/heroes/*.html`, `amefys-web/items/*.html`,
 * `amefys-web/sitemap.xml`) so GitHub Pages serves them as-is.
 *
 * Data sources (snapshots in `_generator/data/`):
 *   - heroes.json: from `amefys/src/shared/data/heroes.json`
 *   - items.json : from `amefys/src/shared/data/items.json`
 *   - builds.json: OpenDota-derived build frequencies, 4 phases × top-N
 *
 * Refresh workflow:
 *   1. cp ../../amefys/src/shared/data/{heroes,items,builds}.json data/
 *   2. node build.mjs
 *   3. commit the diff
 *
 * Compliance: every data point we emit is publicly available
 * (OpenDota / Dota 2 client VPK), so this script does not expose
 * anything that the app itself does not already use. See COMPLIANCE.md.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(__dirname, 'data')

const HEROES = JSON.parse(readFileSync(resolve(DATA_DIR, 'heroes.json'), 'utf8'))
const ITEMS = JSON.parse(readFileSync(resolve(DATA_DIR, 'items.json'), 'utf8'))
const BUILDS = JSON.parse(readFileSync(resolve(DATA_DIR, 'builds.json'), 'utf8'))
// Official Chinese names + player nicknames, from extract-names.mjs.
const NAMES = JSON.parse(readFileSync(resolve(DATA_DIR, 'names.json'), 'utf8'))

const BUILD_BY_HERO = new Map(BUILDS.builds.map((b) => [b.internalName, b]))
const ITEM_BY_NAME = new Map(ITEMS.map((i) => [i.internalName, i]))
const HERO_BY_NAME = new Map(HEROES.map((h) => [h.internalName, h]))

const SITE = 'https://amefys.com'
const BUILD_DATE = new Date().toISOString().slice(0, 10)
// The date the build frequencies were fetched, not the date this script ran.
const DATA_DATE = (BUILDS._meta?.fetchedAt ?? BUILD_DATE).slice(0, 10)
const ZH_ORDER = new Intl.Collator('zh-Hans-u-co-pinyin')

// ── Names ───────────────────────────────────────────────────────

/** Official Chinese name, falling back to the English one. */
export function zhName(internalName, fallback) {
  return NAMES[internalName]?.zh ?? fallback
}

/** What players also call it: 跳刀, BKB. Empty when there is nothing common. */
export function nicknames(internalName) {
  return NAMES[internalName]?.nicknames ?? []
}

/** Dagon 1–5 share one name; the level tells their pages apart. */
export function itemName(item) {
  const level = item.internalName.match(/^item_dagon_(\d)$/)?.[1] ?? (item.internalName === 'item_dagon' ? '1' : null)
  const name = zhName(item.internalName, item.displayName)
  return level ? `${name} ${level} 级` : name
}

function nicknameLine(internalName) {
  const n = nicknames(internalName)
  return n.length ? `也叫${n.join('、')}` : ''
}

// ── Slug helpers ────────────────────────────────────────────────

function heroSlug(internalName) {
  return internalName.replace(/^npc_dota_hero_/, '').replace(/_/g, '-')
}

function itemSlug(internalName) {
  return internalName.replace(/^item_/, '').replace(/_/g, '-')
}

function escape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Reverse-index: items → heroes that build them ───────────────

function buildItemHeroIndex() {
  const idx = new Map() // itemName → [{ hero, count, phase }]
  for (const build of BUILDS.builds) {
    for (const phase of ['start', 'early', 'mid', 'late']) {
      const list = build[phase] ?? []
      for (const entry of list) {
        const arr = idx.get(entry.itemName) ?? []
        arr.push({ hero: build.internalName, count: entry.count, phase })
        idx.set(entry.itemName, arr)
      }
    }
  }
  // Collapse duplicate hero entries (same hero in early+mid+late) by max count
  const collapsed = new Map()
  for (const [item, arr] of idx) {
    const byHero = new Map()
    for (const { hero, count } of arr) {
      const prev = byHero.get(hero) ?? 0
      byHero.set(hero, Math.max(prev, count))
    }
    collapsed.set(
      item,
      [...byHero.entries()]
        .map(([hero, count]) => ({ hero, count }))
        .sort((a, b) => b.count - a.count)
    )
  }
  return collapsed
}

const ITEM_HERO_IDX = buildItemHeroIndex()

// ── Style block (shared header) ─────────────────────────────────

const HEAD_STYLE = `
<style>
  :root {
    --bg: #0d0a07; --bg-2: #141009; --surface: rgba(38,31,22,0.72);
    --hairline: rgba(232,199,121,0.12); --text: #f2ead8;
    --text-2: rgba(242,234,216,0.62); --text-3: rgba(242,234,216,0.40);
    --gold: #E8C779; --emerald: #34D399; --radiant: #3DBE8A; --dire: #D9534F;
    --r-md: 12px; --r-lg: 18px;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Source Han Sans SC", sans-serif;
    line-height: 1.55; -webkit-font-smoothing: antialiased; }
  a { color: var(--gold); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .nav { position: sticky; top: 0; z-index: 50; height: 48px;
    background: rgba(13,10,7,0.72); backdrop-filter: saturate(180%) blur(24px);
    -webkit-backdrop-filter: saturate(180%) blur(24px);
    border-bottom: 0.5px solid var(--hairline); }
  .nav-inner { max-width: 1080px; margin: 0 auto; height: 100%;
    display: flex; align-items: center; gap: 24px; padding: 0 24px;
    font-size: 12.5px; font-weight: 500;
    overflow-x: auto; scrollbar-width: none; }
  .nav-inner::-webkit-scrollbar { display: none; }
  .nav-inner a { color: var(--text-2); white-space: nowrap; flex-shrink: 0; }
  .nav-inner a:hover { color: var(--text); text-decoration: none; }
  .brand { display: flex; align-items: center; gap: 8px; color: var(--text) !important; font-weight: 600; }
  .brand img { width: 20px; height: 20px; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 32px 24px 96px; }
  h1 { font-size: 32px; letter-spacing: -0.5px; margin: 0 0 6px; }
  h2 { font-size: 20px; margin: 32px 0 12px; letter-spacing: -0.2px; }
  .tagline { color: var(--text-2); margin: 0 0 24px; font-size: 15px; }
  .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px; margin: 20px 0 8px; }
  .meta-cell { background: var(--surface); border: 0.5px solid var(--hairline);
    border-radius: var(--r-md); padding: 12px 14px; }
  .meta-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;
    color: var(--text-3); font-weight: 700; margin-bottom: 4px; }
  .meta-value { font-size: 16px; font-weight: 600; }
  .pill { display: inline-block; padding: 2px 9px; border-radius: 999px;
    background: rgba(212,175,106,0.16); color: var(--gold);
    font-size: 12px; font-weight: 600; margin-right: 6px; }
  .pill-warn { background: rgba(240,162,60,0.18); color: #f0a23c; }
  .pill-radiant { background: rgba(61,190,138,0.18); color: var(--radiant); }
  .pill-dire { background: rgba(217,83,79,0.18); color: var(--dire); }
  .table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; }
  .table th, .table td { text-align: left; padding: 10px 12px;
    border-bottom: 0.5px solid var(--hairline); font-size: 14px; }
  .table th { color: var(--text-3); font-size: 12px; text-transform: uppercase;
    letter-spacing: 0.5px; font-weight: 700; }
  .grid-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 8px; padding: 0; list-style: none; }
  .grid-list a { display: block; padding: 10px 12px; background: var(--surface);
    border: 0.5px solid var(--hairline); border-radius: var(--r-md);
    color: var(--text); font-size: 14px; }
  .grid-list a:hover { background: rgba(212,175,106,0.10); border-color: rgba(212,175,106,0.30); text-decoration: none; }
  .cta { display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px;
    background: linear-gradient(135deg, var(--emerald), #10B981); color: #062;
    border-radius: 24px; font-weight: 700; font-size: 14px; margin: 24px 0 8px;
    box-shadow: 0 0 0 3px rgba(52,211,153,0.16); }
  .cta:hover { text-decoration: none; }
  .breadcrumb { font-size: 12.5px; color: var(--text-3); margin-bottom: 14px; }
  .breadcrumb a { color: var(--text-2); }
  .disclaimer { font-size: 12px; color: var(--text-3); margin-top: 48px;
    border-top: 0.5px solid var(--hairline); padding-top: 16px; }
  @media (max-width: 560px) {
    .nav-inner { gap: 14px; padding: 0 14px; font-size: 12px; }
    .wrap { padding: 28px 18px 80px; }
    h1 { font-size: 27px; }
    .table th, .table td { padding: 9px 8px; font-size: 13px; }
  }
</style>
`

function nav() {
  return `
<nav class="nav"><div class="nav-inner">
  <a class="brand" href="/"><img src="/assets/icon.svg?v=2" alt="" />AMEFYS</a>
  <a href="/heroes/">英雄</a>
  <a href="/items/">装备</a>
  <a href="/packs/">回复包</a>
  <a href="/changelog.html">更新日志</a>
  <a href="/guestbook.html">留言板</a>
  <a href="/about.html">关于</a>
  <a href="/donate.html">捐助</a>
</div></nav>`
}

function shell({ title, description, canonical, body, lang = 'zh' }) {
  return `<!DOCTYPE html>
<html lang="${lang}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<link rel="canonical" href="${escape(canonical)}">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${escape(canonical)}">
<meta http-equiv="Cache-Control" content="no-transform">
<meta name="applicable-device" content="pc,mobile">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:site_name" content="AMEFYS">
<meta property="og:locale" content="zh_CN">
<meta property="og:image" content="${SITE}/assets/icon-512.png?v=2">
<meta name="twitter:card" content="summary">
<link rel="icon" type="image/svg+xml" href="/assets/icon.svg?v=2">
${HEAD_STYLE}
</head><body>
${nav()}
<main class="wrap">
${body}
<p class="disclaimer">数据快照 · ${DATA_DATE}。AMEFYS 与 Valve / Dota 2 无任何官方关联，仅作为信息辅助使用。出装频率来自 OpenDota 公开数据。</p>
</main>
</body></html>`
}

// ── Hero pages ──────────────────────────────────────────────────

const ATTR_LABEL = { str: '力量', agi: '敏捷', int: '智力', all: '万能' }
const ATTACK_LABEL = { melee: '近战', ranged: '远程' }
// The Chinese client's own role names.
export const ROLE_LABEL = {
  Carry: '核心',
  Support: '辅助',
  Nuker: '爆发',
  Disabler: '控制',
  Initiator: '先手',
  Durable: '耐久',
  Escape: '逃生',
  Pusher: '推进',
  Jungler: '打野'
}
const role = (r) => ROLE_LABEL[r] ?? r

function renderHeroPage(hero, emittedItemSlugs) {
  const slug = heroSlug(hero.internalName)
  const build = BUILD_BY_HERO.get(hero.internalName)
  const zh = zhName(hero.internalName, hero.displayName)
  const also = nicknameLine(hero.internalName)
  const attr = ATTR_LABEL[hero.primaryAttr] ?? hero.primaryAttr
  const attack = ATTACK_LABEL[hero.attackType] ?? hero.attackType
  const title = `${zh}出装攻略（${hero.displayName}）· DOTA 2 · AMEFYS`
  const description = `DOTA 2 ${zh}（${hero.displayName}${also ? `，${also}` : ''}）出装：开局、前期、中期、后期常见装备与出场次数。${attr}${attack}英雄，定位${hero.roles.map(role).join('、')}。`

  const phaseSection = (phase, label) => {
    const list = build?.[phase]?.slice(0, 8) ?? []
    if (list.length === 0) return ''
    return `
<h2>${label}</h2>
<table class="table">
  <thead><tr><th>装备</th><th>出场次数</th></tr></thead>
  <tbody>
${list
  .map((entry) => {
    const item = ITEM_BY_NAME.get(entry.itemName)
    const name = item ? itemName(item) : entry.itemName.replace(/^item_/, '')
    const slug = itemSlug(entry.itemName)
    const linkable = item && emittedItemSlugs.has(slug)
    return `    <tr><td>${linkable ? `<a href="/items/${slug}.html">${escape(name)}</a>` : escape(name)}</td><td>${entry.count}</td></tr>`
  })
  .join('\n')}
  </tbody>
</table>`
  }

  const sameRoleHeroes = hero.roles[0]
    ? HEROES.filter(
        (h) => h.internalName !== hero.internalName && h.roles.includes(hero.roles[0])
      ).slice(0, 12)
    : []

  const relatedSection =
    sameRoleHeroes.length > 0
      ? `
<h2>同类英雄</h2>
<ul class="grid-list">
${sameRoleHeroes
  .map((h) => `  <li><a href="/heroes/${heroSlug(h.internalName)}.html">${escape(zhName(h.internalName, h.displayName))}</a></li>`)
  .join('\n')}
</ul>`
      : ''

  const body = `
<div class="breadcrumb"><a href="/">首页</a> · <a href="/heroes/">英雄列表</a> · ${escape(zh)}</div>
<h1>${escape(zh)}出装攻略</h1>
<p class="tagline">${escape(hero.displayName)}${also ? ` · ${escape(also)}` : ''} · 主属性 ${attr} · ${attack}</p>
<div>
  ${hero.roles.map((r) => `<span class="pill">${escape(role(r))}</span>`).join('')}
</div>
<div class="meta-grid">
  <div class="meta-cell"><div class="meta-label">主属性</div><div class="meta-value">${attr}</div></div>
  <div class="meta-cell"><div class="meta-label">攻击距离</div><div class="meta-value">${attack}</div></div>
  <div class="meta-cell"><div class="meta-label">定位</div><div class="meta-value">${escape(hero.roles.map(role).join(' / '))}</div></div>
</div>
${phaseSection('start', '开局出装')}
${phaseSection('early', '前期出装')}
${phaseSection('mid', '中期核心')}
${phaseSection('late', '后期成型')}
<h2>关于 AMEFYS 实时建议</h2>
<p>AMEFYS 是一个开放式 DOTA 2 桌面助手，在游戏内通过 GSI（官方 Game State Integration）实时读取战场状态，并据此对${escape(zh)}给出装备推荐、关键道具完成提醒、聊天翻译等辅助。所有数据均来自 Dota 2 官方接口与 OpenDota 公开统计，不修改任何游戏内容，符合 Valve 的合规要求。</p>
<a class="cta" href="/#download">免费下载 AMEFYS →</a>
${relatedSection}
`
  return shell({
    title,
    description,
    canonical: `${SITE}/heroes/${slug}.html`,
    body
  })
}

function renderHeroIndex() {
  const byRole = new Map()
  for (const h of HEROES) {
    for (const role of h.roles) {
      const arr = byRole.get(role) ?? []
      arr.push(h)
      byRole.set(role, arr)
    }
  }
  const ROLE_ORDER = ['Carry', 'Support', 'Nuker', 'Disabler', 'Initiator', 'Durable', 'Escape', 'Pusher', 'Jungler']
  const orderedRoles = ROLE_ORDER.filter((r) => byRole.has(r)).concat(
    [...byRole.keys()].filter((r) => !ROLE_ORDER.includes(r))
  )

  const body = `
<div class="breadcrumb"><a href="/">首页</a> · 英雄列表</div>
<h1>DOTA 2 英雄出装攻略</h1>
<p class="tagline">${HEROES.length} 名英雄的实时出装推荐、定位分析与 AMEFYS 助手适配。数据来源：Dota 2 官方 GSI + OpenDota 公开统计。</p>
${orderedRoles
  .map(
    (role) => `
<h2>${escape(ROLE_LABEL[role] ?? role)}（${byRole.get(role).length}）</h2>
<ul class="grid-list">
${byRole
  .get(role)
  .map((h) => ({ h, zh: zhName(h.internalName, h.displayName) }))
  .sort((a, b) => ZH_ORDER.compare(a.zh, b.zh))
  .map(
    ({ h, zh }) =>
      `  <li><a href="/heroes/${heroSlug(h.internalName)}.html">${escape(zh)}</a></li>`
  )
  .join('\n')}
</ul>`
  )
  .join('\n')}
`
  return shell({
    title: 'DOTA 2 英雄出装攻略 · AMEFYS 实时助手',
    description: `${HEROES.length} 名 DOTA 2 英雄的出装攻略：按核心、辅助、先手等定位分类，每个英雄的开局、前期、中期、后期常见装备。`,
    canonical: `${SITE}/heroes/`,
    body
  })
}

// ── Item pages ──────────────────────────────────────────────────

const QUALIFIER_LABEL = {
  common: '基础',
  component: '配件',
  rare: '高级',
  epic: '顶级',
  artifact: '神器',
  consumable: '消耗品',
  secret_shop: '秘密商店'
}

// "consumable;laning" and friends: the first tag decides the group.
function qualifier(item) {
  const q = (item.qualifier ?? '').split(';')[0]
  return QUALIFIER_LABEL[q] ?? (q || '其他')
}

/**
 * Item pages already in the sitemap. They stay up while the item exists in
 * the game, even after it drops out of every hero's top builds — a page that
 * search engines indexed must not turn into a 404 with the next data refresh.
 */
function publishedItemSlugs() {
  try {
    const xml = readFileSync(resolve(REPO_ROOT, 'sitemap.xml'), 'utf8')
    return new Set([...xml.matchAll(/\/items\/([a-z0-9-]+)\.html/g)].map((m) => m[1]))
  } catch {
    return new Set()
  }
}

function shouldEmitItem(item, published = new Set()) {
  // Skip recipe items, aegis-like artifacts, and items with no display name.
  if (!item.displayName) return false
  if (item.isRecipe) return false
  if (item.internalName === 'item_aegis') return false
  // New pages only for items some hero builds; old pages are kept.
  return ITEM_HERO_IDX.has(item.internalName) || published.has(itemSlug(item.internalName))
}

function renderItemPage(item) {
  const slug = itemSlug(item.internalName)
  const heroes = (ITEM_HERO_IDX.get(item.internalName) ?? []).slice(0, 12)
  const zh = itemName(item)
  const also = nicknameLine(item.internalName)
  const kind = qualifier(item)
  const title = `${zh}（${item.displayName}）给谁出 · DOTA 2 装备 · AMEFYS`
  const description = `DOTA 2 ${zh}（${item.displayName}${also ? `，${also}` : ''}）：${kind}装备，价格 ${item.cost} 金。最常出${zh}的英雄与出场次数。`

  const heroList = heroes
    .map((entry) => {
      const hero = HERO_BY_NAME.get(entry.hero)
      if (!hero) return ''
      return `  <li><a href="/heroes/${heroSlug(entry.hero)}.html">${escape(zhName(hero.internalName, hero.displayName))}</a> <span style="color:var(--text-3);font-size:12px;margin-left:6px;">${entry.count} 场</span></li>`
    })
    .filter(Boolean)
    .join('\n')

  const body = `
<div class="breadcrumb"><a href="/">首页</a> · <a href="/items/">装备列表</a> · ${escape(zh)}</div>
<h1>${escape(zh)}</h1>
<p class="tagline">${escape(item.displayName)}${also ? ` · ${escape(also)}` : ''} · ${escape(kind)} · 价格 ${item.cost} 金</p>
<div class="meta-grid">
  <div class="meta-cell"><div class="meta-label">类别</div><div class="meta-value">${escape(kind)}</div></div>
  <div class="meta-cell"><div class="meta-label">价格</div><div class="meta-value">${item.cost} 金</div></div>
</div>
<h2>哪些英雄常出${escape(zh)}</h2>
${heroes.length === 0 ? `<p>最近的公开对局里，${escape(zh)}不在任何英雄最常出的前 8 件装备里。</p>` : `<ul class="grid-list">\n${heroList}\n</ul>`}
<h2>关键道具实时提醒</h2>
<p>AMEFYS 桌面助手通过 DOTA 2 官方 GSI 接口实时跟踪你的装备栏，在${escape(zh)}等关键道具做出来的那一刻提醒你，不错过发力期。所有数据来自官方接口，不修改任何游戏内容。</p>
<a class="cta" href="/#download">免费下载 AMEFYS →</a>
`
  return shell({
    title,
    description,
    canonical: `${SITE}/items/${slug}.html`,
    body
  })
}

function renderItemIndex(items) {
  const byQualifier = new Map()
  for (const it of items) {
    const q = qualifier(it)
    const arr = byQualifier.get(q) ?? []
    arr.push(it)
    byQualifier.set(q, arr)
  }

  const body = `
<div class="breadcrumb"><a href="/">首页</a> · 装备列表</div>
<h1>DOTA 2 装备出装数据库</h1>
<p class="tagline">${items.length} 件主流装备：每件装备最常被哪些英雄出、出场多少次。数据来源：OpenDota 公开统计。</p>
${[...byQualifier.entries()]
  .sort(([a], [b]) => ZH_ORDER.compare(a, b))
  .map(
    ([q, arr]) => `
<h2>${escape(q)}（${arr.length}）</h2>
<ul class="grid-list">
${arr
  .map((it) => ({ it, zh: itemName(it) }))
  .sort((a, b) => ZH_ORDER.compare(a.zh, b.zh))
  .map(
    ({ it, zh }) =>
      `  <li><a href="/items/${itemSlug(it.internalName)}.html">${escape(zh)}</a></li>`
  )
  .join('\n')}
</ul>`
  )
  .join('\n')}
`
  return shell({
    title: 'DOTA 2 装备出装数据库 · AMEFYS',
    description: 'DOTA 2 装备大全：跳刀、BKB、阿哈利姆神杖等主流装备的价格、类别，以及最常出这件装备的英雄。',
    canonical: `${SITE}/items/`,
    body
  })
}

// ── Sitemap ─────────────────────────────────────────────────────

function renderSitemap(heroFiles, itemFiles) {
  const urls = [
    { loc: `${SITE}/`, priority: '1.0' },
    { loc: `${SITE}/compliance.html`, priority: '0.8' },
    { loc: `${SITE}/changelog.html`, priority: '0.7' },
    { loc: `${SITE}/guestbook.html`, priority: '0.6' },
    { loc: `${SITE}/en/guestbook.html`, priority: '0.5' },
    { loc: `${SITE}/packs/`, priority: '0.7' },
    { loc: `${SITE}/guides/vb-cable/`, priority: '0.7' },
    { loc: `${SITE}/about.html`, priority: '0.6' },
    { loc: `${SITE}/donate.html`, priority: '0.6' },
    { loc: `${SITE}/en/donate.html`, priority: '0.5' },
    { loc: `${SITE}/privacy.html`, priority: '0.4' },
    { loc: `${SITE}/refund.html`, priority: '0.3' },
    { loc: `${SITE}/credits.html`, priority: '0.3' },
    { loc: `${SITE}/licenses.html`, priority: '0.3' },
    { loc: `${SITE}/en/`, priority: '0.8' },
    { loc: `${SITE}/en/about.html`, priority: '0.5' },
    { loc: `${SITE}/en/packs/`, priority: '0.6' },
    { loc: `${SITE}/heroes/`, priority: '0.8' },
    { loc: `${SITE}/items/`, priority: '0.8' },
    ...heroFiles.map((slug) => ({ loc: `${SITE}/heroes/${slug}.html`, priority: '0.6' })),
    ...itemFiles.map((slug) => ({ loc: `${SITE}/items/${slug}.html`, priority: '0.5' }))
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${u.loc}</loc><lastmod>${BUILD_DATE}</lastmod><changefreq>weekly</changefreq><priority>${u.priority}</priority></url>`
  )
  .join('\n')}
</urlset>
`
}

export { renderHeroPage, renderItemPage, renderHeroIndex, renderItemIndex, shouldEmitItem }

// ── Main ────────────────────────────────────────────────────────

function main() {

  function cleanDir(path) {
    try {
      rmSync(path, { recursive: true, force: true })
    } catch {}
    mkdirSync(path, { recursive: true })
  }

  const heroesOut = resolve(REPO_ROOT, 'heroes')
  const itemsOut = resolve(REPO_ROOT, 'items')
  cleanDir(heroesOut)
  cleanDir(itemsOut)

  // Item pages first so hero pages can know which slugs are linkable.
  const published = publishedItemSlugs()
  const itemsForOutput = ITEMS.filter((item) => shouldEmitItem(item, published))
  const itemSlugs = []
  const emittedItemSlugs = new Set()
  for (const item of itemsForOutput) {
    const slug = itemSlug(item.internalName)
    writeFileSync(resolve(itemsOut, `${slug}.html`), renderItemPage(item))
    itemSlugs.push(slug)
    emittedItemSlugs.add(slug)
  }
  writeFileSync(resolve(itemsOut, 'index.html'), renderItemIndex(itemsForOutput))

  const heroSlugs = []
  for (const hero of HEROES) {
    const slug = heroSlug(hero.internalName)
    writeFileSync(resolve(heroesOut, `${slug}.html`), renderHeroPage(hero, emittedItemSlugs))
    heroSlugs.push(slug)
  }
  writeFileSync(resolve(heroesOut, 'index.html'), renderHeroIndex())

  writeFileSync(resolve(REPO_ROOT, 'sitemap.xml'), renderSitemap(heroSlugs, itemSlugs))

  // Optional robots.txt — only create if missing so we never trample a custom one.
  const robotsPath = resolve(REPO_ROOT, 'robots.txt')
  try {
    readFileSync(robotsPath, 'utf8')
  } catch {
    writeFileSync(
      robotsPath,
      `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`
    )
  }

  console.log(
    `Generated ${heroSlugs.length} hero pages + ${itemSlugs.length} item pages + sitemap.xml`
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
