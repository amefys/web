// donor-wall Worker (2026-10-24): the donate page's wall. The public file is
// readable by anyone, so most of these lock down what must never reach it.
const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')

const load = () => import('../worker/donor-wall.js')
const NOW = Date.parse('2026-10-24T08:00:00Z')
const md5 = async (t) => createHash('md5').update(t).digest('hex')
const DONATE = 'd415338ac9eb11f1bb1952540025c377'
const MEMBER = '63b07748bc0e11f1add252540025c377'
const GOODS = '428e16ecbc0e11f1b25852540025c377'
const ADMIN_KEY = 'k'.repeat(32)
const sec = (iso) => Math.floor(Date.parse(iso) / 1000)

const user = (id, name, avatar = 'https://pic1.afdiancdn.com/default/avatar/avatar-purple.png?imageView2/1/') => ({ user: { user_id: id, name, avatar } })
const order = (o) => ({ status: 2, product_type: 0, plan_id: DONATE, plan_title: '核心赞助者', total_amount: '199.00', show_amount: '199.00', address_person: '张三', address_phone: '13800138000', address_address: '某市某路 1 号', ...o })

function fakeEnv(extra = {}) {
  const kv = new Map()
  const r2 = new Map()
  return {
    kv,
    r2,
    env: {
      AFDIAN_USER_ID: 'me',
      AFDIAN_API_TOKEN: 'tok',
      DONATION_PLAN_IDS: DONATE,
      ADMIN_KEY,
      md5,
      DONORS: {
        get: async (k, type) => (kv.has(k) ? (type === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null),
        put: async (k, v) => void kv.set(k, v)
      },
      CDN: { put: async (k, v, opts) => void r2.set(k, { v, opts }) },
      ...extra
    }
  }
}

function afdianFetch({ sponsors = [], orders = [], fail = false } = {}) {
  const calls = []
  const f = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url, body })
    if (fail) return new Response('bad gateway', { status: 502 })
    const list = url.endsWith('/query-sponsor') ? sponsors : orders
    return new Response(JSON.stringify({ ec: 200, data: { list, total_page: 1 } }))
  }
  return { f, calls }
}

test('only donation orders count: membership, goods and unpaid orders are left off', async () => {
  const { shapeAfdian } = await load()
  const plans = new Set([DONATE])
  const { donors, skipped } = shapeAfdian(
    [user('a', '晚风'), user('b', '买会员的人'), user('c', '买东西的人'), user('d', '自选金额')],
    [
      order({ user_id: 'a', out_trade_no: '1001', create_time: sec('2026-10-23T10:00:00Z') }),
      order({ user_id: 'b', out_trade_no: '1002', plan_id: MEMBER, plan_title: 'Pro 月卡', create_time: sec('2026-10-23T10:00:00Z') }),
      order({ user_id: 'c', out_trade_no: '1003', plan_id: GOODS, product_type: 1, plan_title: '测试商品', create_time: sec('2026-10-17T10:00:00Z') }),
      order({ user_id: 'a', out_trade_no: '1004', status: 1, create_time: sec('2026-10-01T10:00:00Z') }),
      order({ user_id: 'd', out_trade_no: '1005', plan_id: '', plan_title: '', create_time: sec('2026-10-20T10:00:00Z') })
    ],
    plans
  )
  assert.deepEqual(donors.map((d) => d.name).sort(), ['晚风', '自选金额'])
  assert.equal(skipped[`Pro 月卡 · ${MEMBER}`], 1)
  assert.equal(skipped[`测试商品 · ${GOODS}`], 1)
})

test('default nickname and default avatar are anonymous; custom ones show; 匿名 in a note hides both', async () => {
  const { shapeAfdian } = await load()
  const custom = 'https://pic1.afdiancdn.com/user/abc/avatar/xyz.jpg?imageView2/1/w/120'
  const { donors } = shapeAfdian(
    [user('a', '爱发电用户_3f9a2'), user('b', '晚风', custom), user('c', 'Kael'), user('d', '五号位', custom)],
    [
      order({ user_id: 'a', out_trade_no: '1', create_time: sec('2026-10-01T00:00:00Z') }),
      order({ user_id: 'b', out_trade_no: '2', create_time: sec('2026-10-02T00:00:00Z') }),
      order({ user_id: 'c', out_trade_no: '3', create_time: sec('2026-10-03T00:00:00Z') }),
      order({ user_id: 'd', out_trade_no: '4', remark: '匿名 加油', create_time: sec('2026-10-04T00:00:00Z') })
    ],
    new Set([DONATE])
  )
  const by = Object.fromEntries(donors.map((d) => [d.key, d]))
  assert.deepEqual([by['afdian:a'].name, by['afdian:a'].avatar], [null, null])
  assert.deepEqual([by['afdian:b'].name, by['afdian:b'].avatar], ['晚风', 'https://pic1.afdiancdn.com/user/abc/avatar/xyz.jpg'])
  assert.deepEqual([by['afdian:c'].name, by['afdian:c'].avatar], ['Kael', null])
  assert.deepEqual([by['afdian:d'].name, by['afdian:d'].avatar], [null, null])
})

test('avatars: only https on afdiancdn.com, never a default one', async () => {
  const { displayAvatar } = await load()
  assert.equal(displayAvatar('http://pic1.afdiancdn.com/user/a.jpg'), null)
  assert.equal(displayAvatar('https://evil.example/a.jpg'), null)
  assert.equal(displayAvatar('https://afdiancdn.com.evil.example/a.jpg'), null)
  assert.equal(displayAvatar('javascript:alert(1)'), null)
  assert.equal(displayAvatar('https://pic1.afdiancdn.com/default/avatar/avatar-orange.png'), null)
})

test('the public file never carries amounts, plans, payer ids, trade numbers or addresses', async () => {
  const { run } = await load()
  const { env, r2 } = fakeEnv()
  const { f } = afdianFetch({
    sponsors: [user('payer-secret-id', '晚风')],
    orders: [order({ user_id: 'payer-secret-id', out_trade_no: '20261023999', remark: '翻译救了我好几局', create_time: sec('2026-10-23T10:00:00Z') })]
  })
  await run(env, f, NOW)
  const text = r2.get('donors.json').v
  for (const leak of ['199', 'payer-secret-id', '20261023999', DONATE, '核心赞助者', '13800138000', '张三', '某市', 'amount', 'plan']) {
    assert.ok(!text.includes(leak), `public file leaks ${leak}`)
  }
  const wall = JSON.parse(text)
  assert.deepEqual(wall.donors, [{ name: '晚风', avatar: null, since: '2026-10', via: 'afdian' }])
  assert.deepEqual(wall.posts, [{ name: '晚风', avatar: null, via: 'afdian', at: '2026-10-23', msg: '翻译救了我好几局' }])
  assert.equal(r2.get('donors.json').opts.httpMetadata.cacheControl, 'public, max-age=300')
})

test('notes: contact details, ads and abuse are dropped; trash-talk praise and plain notes go up', async () => {
  const { displayMessage } = await load()
  for (const bad of ['加我 qq 12345678', '加我vx', '看 https://x.cn', 'www.abc.com 便宜代练', '联系 a@b.cc', '傻逼开发者', 'fuck this', '13800138000']) {
    assert.equal(displayMessage(bad), null, bad)
  }
  assert.equal(displayMessage('垃圾话翻译好用'), '垃圾话翻译好用')
  assert.equal(displayMessage('usb 鼠标也能用'), 'usb 鼠标也能用')
  assert.equal(displayMessage('匿名'), null)
  assert.equal(displayMessage('匿名，加油'), '加油')
  assert.equal(displayMessage('AMF-7K3Q9X 谢谢'), '谢谢')
  assert.equal(displayMessage('a‮b​ c'), 'ab c')
  const long = displayMessage('好'.repeat(80))
  assert.equal(Array.from(long).length, 60)
  assert.ok(long.endsWith('…'))
})

test('names: trimmed to 20, contact-looking or abusive names become anonymous', async () => {
  const { displayName } = await load()
  assert.equal(Array.from(displayName('长'.repeat(30))).length, 20)
  assert.equal(displayName('qq12345678'), null)
  assert.equal(displayName('傻逼'), null)
  assert.equal(displayName('   '), null)
  // kept as plain text; the page renders it with textContent
  assert.equal(displayName('<img src=x onerror=alert(1)>'), '<img src=x onerror=…')
})

test('afdian failure keeps the last good read instead of emptying the wall', async () => {
  const { run } = await load()
  const { env, r2 } = fakeEnv()
  const good = afdianFetch({ sponsors: [user('a', '晚风')], orders: [order({ user_id: 'a', out_trade_no: '1', create_time: sec('2026-10-23T10:00:00Z') })] })
  await run(env, good.f, NOW)
  const res = await run(env, afdianFetch({ fail: true }).f, NOW + 3600e3)
  assert.match(res.error, /HTTP 502/)
  assert.equal(JSON.parse(r2.get('donors.json').v).total, 1)
})

test('requests are signed the way afdian documents: md5(token params ts user_id)', async () => {
  const { run } = await load()
  const { env } = fakeEnv()
  const { f, calls } = afdianFetch()
  await run(env, f, NOW)
  const c = calls[0]
  assert.equal(c.body.user_id, 'me')
  assert.equal(c.body.sign, await md5(`tokparams${c.body.params}ts${c.body.ts}user_idme`))
  assert.deepEqual(JSON.parse(c.body.params), { page: 1, per_page: 100 })
})

test('wechat entries: masked by default, full or anonymous on request, newest first with afdian', async () => {
  const { buildWall, editManual } = await load()
  let list = editManual([], { op: 'add', name: '柠檬', msg: 'BP 推荐好用', at: '2026-10-22' }, NOW, 'w1')
  list = editManual(list, { op: 'add', name: '北方的狼', display: 'full', at: '2026-09-02' }, NOW, 'w2')
  list = editManual(list, { op: 'add', name: '小林', display: 'anon', at: '2026-08-01' }, NOW, 'w3')
  const afdian = { donors: [{ key: 'afdian:a', via: 'afdian', first: Date.parse('2026-10-23T10:00:00Z'), name: '晚风', avatar: null }], posts: [] }
  const wall = buildWall({ afdian, manual: list, hidden: null, nowMs: NOW })
  assert.deepEqual(wall.donors.map((d) => [d.name, d.via, d.since]), [
    ['晚风', 'afdian', '2026-10'],
    ['柠*', 'wechat', '2026-10'],
    ['北方的狼', 'wechat', '2026-09'],
    [null, 'wechat', '2026-08']
  ])
  assert.deepEqual(wall.posts, [{ name: '柠*', avatar: null, via: 'wechat', at: '2026-10-22', msg: 'BP 推荐好用' }])
  assert.equal(wall.total, 4)
})

test('editManual never mutates and rejects bad input', async () => {
  const { editManual } = await load()
  const list = Object.freeze([Object.freeze({ id: 'w1', name: '柠檬', display: 'masked', msg: '', at: '2026-10-22' })])
  const next = editManual(list, { op: 'update', id: 'w1', display: 'full' }, NOW, 'x')
  assert.equal(next[0].display, 'full')
  assert.equal(list[0].display, 'masked')
  assert.throws(() => editManual(list, { op: 'add', name: '' }, NOW, 'x'), /name_required/)
  assert.throws(() => editManual(list, { op: 'update', id: 'w1', display: 'gold' }, NOW, 'x'), /bad_display/)
  assert.throws(() => editManual(list, { op: 'remove', id: 'nope' }, NOW, 'x'), /no_such_entry/)
  assert.equal(editManual(list, { op: 'add', name: '新朋友' }, NOW, 'w2')[1].at, '2026-10-24')
})

test('hiding a donor also takes their notes down; hiding a note leaves the donor', async () => {
  const { buildWall } = await load()
  const at = Date.parse('2026-10-23T10:00:00Z')
  const afdian = {
    donors: [{ key: 'afdian:a', via: 'afdian', first: at, name: '晚风', avatar: null }, { key: 'afdian:b', via: 'afdian', first: at - 1, name: 'Kael', avatar: null }],
    posts: [{ key: 'afdian:1', donor: 'afdian:a', via: 'afdian', at, msg: '一', name: '晚风', avatar: null }, { key: 'afdian:2', donor: 'afdian:b', via: 'afdian', at, msg: '二', name: 'Kael', avatar: null }]
  }
  const w1 = buildWall({ afdian, manual: [], hidden: { donors: ['afdian:a'], posts: [] }, nowMs: NOW })
  assert.deepEqual(w1.donors.map((d) => d.name), ['Kael'])
  assert.deepEqual(w1.posts.map((p) => p.msg), ['二'])
  const w2 = buildWall({ afdian, manual: [], hidden: { donors: [], posts: ['afdian:2'] }, nowMs: NOW })
  assert.equal(w2.total, 2)
  assert.deepEqual(w2.posts.map((p) => p.msg), ['一'])
})

test('a tip just after midnight China time belongs to the new month', async () => {
  const { buildWall } = await load()
  const first = Date.parse('2026-09-30T16:30:00Z') // 2026-10-01 00:30 in Shanghai
  const wall = buildWall({ afdian: { donors: [{ key: 'afdian:a', via: 'afdian', first, name: 'x', avatar: null }], posts: [] }, manual: [], hidden: null, nowMs: NOW })
  assert.equal(wall.donors[0].since, '2026-10')
})

test('admin endpoint: wrong or missing key looks like nothing is there', async () => {
  const { handleAdmin } = await load()
  const { env } = fakeEnv()
  for (const auth of [null, 'Bearer nope', `Bearer ${ADMIN_KEY}x`, ADMIN_KEY]) {
    const headers = auth ? { authorization: auth } : {}
    const res = await handleAdmin(new Request('https://w/admin/state', { headers }), env, afdianFetch().f, NOW)
    assert.equal(res.status, 404, String(auth))
  }
  const weak = fakeEnv({ ADMIN_KEY: 'short' })
  const res = await handleAdmin(new Request('https://w/admin/state', { headers: { authorization: 'Bearer short' } }), weak.env, afdianFetch().f, NOW)
  assert.equal(res.status, 404)
})

test('admin endpoint: add, hide and refresh all republish the public file', async () => {
  const { handleAdmin } = await load()
  const { env, r2 } = fakeEnv()
  const auth = { authorization: `Bearer ${ADMIN_KEY}`, 'content-type': 'application/json' }
  const post = (path, body) => handleAdmin(new Request(`https://w${path}`, { method: 'POST', headers: auth, body: JSON.stringify(body) }), env, afdianFetch().f, NOW)

  let res = await post('/admin/manual', { op: 'add', name: '柠檬', msg: '加油' })
  assert.equal(res.status, 200)
  const state = await res.json()
  assert.equal(state.manual.length, 1)
  assert.deepEqual(JSON.parse(r2.get('donors.json').v).donors.map((d) => d.name), ['柠*'])

  res = await post('/admin/hide', { kind: 'donor', key: `wechat:${state.manual[0].id}`, hidden: true })
  assert.equal(res.status, 200)
  assert.equal(JSON.parse(r2.get('donors.json').v).total, 0)

  res = await post('/admin/hide', { kind: 'donor', key: '../../etc', hidden: true })
  assert.equal(res.status, 400)
  res = await post('/admin/manual', { op: 'add', name: '' })
  assert.equal(res.status, 400)

  res = await post('/admin/refresh', {})
  assert.equal(res.status, 200)
  assert.equal((await res.json()).error, null)
})

test('admin GET /admin/state only reads: the public file is not rewritten', async () => {
  const { handleAdmin } = await load()
  const { env, r2 } = fakeEnv()
  const res = await handleAdmin(new Request('https://w/admin/state', { headers: { authorization: `Bearer ${ADMIN_KEY}` } }), env, afdianFetch().f, NOW)
  assert.equal(res.status, 200)
  assert.equal((await res.json()).wall.total, 0)
  assert.equal(r2.has('donors.json'), false)
})

test('removing a WeChat entry also clears its hide flags', async () => {
  const { handleAdmin } = await load()
  const { env, kv } = fakeEnv()
  const auth = { authorization: `Bearer ${ADMIN_KEY}`, 'content-type': 'application/json' }
  const post = (path, body) => handleAdmin(new Request(`https://w${path}`, { method: 'POST', headers: auth, body: JSON.stringify(body) }), env, afdianFetch().f, NOW)
  const { manual } = await (await post('/admin/manual', { op: 'add', name: '柠檬', msg: '加油' })).json()
  const key = `wechat:${manual[0].id}`
  await post('/admin/hide', { kind: 'donor', key, hidden: true })
  await post('/admin/hide', { kind: 'post', key, hidden: true })
  await post('/admin/hide', { kind: 'donor', key: 'afdian:keep', hidden: true })
  await post('/admin/manual', { op: 'remove', id: manual[0].id })
  assert.deepEqual(JSON.parse(kv.get('hidden')), { donors: ['afdian:keep'], posts: [] })
})
