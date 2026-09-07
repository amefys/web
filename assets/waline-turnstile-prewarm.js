/* ─────────────────────────────────────────────────────────────
   AMEFYS · Turnstile pre-warming for the Waline guestbook

   Waline only touches Turnstile when you press "发布留言": it then
   injects challenges.cloudflare.com/turnstile/v0/api.js, waits for
   ready(), renders a widget and waits for the token — and only
   afterwards POSTs the comment. Measured from mainland China that
   whole chain costs ~1.2s for the script and ~11s (sometimes far
   more) for the challenge itself, so the button spins for tens of
   seconds before anything is even sent.

   Nothing about that work needs the user's click. This script runs
   it up front, while the visitor is still typing: load the API,
   render an off-screen widget, keep a fresh token, and hand that
   token to Waline the moment it asks for one. A stale, missing or
   failed pre-warm simply falls through to Waline's own (slow) path,
   so the guestbook keeps working if any of this breaks.

   NEVER pre-define window.turnstile: api.js reads an existing
   `turnstile` property as "already loaded", skips initialisation and
   leaves the property null, so every submit hangs (regression
   b6ca2bd). We only ever wrap the object api.js itself created,
   from inside its own onload callback.

   Loaded with `defer` from /guestbook.html; the site key comes from
   window.AMEFYS_TURNSTILE_KEY. Covered by
   /tests/waline-turnstile-prewarm.test.cjs.
   ───────────────────────────────────────────────────────────── */
(function (root, factory) {
  var api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else api.install(root, root.document)
})(typeof window === 'undefined' ? globalThis : window, function () {
  var API_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
  // Global name api.js calls once the real turnstile object exists.
  var READY_CALLBACK = '__amefysTurnstileReady'
  // Cloudflare tokens are valid for 300s and single-use; stop trusting
  // ours well before that and re-run the challenge in the background.
  var TOKEN_TTL = 240000
  var REFRESH_CHECK = 30000
  // A challenge can take well over a minute on a bad link. Never restart one
  // that is still running before this — resetting mid-flight throws the work
  // away and the widget can end up never producing a token at all.
  var CHALLENGE_TIMEOUT = 150000
  // @waline/client renders its own widget with action "social"; keep the
  // pre-warmed one identical so the two are interchangeable.
  var ACTION = 'social'
  var BOX_ID = 'amefys-turnstile-prewarm'

  function isWalineContainer(container) {
    return typeof container === 'string' && container.indexOf('wl-captcha') > -1
  }

  function install(win, doc, options) {
    var opts = options || {}
    var sitekey = opts.sitekey || win.AMEFYS_TURNSTILE_KEY
    if (!sitekey || !doc || !doc.createElement) return null

    var state = { token: null, at: 0, widgetId: null, native: null, nativeReady: null, pendingSince: 0 }
    var now = opts.now || function () { return Date.now() }

    function fresh() {
      return !!state.token && now() - state.at < TOKEN_TTL
    }

    function box() {
      var el = doc.getElementById(BOX_ID)
      if (el) return el
      el = doc.createElement('div')
      el.id = BOX_ID
      // Off-screen rather than display:none — a hidden container can stop
      // Cloudflare from running the challenge at all.
      el.style.cssText =
        'position:fixed;left:-9999px;top:0;width:300px;height:65px;overflow:hidden;pointer-events:none'
      ;(doc.body || doc.documentElement).appendChild(el)
      return el
    }

    /* A challenge is running: nothing may restart it until it settles (or
       CHALLENGE_TIMEOUT says it never will). */
    function pending() {
      return state.pendingSince !== 0 && now() - state.pendingSince < CHALLENGE_TIMEOUT
    }

    function settle(token) {
      state.pendingSince = 0
      state.token = token || null
      state.at = token ? now() : 0
    }

    function renderPrewarm() {
      var turnstile = win.turnstile
      if (!turnstile || !state.native) return
      state.pendingSince = now()
      try {
        state.widgetId = state.native.call(turnstile, box(), {
          sitekey: sitekey,
          action: ACTION,
          size: 'compact',
          callback: function (token) {
            settle(token)
          },
          'error-callback': function () {
            settle(null)
          },
          'timeout-callback': function () {
            settle(null)
          },
          'expired-callback': function () {
            settle(null)
            refresh()
          },
        })
      } catch (e) {
        state.widgetId = null
        state.pendingSince = 0
      }
    }

    function refresh() {
      var turnstile = win.turnstile
      if (!turnstile || pending()) return
      state.token = null
      state.pendingSince = now()
      if (state.widgetId !== null && state.widgetId !== undefined) {
        try {
          turnstile.reset(state.widgetId)
          return
        } catch (e) {
          state.widgetId = null
        }
      }
      state.pendingSince = 0
      renderPrewarm()
    }

    /* Waline calls turnstile.ready() before rendering. If Cloudflare refuses
       that call for any reason, it throws and Waline surfaces the message in
       an alert() instead of posting the comment. We only get here from the
       ?onload= callback, i.e. Turnstile *is* ready, so running the callback
       ourselves is both safe and correct. */
    function wrapReady(turnstile) {
      if (!turnstile || typeof turnstile.ready !== 'function') return
      if (state.nativeReady) return
      state.nativeReady = turnstile.ready
      turnstile.ready = function (callback) {
        try {
          return state.nativeReady.call(this, callback)
        } catch (e) {
          if (typeof callback === 'function') callback()
        }
      }
    }

    /* Hand Waline the token we already have; if we have none, get out of
       the way and let it run the challenge itself. */
    function wrapRender(turnstile) {
      if (!turnstile || typeof turnstile.render !== 'function') return
      if (state.native) return
      state.native = turnstile.render
      turnstile.render = function (container, params) {
        var callback = params && params.callback
        if (isWalineContainer(container) && fresh() && typeof callback === 'function') {
          var token = state.token
          state.token = null
          // Asynchronous so callers still get their turn to return first,
          // exactly as a real challenge would behave.
          win.setTimeout(function () { callback(token) }, 0)
          refresh()
          return null
        }
        return state.native.apply(this, arguments)
      }
    }

    function start() {
      var turnstile = win.turnstile
      if (!turnstile) return
      wrapRender(turnstile)
      wrapReady(turnstile)
      // No turnstile.ready() here: Cloudflare throws "Remove async/defer from
      // the Turnstile api.js script tag before using turnstile.ready()" when
      // the API was loaded asynchronously. The ?onload= callback we are
      // running inside already means the API is ready.
      renderPrewarm()
      if (win.setInterval) {
        win.setInterval(function () {
          if (!fresh() && !pending()) refresh()
        }, REFRESH_CHECK)
      }
    }

    win[READY_CALLBACK] = start

    var script = doc.createElement('script')
    script.src = API_URL + '?onload=' + READY_CALLBACK + '&render=explicit'
    // Must stay false. A dynamically created <script> defaults to async=true,
    // and Cloudflare then refuses turnstile.ready() *page-wide* with
    // "Remove async/defer from the Turnstile api.js script tag" — which is
    // exactly the call @waline/client makes when you press submit, so every
    // comment would fail with that message in an alert().
    script.async = false
    ;(doc.head || doc.documentElement).appendChild(script)

    var handle = { state: state, start: start, refresh: refresh, isFresh: fresh, isPending: pending }
    // Diagnostics only: lets us check from the console whether a token is
    // ready without poking at Cloudflare's internals.
    win.__amefysTurnstilePrewarm = handle
    return handle
  }

  return { install: install, isWalineContainer: isWalineContainer, TOKEN_TTL: TOKEN_TTL }
})
