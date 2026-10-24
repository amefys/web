/**
 * donor-wall — the "谢谢这些朋友" wall on donate.html (2026-10-24).
 *
 * A cron Worker (hourly) that writes `donors.json` to the CDN bucket, served at
 * https://cdn.amefys.com/donors.json (5-minute cache rule). The page only reads
 * that file. Two sources:
 *
 *   afdian   automatic: query-sponsor (name, avatar) + query-order (which plan,
 *            when, the payer's note), signed with our API token
 *   wechat   manual: WeChat tips have no API, so the ops panel adds them through
 *            the admin endpoint below
 *
 * Privacy rules, decided with the owner — the public file is readable by anyone:
 *
 *  - No amount, no plan, no payer id ever leaves this Worker. Orders also carry
 *    a postal address and phone; only whitelisted fields are copied out.
 *  - Only donation orders count. Membership and goods are purchases and their
 *    buyers never agreed to be listed, so plans are an allowlist
 *    (DONATION_PLAN_IDS + the free-amount order with no plan): a new plan that
 *    nobody told us about leaves someone off the wall instead of on it.
 *  - Name and avatar are judged separately. The afdian default nickname
 *    (爱发电用户_xxxxxx) or a note containing 匿名 → shown as an anonymous
 *    friend; the default avatar → no picture. Anonymous people still get their
 *    own tile.
 *  - WeChat names are masked to the first character unless the owner confirmed
 *    the person is fine with the full name.
 *  - Notes go up automatically, but anything that looks like contact details or
 *    an ad, or hits the blocklist, is dropped; the panel can hide any entry.
 *
 * State lives in KV (DONORS), not in the CDN bucket, because everything in that
 * bucket is public:
 *   manual        WeChat entries          (written by the panel only)
 *   hidden        hidden donors / notes   (written by the panel only)
 *   afdian-cache  last good afdian read   (written by the cron only)
 * Separate keys so a cron run and a panel click never overwrite each other.
 *
 * Admin endpoint (the local ops panel), bearer ADMIN_KEY, anything else 404s:
 *   GET  /admin/state      everything the panel shows
 *   POST /admin/manual     {op:'add'|'update'|'remove', ...}
 *   POST /admin/hide       {kind:'donor'|'post', key, hidden}
 *   POST /admin/refresh    re-read afdian now
 *
 * Deploy: worker/deploy-donor-wall.sh. Bindings: R2 `amefys-cdn` as CDN,
 * KV as DONORS, var DONATION_PLAN_IDS. Secrets: AFDIAN_USER_ID,
 * AFDIAN_API_TOKEN, ADMIN_KEY.
 */

export const PUBLIC_KEY = 'donors.json'
const AFDIAN_API = 'https://afdian.com/api/open'
const MAX_PAGES = 50
const NAME_MAX = 20
const MSG_MAX = 60
const POSTS_SHOWN = 5
const MANUAL_MAX = 1000
/** Display dates are China time: a tip at 00:30 on the 1st belongs to that month. */
const TZ_OFFSET_MS = 8 * 3600 * 1000

const DEFAULT_NAME_RE = /^爱发电用户[_\s-]?[0-9a-z]*$/i
const ANON_RE = /匿名/
const PURCHASE_REF_RE = /AMF-[0-9A-Z]{6}/gi
/** Contact details and ads: long digit runs (phone / QQ), links, handles. */
const CONTACT_RE = /\d{5,}|https?:|www\.|\.(com|cn|net|org|top|xyz)\b|@|\b(qq|vx|wx|tg)\b|v信|微信号|加我|加群|群号|私聊|telegram|wechat/i
/** A short floor, not a moderation system: the panel's hide button is the real tool. */
// No 垃圾 / 滚: half the app is about trash talk, "垃圾话翻译好用" is praise.
const BLOCKLIST_CN = ['傻逼', '傻b', '煞笔', '操你', '草你', '妈的', '尼玛', '你妈', '博彩', '彩票', '代练', '外挂', '刷分', '色情', '约炮']
/** Latin words match whole words only, so "sb" does not catch "usb". */
const BLOCKLIST_EN = /\b(sb|fuck\w*|shit\w*|bitch\w*|nigg\w*|casino|porn\w*)\b/i

// ── helpers ──────────────────────────────────────────────────────────────

function chars(s) {
  return Array.from(s)
}

/** Strip controls / zero-width / bidi marks, collapse whitespace. */
export function clean(raw) {
  if (typeof raw !== 'string') return ''
  return raw
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(s, max) {
  const c = chars(s)
  return c.length > max ? c.slice(0, max - 1).join('') + '…' : s
}

export function blocked(s) {
  const low = s.toLowerCase().replace(/\s+/g, '')
  return BLOCKLIST_CN.some((w) => low.includes(w)) || BLOCKLIST_EN.test(s)
}

/** A public display name, or null for "匿名朋友". */
export function displayName(raw) {
  const s = clean(raw)
  if (!s || DEFAULT_NAME_RE.test(s) || ANON_RE.test(s) || blocked(s) || CONTACT_RE.test(s)) return null
  return truncate(s, NAME_MAX)
}

/** Only a custom afdian avatar is shown; the default one means "no picture". */
export function displayAvatar(raw) {
  if (typeof raw !== 'string') return null
  let u
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || !/(^|\.)afdiancdn\.com$/.test(u.hostname)) return null
  if (u.pathname.includes('/default/')) return null
  return u.origin + u.pathname
}

/** A note fit for the wall, or null. `匿名` itself is a request, not a message. */
export function displayMessage(raw) {
  let s = clean(raw).replace(PURCHASE_REF_RE, '').replace(/匿名/g, '')
  s = s.replace(/^[\s,，.。!！:：;；、~～-]+|[\s,，;；、~～-]+$/g, '').trim()
  if (!s || CONTACT_RE.test(s) || blocked(s)) return null
  return truncate(s, MSG_MAX)
}

export function maskName(name) {
  const c = chars(clean(name))
  return c.length ? c[0] + '*' : ''
}

function cnDate(ms) {
  return new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10)
}

// ── afdian ───────────────────────────────────────────────────────────────

/** Workers' WebCrypto has MD5 (afdian's signature needs it); Node's does not, so tests inject one. */
export async function md5Hex(text) {
  const buf = await crypto.subtle.digest('MD5', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function afdianCall(fetchImpl, cfg, path, params, nowMs) {
  const p = JSON.stringify(params)
  const ts = Math.floor(nowMs / 1000)
  const sign = await (cfg.md5 || md5Hex)(`${cfg.token}params${p}ts${ts}user_id${cfg.userId}`)
  const res = await fetchImpl(`${AFDIAN_API}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: cfg.userId, params: p, ts, sign })
  })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
  const body = await res.json()
  if (!body || body.ec !== 200) throw new Error(`${path} → ec=${body && body.ec} ${(body && body.em) || ''}`)
  return body.data || {}
}

async function afdianAll(fetchImpl, cfg, path, nowMs) {
  const out = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await afdianCall(fetchImpl, cfg, path, { page, per_page: 100 }, nowMs)
    const list = Array.isArray(data.list) ? data.list : []
    out.push(...list)
    if (!list.length || page >= (Number(data.total_page) || 1)) break
  }
  return out
}

export function isDonation(order, planIds) {
  if (!order || Number(order.status) !== 2) return false
  if (Number(order.product_type) === 1) return false
  const plan = typeof order.plan_id === 'string' ? order.plan_id : ''
  return plan === '' || planIds.has(plan)
}

/**
 * Raw afdian lists → the internal records the wall is built from. Keys are
 * internal (payer id / trade number) and never reach the public file.
 */
export function shapeAfdian(sponsors, orders, planIds) {
  const users = new Map()
  for (const s of sponsors) {
    const u = s && s.user
    if (u && typeof u.user_id === 'string') users.set(u.user_id, u)
  }
  const byPayer = new Map()
  const skipped = {}
  const posts = []
  for (const o of orders) {
    if (!isDonation(o, planIds)) {
      if (o && Number(o.status) === 2) {
        const label = `${clean(o.plan_title) || '(无标题)'} · ${o.plan_id || '自选金额'}`
        skipped[label] = (skipped[label] || 0) + 1
      }
      continue
    }
    const payer = String(o.user_id || '')
    if (!payer) continue
    const at = Number(o.create_time) * 1000
    const rec = byPayer.get(payer) || { first: at, anon: false, orderName: o.user_name }
    rec.first = Math.min(rec.first, at)
    if (ANON_RE.test(clean(o.remark))) rec.anon = true
    byPayer.set(payer, rec)
    const msg = displayMessage(o.remark)
    if (msg) posts.push({ key: `afdian:${o.out_trade_no}`, payer, at, msg })
  }
  const donors = []
  for (const [payer, rec] of byPayer) {
    const u = users.get(payer) || {}
    donors.push({
      key: `afdian:${payer}`,
      via: 'afdian',
      first: rec.first,
      name: rec.anon ? null : displayName(u.name || rec.orderName),
      avatar: rec.anon ? null : displayAvatar(u.avatar)
    })
  }
  const byKey = new Map(donors.map((d) => [d.key.slice('afdian:'.length), d]))
  return {
    donors,
    posts: posts.map(({ payer, ...p }) => ({ ...p, via: 'afdian', donor: `afdian:${payer}`, name: byKey.get(payer).name, avatar: byKey.get(payer).avatar })),
    skipped
  }
}

export async function readAfdian(fetchImpl, env, nowMs) {
  const cfg = { userId: env.AFDIAN_USER_ID, token: env.AFDIAN_API_TOKEN, md5: env.md5 }
  if (!cfg.userId || !cfg.token) throw new Error('afdian credentials missing')
  const planIds = new Set(String(env.DONATION_PLAN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean))
  const [sponsors, orders] = await Promise.all([
    afdianAll(fetchImpl, cfg, 'query-sponsor', nowMs),
    afdianAll(fetchImpl, cfg, 'query-order', nowMs)
  ])
  return { ...shapeAfdian(sponsors, orders, planIds), fetchedAt: new Date(nowMs).toISOString() }
}

// ── manual (WeChat) ──────────────────────────────────────────────────────

const DISPLAYS = ['full', 'masked', 'anon']

export function manualDonor(e) {
  const name = e.display === 'anon' ? null : e.display === 'full' ? displayName(e.name) : displayName(maskName(e.name))
  return { key: `wechat:${e.id}`, via: 'wechat', first: Date.parse(`${e.at}T12:00:00+08:00`), name, avatar: null }
}

/** Apply one panel edit to the manual list; returns a new list (never mutates). */
export function editManual(list, body, nowMs, newId) {
  const op = body && body.op
  if (op === 'add') {
    const name = clean(body.name)
    if (!name) throw new HttpError(400, 'name_required')
    if (chars(name).length > 40) throw new HttpError(400, 'name_too_long')
    if (list.length >= MANUAL_MAX) throw new HttpError(400, 'too_many')
    const display = DISPLAYS.includes(body.display) ? body.display : 'masked'
    const at = /^\d{4}-\d{2}-\d{2}$/.test(body.at || '') ? body.at : cnDate(nowMs)
    return [...list, { id: newId, name, display, msg: clean(body.msg).slice(0, 200), at }]
  }
  const idx = list.findIndex((e) => e.id === body.id)
  if (idx === -1) throw new HttpError(404, 'no_such_entry')
  if (op === 'remove') return list.filter((_, i) => i !== idx)
  if (op === 'update') {
    const cur = list[idx]
    const next = { ...cur }
    if (body.display !== undefined) {
      if (!DISPLAYS.includes(body.display)) throw new HttpError(400, 'bad_display')
      next.display = body.display
    }
    if (body.name !== undefined) {
      const name = clean(body.name)
      if (!name || chars(name).length > 40) throw new HttpError(400, 'bad_name')
      next.name = name
    }
    if (body.msg !== undefined) next.msg = clean(body.msg).slice(0, 200)
    return list.map((e, i) => (i === idx ? next : e))
  }
  throw new HttpError(400, 'bad_op')
}

// ── building the public file ─────────────────────────────────────────────

/**
 * Everything → the public wall. Pure. `hidden` holds internal keys; a hidden
 * donor also takes their notes down with them.
 */
export function buildWall({ afdian, manual, hidden, nowMs }) {
  const hideDonor = new Set((hidden && hidden.donors) || [])
  const hidePost = new Set((hidden && hidden.posts) || [])
  const wechat = (manual || []).map(manualDonor)
  const donors = [...((afdian && afdian.donors) || []), ...wechat]
    .filter((d) => !hideDonor.has(d.key) && Number.isFinite(d.first))
    .sort((a, b) => b.first - a.first)
  const wechatPosts = (manual || [])
    .map((e) => {
      const d = manualDonor(e)
      const msg = displayMessage(e.msg)
      return msg ? { key: d.key, donor: d.key, via: 'wechat', at: d.first, msg, name: d.name, avatar: null } : null
    })
    .filter(Boolean)
  const posts = [...((afdian && afdian.posts) || []), ...wechatPosts]
    .filter((p) => !hidePost.has(p.key) && !hideDonor.has(p.donor))
    .sort((a, b) => b.at - a.at)
  return {
    schema: 1,
    asOf: new Date(nowMs).toISOString(),
    total: donors.length,
    donors: donors.map((d) => ({ name: d.name, avatar: d.avatar, since: cnDate(d.first).slice(0, 7), via: d.via })),
    posts: posts.slice(0, POSTS_SHOWN).map((p) => ({ name: p.name, avatar: p.avatar, via: p.via, at: cnDate(p.at), msg: p.msg }))
  }
}

// ── storage + runs ───────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
  }
}

async function kvJson(env, key, fallback) {
  const v = await env.DONORS.get(key, 'json')
  return v == null ? fallback : v
}

/** Build the wall from KV; `write: false` (the panel just looking) leaves the CDN file alone. */
async function publish(env, nowMs, { write = true } = {}) {
  const [afdian, manual, hidden] = await Promise.all([
    kvJson(env, 'afdian-cache', null),
    kvJson(env, 'manual', []),
    kvJson(env, 'hidden', { donors: [], posts: [] })
  ])
  const wall = buildWall({ afdian, manual, hidden, nowMs })
  if (!write) return { wall, afdian, manual, hidden }
  await env.CDN.put(PUBLIC_KEY, JSON.stringify(wall), {
    httpMetadata: { contentType: 'application/json', cacheControl: 'public, max-age=300' }
  })
  return { wall, afdian, manual, hidden }
}

/** Re-read afdian (a failure keeps the last good read), then publish. */
export async function run(env, fetchImpl, nowMs) {
  let error = null
  try {
    const fresh = await readAfdian(fetchImpl, env, nowMs)
    await env.DONORS.put('afdian-cache', JSON.stringify(fresh))
  } catch (err) {
    error = String((err && err.message) || err)
    console.log('donor-wall: afdian read failed, kept last good', error)
  }
  return { ...(await publish(env, nowMs)), error }
}

function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

function adminView(state, error) {
  return {
    ok: true,
    error: error || null,
    wall: state.wall,
    manual: state.manual,
    hidden: state.hidden,
    afdian: state.afdian
      ? { fetchedAt: state.afdian.fetchedAt, donors: state.afdian.donors, posts: state.afdian.posts, skipped: state.afdian.skipped }
      : null
  }
}

export async function handleAdmin(request, env, fetchImpl, nowMs) {
  const auth = request.headers.get('authorization') || ''
  if (!env.ADMIN_KEY || env.ADMIN_KEY.length < 24 || !timingSafeEqual(auth, `Bearer ${env.ADMIN_KEY}`)) {
    return new Response('Not found', { status: 404 })
  }
  const { pathname } = new URL(request.url)
  try {
    if (request.method === 'GET' && pathname === '/admin/state') {
      return reply(200, adminView(await publish(env, nowMs, { write: false })))
    }
    if (request.method !== 'POST') return reply(405, { ok: false, error: 'method_not_allowed' })
    const body = await request.json().catch(() => null)
    if (pathname === '/admin/refresh') {
      const state = await run(env, fetchImpl, nowMs)
      return reply(200, adminView(state, state.error))
    }
    if (!body || typeof body !== 'object') return reply(400, { ok: false, error: 'bad_json' })
    if (pathname === '/admin/manual') {
      const list = await kvJson(env, 'manual', [])
      await env.DONORS.put('manual', JSON.stringify(editManual(list, body, nowMs, crypto.randomUUID().slice(0, 8))))
      if (body.op === 'remove') {
        // A removed entry's hide flags would otherwise linger forever.
        const key = `wechat:${body.id}`
        const hidden = await kvJson(env, 'hidden', { donors: [], posts: [] })
        const drop = (xs) => (xs || []).filter((k) => k !== key)
        await env.DONORS.put('hidden', JSON.stringify({ ...hidden, donors: drop(hidden.donors), posts: drop(hidden.posts) }))
      }
      return reply(200, adminView(await publish(env, nowMs)))
    }
    if (pathname === '/admin/hide') {
      const kind = body.kind === 'donor' ? 'donors' : body.kind === 'post' ? 'posts' : null
      if (!kind || typeof body.key !== 'string' || !/^(afdian|wechat):[\w-]{1,64}$/.test(body.key)) {
        return reply(400, { ok: false, error: 'bad_key' })
      }
      const hidden = await kvJson(env, 'hidden', { donors: [], posts: [] })
      const set = new Set(hidden[kind] || [])
      if (body.hidden) set.add(body.key)
      else set.delete(body.key)
      await env.DONORS.put('hidden', JSON.stringify({ ...hidden, [kind]: [...set] }))
      return reply(200, adminView(await publish(env, nowMs)))
    }
    return reply(404, { ok: false, error: 'unknown_action' })
  } catch (err) {
    if (err instanceof HttpError) return reply(err.status, { ok: false, error: err.message })
    console.log('donor-wall admin error', err)
    return reply(500, { ok: false, error: 'internal' })
  }
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(run(env, fetch, Date.now()))
  },
  async fetch(request, env) {
    return handleAdmin(request, env, fetch, Date.now())
  }
}
