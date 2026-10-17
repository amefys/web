/* ─────────────────────────────────────────────────────────────
   AMEFYS · comments under tech-blog posts

   Same Waline server, Turnstile site key and moderation queue as
   /guestbook.html; each post is its own thread, keyed by the
   `data-path` on #waline (the post's canonical path).

   Nothing loads until the reader scrolls near the comments: most
   readers never comment, and the Turnstile pre-warm runs a full
   challenge (and the Waline client costs Worker requests) the
   moment it starts. Within ~800px of the section we load, in this
   order, the Waline stylesheet, the two guestbook helpers
   (waline-captcha.js, waline-turnstile-prewarm.js) and then the
   client itself. Both helpers carry the hard-won Turnstile rules —
   never pre-define window.turnstile, never load api.js async — so
   they are reused as-is rather than copied.

   If any step fails the fallback note under the box stays visible
   (CSS: #waline:empty + .comments-fallback). Covered by
   /tests/blog-comments.test.cjs.
   ───────────────────────────────────────────────────────────── */
(function () {
  var SERVER = 'https://waline.amefys.com'
  var SITE_KEY = '0x4AAAAAAEq3vUWqxYSWqdMd' // public Turnstile site key for amefys.com

  function addScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script')
      s.src = src
      // Keep execution order: the captcha helper must be installed before
      // Waline renders, and the pre-warm must not load api.js async.
      s.async = false
      s.onload = resolve
      s.onerror = reject
      document.head.appendChild(s)
    })
  }

  function addStyle(href) {
    var l = document.createElement('link')
    l.rel = 'stylesheet'
    l.href = href
    document.head.appendChild(l)
  }

  function mount(el) {
    window.AMEFYS_TURNSTILE_KEY = SITE_KEY
    addStyle('/assets/vendor/waline/waline.css')
    // waline-session.js must finish before import(): it clears an expired
    // stored login, and Waline reads that storage when its module loads.
    Promise.all([
      addScript('/assets/waline-captcha.js?v=2'),
      addScript('/assets/waline-turnstile-prewarm.js?v=3'),
      addScript('/assets/waline-session.js?v=2')
    ])
      .catch(function () {}) // the client still works without the helpers, just slower
      .then(function () { return import('/assets/vendor/waline/waline.js') })
      .then(function (mod) {
        mod.init({
          el: '#waline',
          serverURL: SERVER,
          path: el.getAttribute('data-path'),
          lang: 'zh-CN',
          // Clears an expired stored login first; 'enable' only for a live one
          // or #admin (waline-session.js). Falls back to 'disable' if it failed to load.
          login: window.AmefysWalineSession ? window.AmefysWalineSession.mode : 'disable',
          meta: ['nick', 'mail'],
          requiredMeta: ['nick', 'mail'],
          wordLimit: [0, 1000],
          pageSize: 20,
          imageUploader: false,
          search: false,
          pageview: false,
          reaction: false,
          emoji: false,
          noRss: true,
          turnstileKey: SITE_KEY,
          locale: {
            placeholder: '有问题、补充或者不同看法，都可以写在这里。评论审核后显示；邮箱只用于回复通知，不公开。',
            comment: '条评论',
            sofa: '还没有评论。',
            submit: '发布评论',
            approved: '已通过',
            waiting: '待审核',
            admin: '作者',
            commentUnderReview: '评论已提交，正在审核中（目前只有你能看到），通过后会公开显示。'
          }
        })
      })
      .catch(function () {})
  }

  function start() {
    var el = document.getElementById('waline')
    if (!el || !el.getAttribute('data-path')) return
    if (!('IntersectionObserver' in window)) return mount(el)
    var io = new IntersectionObserver(function (entries) {
      if (!entries.some(function (e) { return e.isIntersecting })) return
      io.disconnect()
      mount(el)
    }, { rootMargin: '800px 0px' })
    io.observe(el)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
