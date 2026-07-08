/* ─────────────────────────────────────────────────────────────
   AMEFYS · shared mobile navigation controller
   Toggles the hamburger panel by flipping data-open on .nav.
   Loaded with `defer` via /assets/mobile-nav.js on every full-nav page.
   Pairs with /assets/mobile-nav.css.
   ───────────────────────────────────────────────────────────── */
(function () {
  var nav = document.querySelector('.nav')
  if (!nav) return
  var toggle = nav.querySelector('.nav-toggle')
  if (!toggle) return

  function setOpen(open) {
    nav.setAttribute('data-open', open ? 'true' : 'false')
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
  }

  toggle.addEventListener('click', function () {
    setOpen(nav.getAttribute('data-open') !== 'true')
  })

  // Tapping any menu entry (anchor link or CTA) closes the panel.
  var entries = nav.querySelectorAll('.links a, .actions a')
  for (var i = 0; i < entries.length; i++) {
    entries[i].addEventListener('click', function () { setOpen(false) })
  }

  // Back to desktop width → make sure we don't leave a panel stuck open.
  window.addEventListener('resize', function () {
    if (window.innerWidth > 900 && nav.getAttribute('data-open') === 'true') setOpen(false)
  })
})()
