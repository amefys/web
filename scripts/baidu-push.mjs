#!/usr/bin/env node
/**
 * Push amefys.com URLs to Baidu's 普通收录 API (docs/seo-plan-2026-09.md P0-1).
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
 *
 * Token: ziyuan.baidu.com → 资源提交 → 普通收录 → API 提交 (per site).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SITE = 'https://amefys.com'
const ENDPOINT = `http://data.zz.baidu.com/urls?site=${SITE}&token=`

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
export function orderUrls(all) {
  const priority = PRIORITY.map((p) => SITE + p).filter((u) => all.includes(u) || u === SITE + '/')
  return [...priority, ...all.filter((u) => !priority.includes(u))]
}

/** Today's slice: `size` URLs, moving on by `size` every day and wrapping. */
export function windowFor(urls, size, now = Date.now()) {
  if (!urls.length) return []
  const day = Math.floor(now / DAY_MS)
  const start = (day * size) % urls.length
  return [...urls.slice(start), ...urls.slice(0, start)].slice(0, Math.min(size, urls.length))
}

async function push(token, urls) {
  const res = await fetch(ENDPOINT + token, {
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

  const sitemap = readFileSync(resolve(import.meta.dirname, '..', 'sitemap.xml'), 'utf8')
  const all = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  const urls = windowFor(orderUrls(all), limit)

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
  const first = await push(token, urls.slice(0, 1))
  console.log(`HTTP ${first.status}: ${first.text}`)
  if (first.json.message === 'over quota') return console.log("today's quota is used up")
  if (!first.ok) process.exit(1)

  const next = urls.slice(1, 1 + (first.json.remain ?? 0))
  if (!next.length) return console.log(`pushed 1 url, ${first.json.remain ?? 0} left today`)
  const rest = await push(token, next)
  console.log(`HTTP ${rest.status}: ${rest.text}`)
  if (!rest.ok && rest.json.message !== 'over quota') process.exit(1)
  console.log(`pushed ${1 + (rest.json.success ?? 0)} urls`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
