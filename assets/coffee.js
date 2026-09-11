/* ─────────────────────────────────────────────────────────────
   AMEFYS · sponsor tip modal controller

   Button opens; backdrop click, × and Esc close. Binds every
   .btn-coffee on the page, so a page may carry more than one.
   Silent no-op when the page has no button or no modal — pages
   include this from a shared <script> tag, not per feature.
   ───────────────────────────────────────────────────────────── */
(function () {
  var buttons = document.querySelectorAll('.btn-coffee')
  var modal = document.getElementById('coffee-modal')
  if (!buttons.length || !modal) return

  var closeBtn = document.getElementById('coffee-close')
  var lastFocused = null

  function openModal() {
    lastFocused = document.activeElement
    modal.classList.add('is-open')
    modal.setAttribute('aria-hidden', 'false')
    document.body.style.overflow = 'hidden'
    if (closeBtn) closeBtn.focus()
  }

  function dismissModal() {
    modal.classList.remove('is-open')
    modal.setAttribute('aria-hidden', 'true')
    document.body.style.overflow = ''
    // Send focus back where it came from; otherwise a keyboard user lands
    // at the top of the document after closing.
    if (lastFocused && lastFocused.focus) lastFocused.focus()
  }

  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener('click', openModal)
  }
  if (closeBtn) closeBtn.addEventListener('click', dismissModal)
  modal.addEventListener('click', function (e) {
    if (e.target === modal) dismissModal()
  })
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) dismissModal()
  })
})()
