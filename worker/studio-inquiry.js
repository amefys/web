/**
 * studio-inquiry — the contact form on /studio/ (2026-10-17).
 *
 * POST https://amefys.com/api/studio  (Worker route on the amefys.com zone, so
 * the form posts same-origin: no CORS, and no workers.dev hostname, which is
 * often unreachable from mainland China). The amefys.cn mirror (ali-99) posts
 * here cross-origin (ALLOWED_ORIGINS), so inquiries stay in one place and the
 * per-IP limit sees the visitor, not a proxy.
 *
 * Order matters: validate → Turnstile → rate limit → store → email.
 * The inquiry is written to KV *before* the email goes out, so a Resend outage
 * or a missing key never loses one; the response still says "received" and the
 * stored copy can be read back with `wrangler kv key list --binding INQUIRIES`.
 *
 * Bindings: KV namespace as INQUIRIES.
 * Secrets: TURNSTILE_SECRET (widget "amefys studio"), RESEND_API_KEY (optional
 * until set — without it inquiries are only stored).
 * Vars: RESEND_FROM (e.g. "AMEFYS 工作室 <studio@amefys.com>"), NOTIFY_TO.
 * Deploy: worker/deploy-studio-inquiry.sh. Tests: tests/studio-inquiry.test.cjs.
 */

export const LIMITS = { name: 40, contact: 80, background: 1500, problem: 1500, budget: 40, when: 40 }
const REQUIRED = ['name', 'contact', 'background', 'problem']
/** Per-IP submissions allowed per hour. */
export const PER_HOUR = 5
const KEEP_SECONDS = 400 * 24 * 3600

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })

/** Trimmed, length-checked fields, or an error code for the client. */
export function validate(body) {
  if (!body || typeof body !== 'object') return { error: 'bad_request' }
  if (body.website) return { error: 'bad_request' } // honeypot: humans never see this field
  const out = {}
  for (const [k, max] of Object.entries(LIMITS)) {
    const v = typeof body[k] === 'string' ? body[k].trim() : ''
    if (v.length > max) return { error: 'too_long', field: k }
    out[k] = v
  }
  for (const k of REQUIRED) if (!out[k]) return { error: 'missing', field: k }
  return { fields: out }
}

async function verifyTurnstile(fetchImpl, secret, token, ip) {
  if (!secret || !token) return false
  const form = new FormData()
  form.append('secret', secret)
  form.append('response', token)
  if (ip) form.append('remoteip', ip)
  try {
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
    const data = await res.json()
    return data.success === true
  } catch {
    return false
  }
}

export function emailText(f, meta) {
  return [
    `称呼：${f.name}`,
    `联系方式：${f.contact}`,
    '',
    '项目背景：',
    f.background,
    '',
    '想解决的问题：',
    f.problem,
    '',
    `预算区间：${f.budget || '未填'}`,
    `希望开始时间：${f.when || '未填'}`,
    '',
    `— 提交于 ${meta.at}（${meta.country || '未知地区'}），记录 ${meta.key}`
  ].join('\n')
}

async function sendEmail(fetchImpl, env, f, meta) {
  if (!env.RESEND_API_KEY) return 'skipped'
  const replyTo = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.contact) ? f.contact : undefined
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: [env.NOTIFY_TO],
        subject: `[工作室咨询] ${f.name}`,
        text: emailText(f, meta),
        ...(replyTo ? { reply_to: replyTo } : {})
      })
    })
    return res.ok ? 'sent' : `failed:${res.status}`
  } catch {
    return 'failed'
  }
}

/** Other sites whose /studio/ page posts here: the amefys.cn mirror. */
export const ALLOWED_ORIGINS = ['https://amefys.cn']

function corsHeaders(request) {
  const origin = request.headers.get('origin')
  return origin && ALLOWED_ORIGINS.includes(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : null
}

export async function handle(request, env, deps = {}) {
  const cors = corsHeaders(request)
  if (request.method === 'OPTIONS' && cors) {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'access-control-allow-methods': 'POST',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '86400'
      }
    })
  }
  const res = await respond(request, env, deps)
  if (cors) for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
  return res
}

async function respond(request, env, deps) {
  const fetchImpl = deps.fetch || fetch
  const now = deps.now || Date.now()
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method' })

  let body
  try {
    body = await request.json()
  } catch {
    return json(400, { ok: false, error: 'bad_request' })
  }
  const v = validate(body)
  if (v.error) return json(400, { ok: false, error: v.error, field: v.field })

  const ip = request.headers.get('cf-connecting-ip') || ''
  if (!(await verifyTurnstile(fetchImpl, env.TURNSTILE_SECRET, body.turnstile, ip))) {
    return json(403, { ok: false, error: 'captcha' })
  }

  const hour = new Date(now).toISOString().slice(0, 13)
  const rlKey = `rl:${hour}:${ip}`
  const count = Number((await env.INQUIRIES.get(rlKey)) || 0)
  if (count >= PER_HOUR) return json(429, { ok: false, error: 'rate_limited' })
  await env.INQUIRIES.put(rlKey, String(count + 1), { expirationTtl: 3600 })

  const at = new Date(now).toISOString()
  const key = `inq:${at}:${Math.random().toString(36).slice(2, 8)}`
  const country = (request.cf && request.cf.country) || ''
  await env.INQUIRIES.put(key, JSON.stringify({ ...v.fields, at, country, ua: request.headers.get('user-agent') || '' }), {
    expirationTtl: KEEP_SECONDS
  })

  const email = await sendEmail(fetchImpl, env, v.fields, { at, country, key })
  return json(200, { ok: true, email })
}

export default {
  fetch(request, env) {
    return handle(request, env)
  }
}
