/* Tests for assets/account-view.js — what account.html shows for each RPC payload.
   Run with `npm test`. Times are built from local Date parts so the tests
   pass in any time zone. */

const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')

const View = require(path.join(__dirname, '..', 'assets', 'account-view.js'))

const NOW = Date.parse('2026-10-17T12:00:00Z')
const inDays = (d) => new Date(NOW + d * 86400000).toISOString()

test('member: free account', () => {
  const m = View.member({ ok: true, tier: 'free', source: 'code', period_end: null }, NOW)
  assert.strictEqual(m.tier, '免费版')
  assert.strictEqual(m.tone, 'free')
  assert.strictEqual(m.source, '')
})

test('member: Pro with an end date shows the date and days left', () => {
  const end = inDays(30)
  const m = View.member({ ok: true, tier: 'pro', source: 'afdian', period_end: end }, NOW)
  assert.strictEqual(m.tier, 'Pro 版')
  assert.strictEqual(m.expiry, '有效期至 ' + View.localDate(end) + '（还剩 30 天）')
  assert.strictEqual(m.source, '开通方式：爱发电')
})

test('member: Pro without an end date is permanent', () => {
  assert.strictEqual(View.member({ ok: true, tier: 'pro', period_end: null }, NOW).expiry, '长期有效')
})

test('member: banned account says so instead of showing a tier', () => {
  const m = View.member({ ok: false, reason: 'banned' }, NOW)
  assert.strictEqual(m.banned, true)
  assert.strictEqual(m.tone, 'bad')
})

test('member: unreadable payload is null, so the page shows an error, not "free"', () => {
  assert.strictEqual(View.member(null, NOW), null)
  assert.strictEqual(View.member({ ok: false, reason: 'unauthenticated' }, NOW), null)
})

test('quotas: chars and minutes, with usage percent', () => {
  const rows = View.quotas({
    ok: true,
    quotas: {
      translate_chars: { used: 1500, limit: 2000, reset_at: null },
      voice_seconds: { used: 30, limit: 300, reset_at: null },
      bp_voice_seconds: { used: 900, limit: 600, reset_at: null }
    }
  })
  assert.deepStrictEqual(rows.map((r) => r.text), [
    '已用 1,500 / 2,000 字',
    '已用 <1 / 5 分钟',
    '已用 15 / 10 分钟'
  ])
  assert.deepStrictEqual(rows.map((r) => r.percent), [75, 10, 100])
})

test('quotas: a row with missing numbers is left out rather than shown as 0', () => {
  const rows = View.quotas({ ok: true, quotas: { translate_chars: { used: 0, limit: null }, voice_seconds: {} } })
  assert.deepStrictEqual(rows, [])
  assert.deepStrictEqual(View.quotas({ ok: false, reason: 'banned' }), [])
  assert.deepStrictEqual(View.quotas(null), [])
})

test('orders: every status gets a label; donations and refunds read right', () => {
  const rows = View.orders([
    { order_tail: '331170', total_amount: '188.00', status: 'fulfilled', days: 365, created_at: '2026-10-17T02:45:52Z' },
    { order_tail: '415331', total_amount: 19.9, status: 'donation', days: null, created_at: '2026-10-16T02:41:01Z' },
    { order_tail: '000001', total_amount: '1.00', status: 'refunded', days: 1, created_at: '2026-10-15T00:00:00Z' },
    { order_tail: '000002', total_amount: '10.00', status: 'amount_mismatch', days: null, created_at: '2026-10-14T00:00:00Z' },
    { order_tail: '000003', total_amount: '10.00', status: 'something_new', days: null, created_at: '2026-10-13T00:00:00Z' }
  ])
  assert.deepStrictEqual(rows.map((r) => [r.title, r.amount, r.order, r.status, r.tone]), [
    ['Pro 会员 · 365 天', '¥188', '尾号 331170', '已开通', 'ok'],
    ['赞助', '¥19.9', '尾号 415331', '已收到，感谢支持', 'ok'],
    ['Pro 会员 · 1 天', '¥1', '尾号 000001', '已退款', 'muted'],
    ['Pro 会员', '¥10', '尾号 000002', '金额不符，等待人工处理', 'warn'],
    ['Pro 会员', '¥10', '尾号 000003', '处理中', 'warn']
  ])
})

test('orders: malformed rows are dropped', () => {
  assert.deepStrictEqual(View.orders(null), [])
  assert.deepStrictEqual(View.orders([null, { status: 'fulfilled' }, 'x']), [])
})

test('authError: maps Supabase messages to plain Chinese', () => {
  assert.match(View.authError('Failed to fetch'), /连不上服务器/)
  assert.strictEqual(View.authError('Invalid login credentials'), '邮箱或密码不对。')
  assert.match(View.authError('User already registered'), /已经注册过/)
  assert.strictEqual(View.authError('Password should be at least 6 characters'), '密码至少 6 位。')
  assert.match(View.authError('weird'), /^出错了：weird$/)
})
