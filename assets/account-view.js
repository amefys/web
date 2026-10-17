/* What account.html shows, apart from the DOM so it can be tested
   (tests/account-view.test.cjs). Every function takes the raw RPC payload and
   returns plain strings; account.js puts them on the page with textContent.

   Sources (all in the amefys repo, supabase/migrations):
     get_entitlements()        → member card + today's quotas
     get_my_payment_orders()   → order list (last 50, order number tail only)
     get_or_create_purchase_ref() → the AMF- code to paste into afdian */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.AccountView = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  var TIER = { free: '免费版', pro: 'Pro 版', custom: '定制版' }
  var SOURCE = { afdian: '爱发电', code: '激活码', manual: '人工开通', stripe: '在线支付' }

  function pad(n) { return n < 10 ? '0' + n : String(n) }

  /** "2026-10-17" in the viewer's own time zone. */
  function localDate(iso) {
    var d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  }

  function localDateTime(iso) {
    var d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return localDate(iso) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  }

  function num(n) { return Number(n).toLocaleString('en-US') }

  /** Seconds as whole minutes; anything under a minute but above zero is "<1". */
  function minutes(s) {
    var v = Number(s) || 0
    if (v <= 0) return '0'
    if (v < 60) return '<1'
    return num(Math.floor(v / 60))
  }

  /** Member card. Null when the payload is not something we can read. */
  function member(ent, now) {
    if (!ent || typeof ent !== 'object') return null
    if (ent.ok === false) {
      return ent.reason === 'banned'
        ? { banned: true, tier: '账号已停用', tone: 'bad', expiry: '如有疑问请发邮件到 amefys@gmail.com' }
        : null
    }
    var tier = typeof ent.tier === 'string' ? ent.tier : 'free'
    var paid = tier !== 'free'
    var expiry = ''
    if (paid) {
      if (ent.period_end) {
        var left = Math.ceil((Date.parse(ent.period_end) - (now || Date.now())) / 86400000)
        expiry = '有效期至 ' + localDate(ent.period_end) + (left > 0 ? '（还剩 ' + left + ' 天）' : '')
      } else {
        expiry = '长期有效'
      }
    } else {
      expiry = '免费版额度每天重置'
    }
    return {
      banned: false,
      tier: TIER[tier] || tier,
      tone: paid ? 'pro' : 'free',
      expiry: expiry,
      source: paid && SOURCE[ent.source] ? '开通方式：' + SOURCE[ent.source] : ''
    }
  }

  var QUOTAS = [
    { key: 'translate_chars', label: '聊天翻译', unit: '字', fmt: num },
    { key: 'voice_seconds', label: '聊天语音输入', unit: '分钟', fmt: minutes },
    { key: 'bp_voice_seconds', label: 'BP 语音录入', unit: '分钟', fmt: minutes }
  ]

  /** Today's quotas. A row whose numbers are missing is left out, never shown as 0. */
  function quotas(ent) {
    var q = ent && ent.ok !== false && ent.quotas
    if (!q || typeof q !== 'object') return []
    var rows = []
    for (var i = 0; i < QUOTAS.length; i++) {
      var spec = QUOTAS[i]
      var r = q[spec.key]
      if (!r || typeof r !== 'object') continue
      var used = Number(r.used)
      var limit = Number(r.limit)
      if (!isFinite(used) || !isFinite(limit) || limit <= 0) continue
      rows.push({
        label: spec.label,
        text: '已用 ' + spec.fmt(used) + ' / ' + spec.fmt(limit) + ' ' + spec.unit,
        percent: Math.max(0, Math.min(100, Math.round((used / limit) * 100))),
        reset: r.reset_at ? '下次重置 ' + localDateTime(r.reset_at) : ''
      })
    }
    return rows
  }

  var STATUS = {
    fulfilled: { text: '已开通', tone: 'ok' },
    donation: { text: '已收到，感谢支持', tone: 'ok' },
    refunded: { text: '已退款', tone: 'muted' },
    amount_mismatch: { text: '金额不符，等待人工处理', tone: 'warn' },
    unknown_plan: { text: '等待人工处理', tone: 'warn' },
    unmatched: { text: '等待人工处理', tone: 'warn' }
  }

  /** Order list rows, newest first as the RPC returns them. Malformed rows are dropped. */
  function orders(rows) {
    if (!Array.isArray(rows)) return []
    var out = []
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i]
      if (!r || typeof r !== 'object' || typeof r.order_tail !== 'string') continue
      var st = STATUS[r.status] || { text: '处理中', tone: 'warn' }
      var days = Number(r.days)
      var title = r.status === 'donation' ? '赞助' : days > 0 ? 'Pro 会员 · ' + days + ' 天' : 'Pro 会员'
      var amount = Number(r.total_amount)
      out.push({
        date: localDateTime(r.created_at),
        title: title,
        amount: isFinite(amount) ? '¥' + String(Math.round(amount * 100) / 100) : '',
        order: '尾号 ' + r.order_tail,
        status: st.text,
        tone: st.tone
      })
    }
    return out
  }

  /** Supabase auth error message → what to tell the player (mirrors the app's auth-error.ts). */
  function authError(raw) {
    var s = String(raw || '').toLowerCase()
    if (/failed to fetch|load failed|networkerror|network error|timeout|fetch failed/.test(s)) {
      return '连不上服务器。请检查网络；如果是手机浏览器，换系统自带浏览器或电脑再试。'
    }
    if (s.indexOf('invalid login credentials') >= 0 || s.indexOf('invalid credentials') >= 0) return '邮箱或密码不对。'
    if (s.indexOf('not confirmed') >= 0) return '邮箱还没有验证，请先点验证邮件里的链接。'
    if (/already registered|already been registered|user already exists/.test(s)) return '这个邮箱已经注册过了，直接登录就行。'
    if (/password should be|at least 6|weak password/.test(s)) return '密码至少 6 位。'
    if (/rate limit|for security purposes|only request this after|too many requests/.test(s)) return '操作太频繁了，请稍等一分钟再试。'
    if (/unable to validate email|invalid email|invalid format/.test(s)) return '邮箱格式不对。'
    return '出错了：' + (raw || '未知错误')
  }

  return {
    member: member,
    quotas: quotas,
    orders: orders,
    authError: authError,
    localDate: localDate,
    minutes: minutes
  }
})
