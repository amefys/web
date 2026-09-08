/* ─────────────────────────────────────────────────────────────
   AMEFYS · "More" dropdown controller
   Click toggles data-open (the only path that works on touch, where
   :hover is unreliable); outside click and Esc close it. Hover and
   focus-within are handled in CSS alone.
   ───────────────────────────────────────────────────────────── */
(function () {
  var groups = document.querySelectorAll('.nav-more')
  if (!groups.length) return

  function close(group) {
    group.setAttribute('data-open', 'false')
    var btn = group.querySelector('.nav-more-btn')
    if (btn) btn.setAttribute('aria-expanded', 'false')
  }

  function closeAll(except) {
    for (var i = 0; i < groups.length; i++) {
      if (groups[i] !== except) close(groups[i])
    }
  }

  for (var i = 0; i < groups.length; i++) {
    ;(function (group) {
      var btn = group.querySelector('.nav-more-btn')
      if (!btn) return
      btn.addEventListener('click', function (e) {
        e.stopPropagation()
        var open = group.getAttribute('data-open') === 'true'
        closeAll(group)
        group.setAttribute('data-open', open ? 'false' : 'true')
        btn.setAttribute('aria-expanded', open ? 'false' : 'true')
      })
      // Following a link inside the panel should not leave it pinned open.
      var entries = group.querySelectorAll('.nav-more-panel a')
      for (var j = 0; j < entries.length; j++) {
        entries[j].addEventListener('click', function () { close(group) })
      }
    })(groups[i])
  }

  document.addEventListener('click', function () { closeAll(null) })
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAll(null)
  })
})()
