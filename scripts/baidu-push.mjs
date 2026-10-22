#!/usr/bin/env node
/**
 * Push site URLs to Baidu's 普通收录 API (docs/seo-plan-2026-09.md P0-1).
 *
 * Which site: BAIDU_SITE (default https://amefys.com). From 2026-10-22 Baidu is meant to
 * index the mainland mirror https://amefys.cn instead (amefys repo, docs/china-deployment-plan.md
 * §0.7); it carries the same pages, so the sitemap's amefys.com URLs are moved to that host.
 * The site must be verified in ziyuan.baidu.com first, or Baidu answers "site init fail".
 *
 * Baidu does not discover overseas-hosted sites on its own; the push API is
 * what gets pages into the crawl queue. Quota is per-site, per-day and small
 * for a new site (10 a day on 2026-10-04), and a request with more URLs than
 * the quota left is rejected whole ("over quota"). So each day takes the
 * next window of the list — money pages first, then every hero/item page —
 * pushes one URL to learn the remaining quota, then spends exactly that.
 *
 * Usage:
 *   BAIDU_PUSH_TOKEN=xxx node scripts/baidu-push.mjs            # push
 *   node scripts/baidu-push.mjs --dry-run                       # print the list
 *   BAIDU_PUSH_TOKEN=xxx node scripts/baidu-push.mjs --limit 10
 *   BAIDU_PUSH_TOKEN=xxx node scripts/baidu-push.mjs --urls /blog/,/blog/new-post.html
 *     (just these pages, ahead of the rotation — a new blog post would otherwise wait
 *      weeks for its turn; still capped by today's quota)
 *   BAIDU_PUSH_TOKEN=xxx node scripts/baidu-push.mjs --first /blog/new-post.html
 *     (these first, then today's rotation fills the rest of the quota)
 *
 * Token: ziyuan.baidu.com → 资源提交 → 普通收录 → API 提交 (per site).
 *   BAIDU_SITE=https://amefys.cn BAIDU_PUSH_TOKEN=xxx node scripts/baidu-push.mjs
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** The sitemap is written for this host. */
const SITEMAP_HOST = 'https://amefys.com'
const SITES = ['https://amefys.com', 'https://amefys.cn']

/** BAIDU_SITE → one of SITES (default amefys.com); anything else is a mistake, not a fallback. */
export function siteFrom(env) {
  const raw = String(env.BAIDU_SITE || SITEMAP_HOST).replace(/\/+$/, '')
  if (!SITES.includes(raw)) throw new Error(`BAIDU_SITE must be one of ${SITES.join(', ')} (got ${raw})`)
  return raw
}

/** Sitemap <loc>s, moved onto `site`. */
export function sitemapUrls(xml, site = SITEMAP_HOST) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
    m[1].startsWith(SITEMAP_HOST + '/') ? site + m[1].slice(SITEMAP_HOST.length) : m[1]
  )
}

/** Always pushed first, in this order. */
const PRIORITY = [
  '/',
  '/compliance.html',
  '/packs/',
  '/guides/vb-cable/',
  '/about.html',
  '/privacy.html',
  '/heroes/',
  '/items/',
  '/en/'
]

const DAY_MS = 86_400_000

/** Money pages first, then the rest of the sitemap in its own order. */
export function orderUrls(all, site = SITEMAP_HOST) {
  const priority = PRIORITY.map((p) => site + p).filter((u) => all.includes(u) || u === site + '/')
  return [...priority, ...all.filter((u) => !priority.includes(u))]
}

/** Today's slice: `size` URLs, moving on by `size` every day and wrapping. */
export function windowFor(urls, size, now = Date.now()) {
  if (!urls.length) return []
  const day = Math.floor(now / DAY_MS)
  const start = (day * size) % urls.length
  return [...urls.slice(start), ...urls.slice(0, start)].slice(0, Math.min(size, urls.length))
}

/** `--urls` value → absolute URLs on `site`; paths may be given with or without the site. */
export function explicitUrls(arg, site = SITEMAP_HOST) {
  return String(arg || '')
    .split(/[,\s]+/)
    .map((u) => u.trim())
    .filter(Boolean)
    .map((u) => (u.startsWith('http') ? u : site + (u.startsWith('/') ? u : '/' + u)))
    .filter((u) => u.startsWith(site + '/'))
}

/** `first` ahead of today's rotation window, no duplicates, `size` in total. */
export function withFirst(first, window, size) {
  const seen = new Set()
  const out = []
  for (const u of [...first, ...window]) if (!seen.has(u)) { seen.add(u); out.push(u) }
  return out.slice(0, size)
}

async function push(site, token, urls) {
  const res = await fetch(`http://data.zz.baidu.com/urls?site=${site}&token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: urls.join('\n')
  })
  const text = await res.text()
  let json = {}
  try {
    json = JSON.parse(text)
  } catch {}
  return { ok: res.ok, status: res.status, text, json }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const limitArg = args.indexOf('--limit')
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 10

  const site = siteFrom(process.env)
  const all = sitemapUrls(readFileSync(resolve(import.meta.dirname, '..', 'sitemap.xml'), 'utf8'), site)
  const urlsArg = args.indexOf('--urls')
  const picked = urlsArg >= 0 ? explicitUrls(args[urlsArg + 1], site) : []
  const firstArg = args.indexOf('--first')
  const ahead = firstArg >= 0 ? explicitUrls(args[firstArg + 1], site) : []
  const urls = picked.length
    ? picked.slice(0, limit)
    : withFirst(ahead, windowFor(orderUrls(all, site), limit), limit)

  if (dryRun) {
    console.log(urls.join('\n'))
    console.log(`\n${urls.length} of ${all.length} urls`)
    return
  }

  const token = process.env.BAIDU_PUSH_TOKEN
  if (!token) {
    console.error('BAIDU_PUSH_TOKEN is not set — nothing pushed')
    process.exit(2)
  }

  // One URL first: the reply says how much of today's quota is left.
  console.log(`site: ${site}`)
  const first = await push(site, token, urls.slice(0, 1))
  console.log(`HTTP ${first.status}: ${first.text}`)
  if (first.json.message === 'over quota') return console.log("today's quota is used up")
  if (!first.ok) process.exit(1)

  const next = urls.slice(1, 1 + (first.json.remain ?? 0))
  if (!next.length) return console.log(`pushed 1 url, ${first.json.remain ?? 0} left today`)
  const rest = await push(site, token, next)
  console.log(`HTTP ${rest.status}: ${rest.text}`)
  if (!rest.ok && rest.json.message !== 'over quota') process.exit(1)
  console.log(`pushed ${1 + (rest.json.success ?? 0)} urls`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
