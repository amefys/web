#!/usr/bin/env node
/**
 * Push amefys.com URLs to Baidu's 普通收录 API (docs/seo-plan-2026-09.md P0-1).
 *
 * Baidu does not discover overseas-hosted sites on its own; the push API is
 * what gets pages into the crawl queue. Quota is per-site, per-day and small
 * for a new site, so the list is ordered: the money pages go every day, the
 * 300 generated hero/item pages rotate through the remaining quota.
 *
 * Usage:
 *   BAIDU_PUSH_TOKEN=xxx node scripts/baidu-push.mjs            # push
 *   node scripts/baidu-push.mjs --dry-run                       # print the list
 *   BAIDU_PUSH_TOKEN=xxx node scripts/baidu-push.mjs --limit 50
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

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.indexOf('--limit')
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 20

const sitemap = readFileSync(resolve(import.meta.dirname, '..', 'sitemap.xml'), 'utf8')
const all = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
const priority = PRIORITY.map((p) => SITE + p).filter((u) => all.includes(u) || u === SITE + '/')
const rest = all.filter((u) => !priority.includes(u))

// Rotate the long tail by day-of-year so every page gets pushed eventually.
const day = Math.floor(Date.now() / 86_400_000)
const room = Math.max(0, limit - priority.length)
const start = rest.length ? (day * room) % rest.length : 0
const rotated = [...rest.slice(start), ...rest.slice(0, start)].slice(0, room)
const urls = [...priority, ...rotated].slice(0, limit)

if (dryRun) {
  console.log(urls.join('\n'))
  console.log(`\n${urls.length} urls (priority ${priority.length}, rotated ${rotated.length}, offset ${start})`)
  process.exit(0)
}

const token = process.env.BAIDU_PUSH_TOKEN
if (!token) {
  console.error('BAIDU_PUSH_TOKEN is not set — nothing pushed')
  process.exit(2)
}

const res = await fetch(ENDPOINT + token, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body: urls.join('\n')
})
const body = await res.text()
console.log(`HTTP ${res.status}: ${body}`)
// Success body: {"remain":N,"success":M}. Anything else is a quota / token error.
if (!res.ok) process.exit(1)
