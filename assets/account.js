/* account.html — sign in and see your membership, today's quotas, purchase
   code and orders. View-only: nothing here pays, changes a plan or edits the
   account. Formatting lives in account-view.js; this file only talks to
   Supabase and fills the page (always with textContent, never HTML).

   Same account and same session as the phone BP page (amefys.com/bp): same
   project, same publishable key, same storageKey, all on amefys.com, so
   signing in on one signs in the other. tests/account-page.test.cjs checks
   these three against the built /bp bundle. Requests go to api.amefys.com,
   never *.supabase.co (SNI-blocked in mainland China). */
;(function () {
  var SUPABASE_URL = 'https://api.amefys.com'
  var PUBLISHABLE_KEY = 'sb_publishable_Y41H4LnWGswPp7OatGgcRg_3s03Vc5w'
  var STORAGE_KEY = 'amefys-bp-auth'
  // The only page on the auth redirect allow-list; it also handles the
  // password-reset link (sets the new password), after which this page is
  // signed in too through the shared session.
  var AUTH_REDIRECT = 'https://amefys.com/bp/'

  var View = window.AccountView
  var $ = function (id) { return document.getElementById(id) }

  function show(id, on) { $(id).hidden = !on }

  function text(id, value) { $(id).textContent = value }

  if (!window.supabase || !window.supabase.createClient || !View) {
    show('state-loading', false)
    show('load-error', true)
    return
  }

  var client = window.supabase.createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: STORAGE_KEY }
  })

  /* ── sign in / register / reset ─────────────────────────────────────── */

  var mode = 'login'
  var TITLES = { login: '登录', register: '注册账号', reset: '找回密码' }
  var SUBMIT = { login: '登录', register: '注册', reset: '发送重置邮件' }

  function setMode(next) {
    mode = next
    text('auth-title', TITLES[mode])
    text('auth-submit', SUBMIT[mode])
    show('auth-password-field', mode !== 'reset')
    $('auth-password').required = mode !== 'reset'
    $('auth-password').autocomplete = mode === 'register' ? 'new-password' : 'current-password'
    var links = document.querySelectorAll('[data-mode]')
    for (var i = 0; i < links.length; i++) links[i].hidden = links[i].getAttribute('data-mode') === mode
    authMessage(null, null)
  }

  function authMessage(error, notice) {
    show('auth-error', Boolean(error))
    show('auth-notice', Boolean(notice))
    text('auth-error', error || '')
    text('auth-notice', notice || '')
  }

  function onSubmit(e) {
    e.preventDefault()
    var email = $('auth-email').value.trim()
    var password = $('auth-password').value
    var btn = $('auth-submit')
    btn.disabled = true
    authMessage(null, null)
    var call =
      mode === 'login' ? client.auth.signInWithPassword({ email: email, password: password })
      : mode === 'register' ? client.auth.signUp({ email: email, password: password, options: { emailRedirectTo: AUTH_REDIRECT } })
      : client.auth.resetPasswordForEmail(email, { redirectTo: AUTH_REDIRECT })
    call.then(function (r) {
      if (r.error) return authMessage(View.authError(r.error.message), null)
      if (mode === 'register' && !(r.data && r.data.session)) authMessage(null, '注册成功，请到邮箱点验证链接后再登录。')
      if (mode === 'reset') authMessage(null, '重置邮件已发出。点邮件里的链接会打开手机版 BP 页面，在那里设置新密码后回到这里刷新即可。')
      // a successful login / register fires onAuthStateChange, which renders the account
    }, function (err) {
      authMessage(View.authError(err && err.message), null)
    }).then(function () { btn.disabled = false })
  }

  /* ── account ─────────────────────────────────────────────────────────── */

  function renderMember(ent) {
    var m = View.member(ent)
    if (!m) { show('member-error', true); return }
    var tier = $('member-tier')
    tier.textContent = m.tier
    tier.setAttribute('data-tone', m.tone)
    text('member-expiry', m.expiry)
    text('member-source', m.source || '')
    show('member-source', Boolean(m.source))
    show('member-upgrade', m.tone === 'free')

    var rows = View.quotas(ent)
    var list = $('quota-list')
    list.textContent = ''
    for (var i = 0; i < rows.length; i++) {
      var li = document.createElement('li')
      var head = document.createElement('div')
      head.className = 'q-head'
      var label = document.createElement('b')
      label.textContent = rows[i].label
      var val = document.createElement('span')
      val.textContent = rows[i].text
      head.appendChild(label)
      head.appendChild(val)
      var bar = document.createElement('div')
      bar.className = 'q-bar'
      var fill = document.createElement('i')
      fill.style.width = rows[i].percent + '%'
      bar.appendChild(fill)
      var reset = document.createElement('small')
      reset.textContent = rows[i].reset
      li.appendChild(head)
      li.appendChild(bar)
      li.appendChild(reset)
      list.appendChild(li)
    }
    show('quota-card', rows.length > 0)
  }

  function renderOrders(data) {
    var rows = View.orders(data)
    var body = $('orders-body')
    body.textContent = ''
    for (var i = 0; i < rows.length; i++) {
      var tr = document.createElement('tr')
      var cells = [rows[i].date, rows[i].title, rows[i].amount, rows[i].order, rows[i].status]
      for (var c = 0; c < cells.length; c++) {
        var td = document.createElement('td')
        td.textContent = cells[c]
        if (c === 4) td.setAttribute('data-tone', rows[i].tone)
        tr.appendChild(td)
      }
      body.appendChild(tr)
    }
    show('orders-table', rows.length > 0)
    show('orders-empty', rows.length === 0)
  }

  function loadAccount(session) {
    text('acc-email', (session.user && session.user.email) || '')
    show('member-error', false)
    show('orders-error', false)
    show('ref-error', false)

    client.rpc('get_entitlements').then(function (r) {
      if (r.error) show('member-error', true)
      else renderMember(r.data)
    }, function () { show('member-error', true) })

    client.rpc('get_my_payment_orders').then(function (r) {
      if (r.error) { show('orders-error', true); show('orders-empty', false); show('orders-table', false) }
      else renderOrders(r.data)
    }, function () { show('orders-error', true) })

    client.rpc('get_or_create_purchase_ref').then(function (r) {
      var ok = !r.error && typeof r.data === 'string' && /^AMF-[0-9A-Z]{6}$/.test(r.data)
      if (ok) text('ref-code', r.data)
      show('ref-error', !ok)
      $('ref-copy').disabled = !ok
    }, function () { show('ref-error', true) })
  }

  function copyRef() {
    var code = $('ref-code').textContent
    var done = function () { text('ref-copy', '已复制'); setTimeout(function () { text('ref-copy', '复制') }, 1600) }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, function () { text('ref-copy', '请手动复制') })
    } else {
      text('ref-copy', '请手动复制')
    }
  }

  /* ── wiring ──────────────────────────────────────────────────────────── */

  var shownFor = null

  function render(session) {
    show('state-loading', false)
    show('view-auth', !session)
    show('view-account', Boolean(session))
    var uid = session && session.user ? session.user.id : null
    // token refreshes fire this too; only reload when the person changed
    if (session && uid !== shownFor) loadAccount(session)
    shownFor = uid
  }

  $('auth-form').addEventListener('submit', onSubmit)
  var modeLinks = document.querySelectorAll('[data-mode]')
  for (var i = 0; i < modeLinks.length; i++) {
    modeLinks[i].addEventListener('click', function (e) { setMode(e.currentTarget.getAttribute('data-mode')) })
  }
  $('ref-copy').addEventListener('click', copyRef)
  $('acc-signout').addEventListener('click', function () {
    client.auth.signOut().then(function () { render(null) }, function () { render(null) })
  })
  setMode('login')

  client.auth.getSession().then(function (r) { render(r.data && r.data.session) }, function () { render(null) })
  client.auth.onAuthStateChange(function (_event, session) { render(session) })
})()
