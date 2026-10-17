/* ─────────────────────────────────────────────────────────────
   AMEFYS · stale Waline sessions (guestbook + blog comments)

   @waline/client treats a visitor as logged in whenever
   localStorage / sessionStorage WALINE_USER holds a token — it never
   checks whether that token still works. Our waline-worker signs JWTs
   for 30 days. Once one expires the client still hides the nick / mail
   inputs and posts with the stored account's email; the server sees an
   anonymous comment using a registered email and refuses it
   ("该邮箱已注册，请先登录再留言"). With login: 'disable' the avatar and
   logout button are hidden too, so there is no way out from the page.
   That is how the first test comment under a blog post failed
   (2026-10-17, a guestbook #admin login from 2026-09-07).

   On load (in a browser) it runs loginMode(window) once — this must happen
   before the Waline module is evaluated — and keeps the result in
   AmefysWalineSession.mode, which becomes Waline's `login` option:
   - expired / undecodable stored token → clear it (the same 'null'
     Waline writes on logout) and return 'disable': normal anonymous form;
   - live token → 'enable', so the visitor sees who they post as and can
     log out;
   - #admin in the URL → 'enable' (maintainer login, registration is closed);
   - otherwise 'disable'.
   Never throws: storage can be blocked in private windows.

   Loaded (classic script, before the Waline module) by /guestbook.html,
   /en/guestbook.html and /assets/blog-comments.js.
   Covered by /tests/waline-session.test.cjs.
   ───────────────────────────────────────────────────────────── */
(function (root, factory) {
  var api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else {
    // Run now, at script load: @waline/client reads WALINE_USER into memory
    // the moment its module is evaluated, so clearing it later (say, inside
    // init()'s options) leaves the client on the stale session anyway.
    api.mode = api.loginMode(root)
    root.AmefysWalineSession = api
  }
})(typeof window === 'undefined' ? globalThis : window, function () {
  var KEY = 'WALINE_USER'

  function readUser(store) {
    try {
      var raw = store && store.getItem(KEY)
      if (!raw) return null
      var user = JSON.parse(raw)
      return user && typeof user === 'object' ? user : null
    } catch (e) {
      return null
    }
  }

  /** true when the JWT is past its exp, or cannot be read at all. */
  function tokenExpired(token, nowSec) {
    try {
      var part = String(token).split('.')[1]
      if (!part) return true
      var b64 = part.replace(/-/g, '+').replace(/_/g, '/')
      while (b64.length % 4) b64 += '='
      var json = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary')
      var payload = JSON.parse(json)
      return typeof payload.exp === 'number' && payload.exp <= nowSec
    } catch (e) {
      return true
    }
  }

  function loginMode(win, nowSec) {
    var now = typeof nowSec === 'number' ? nowSec : Math.floor(Date.now() / 1000)
    var live = false
    var stores = []
    try { stores.push(win.localStorage) } catch (e) {}
    try { stores.push(win.sessionStorage) } catch (e) {}
    for (var i = 0; i < stores.length; i++) {
      var user = readUser(stores[i])
      if (!user || !user.token) continue
      if (tokenExpired(user.token, now)) {
        try { stores[i].setItem(KEY, 'null') } catch (e) {}
      } else {
        live = true
      }
    }
    var admin = false
    try { admin = win.location.hash === '#admin' } catch (e) {}
    return live || admin ? 'enable' : 'disable'
  }

  return { loginMode: loginMode, tokenExpired: tokenExpired, readUser: readUser }
})
