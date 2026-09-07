/* ─────────────────────────────────────────────────────────────
   AMEFYS · Turnstile hygiene for the Waline guestbook
   Waline renders its Turnstile widget into the same
   .wl-captcha-container on every submit and never removes the old
   one, so a second submit hits Cloudflare's "already rendered"
   guard: the new widget never calls back, the promise Waline awaits
   never settles and the submit button spins forever. Drop the
   previous widget in the capture phase, before Waline's own
   handler runs.

   NEVER pre-define window.turnstile (say, to wrap render()):
   api.js reads an existing `turnstile` property as "already
   loaded", skips initialisation and leaves the property null, so
   Waline's `turnstile?.ready()` short-circuits and *every* submit
   hangs with no error. That was the b6ca2bd regression.

   Loaded with `defer` from /guestbook.html, before the Waline
   client in /assets/vendor/waline/. Covered by
   /tests/waline-captcha.test.cjs (`npm test` → `node --test tests/`).
   ───────────────────────────────────────────────────────────── */
(function (root, factory) {
  var api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else api.install(root.document, root)
})(typeof window === 'undefined' ? globalThis : window, function () {
  // Cloudflare names the hidden token field after the widget id it returned
  // from render(), which is the only handle Waline leaves us to remove it.
  var WIDGET_FIELD = /^cf-chl-widget-(.+)_response$/

  function dropWidget(doc, win) {
    var box = doc.querySelector('.wl-captcha-container')
    if (!box) return
    var field = box.querySelector('input[id^="cf-chl-widget-"]')
    var turnstile = win.turnstile
    var match = field && field.id ? WIDGET_FIELD.exec(field.id) : null
    if (match && turnstile && turnstile.remove) {
      try { turnstile.remove(match[1]) } catch (e) {}
    }
    box.textContent = ''
  }

  function install(doc, win) {
    doc.addEventListener('click', function (event) {
      var target = event.target
      if (!target || !target.closest) return
      if (target.closest('#waline button.wl-btn.primary')) dropWidget(doc, win)
    }, true)

    // Waline also submits on Cmd/Ctrl + Enter from anywhere in its editor.
    doc.addEventListener('keydown', function (event) {
      if (!event.metaKey && !event.ctrlKey) return
      if (event.key !== 'Enter') return
      var target = event.target
      if (!target || !target.closest) return
      if (target.closest('#waline')) dropWidget(doc, win)
    }, true)
  }

  return { install: install, dropWidget: dropWidget }
})
