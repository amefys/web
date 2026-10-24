/**
 * The donor wall on donate.html and en/donate.html (2026-10-24).
 *
 * Reads https://cdn.amefys.com/donors.json (written hourly by worker/donor-wall.js)
 * and fills <section id="wall">. The section ships `hidden`: if the file fails,
 * times out, is junk or lists nobody, the page looks exactly as it did before.
 *
 * Names and notes are typed by donors, so everything goes in through
 * textContent — never innerHTML — and avatars are only ever afdian's CDN.
 */
(function () {
  var URL_ = 'https://cdn.amefys.com/donors.json'
  var section = document.getElementById('wall')
  if (!section || typeof fetch !== 'function') return

  var en = (document.documentElement.getAttribute('lang') || '').indexOf('en') === 0
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  var T = en
    ? {
        anon: 'Anonymous',
        via: { afdian: 'Afdian', wechat: 'WeChat' },
        since: function (y, m) { return 'Since ' + MONTHS[m - 1] + ' ' + y },
        ago: function (d, y, m, day) {
          return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 7 ? d + ' days ago' : d < 14 ? 'last week' : MONTHS[m - 1] + ' ' + day + (y === nowY() ? '' : ', ' + y)
        }
      }
    : {
        anon: '匿名朋友',
        via: { afdian: '爱发电', wechat: '微信' },
        since: function (y, m) { return y + ' 年 ' + m + ' 月起' },
        ago: function (d, y, m, day) {
          return d <= 0 ? '今天' : d === 1 ? '昨天' : d < 7 ? d + ' 天前' : d < 14 ? '上周' : (y === nowY() ? '' : y + ' 年 ') + m + ' 月 ' + day + ' 日'
        }
      }

  var PALETTE = ['#E8C779', '#D9A95B', '#C8B48A', '#B7C9A8', '#A9C2CF', '#D4A5A0', '#C9B3D6', '#E2C9A0']
  /** China time — the Worker dates everything that way. */
  function cnToday() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10) }
  function nowY() { return Number(cnToday().slice(0, 4)) }

  function str(v, max) { return typeof v === 'string' ? Array.from(v).slice(0, max).join('') : '' }
  function hue(s) {
    var h = 7
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
    return PALETTE[h % PALETTE.length]
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
  }
  function okAvatar(u) { return typeof u === 'string' && /^https:\/\/([a-z0-9-]+\.)*afdiancdn\.com\//.test(u) }

  function initial(name) {
    var s = el('span', 'av', Array.from(name)[0].toUpperCase())
    s.style.background = hue(name)
    return s
  }
  function avatar(p) {
    if (!p.name) {
      var a = el('span', 'av anon', '☕')
      a.setAttribute('aria-hidden', 'true')
      return a
    }
    if (!okAvatar(p.avatar)) return initial(p.name)
    var wrap = el('span', 'av')
    var img = el('img')
    img.src = p.avatar
    img.alt = ''
    img.loading = 'lazy'
    img.referrerPolicy = 'no-referrer'
    img.onerror = function () { if (wrap.parentNode) wrap.parentNode.replaceChild(initial(p.name), wrap) }
    wrap.appendChild(img)
    return wrap
  }

  function tile(d) {
    var t = el('div', d.name ? 'donor' : 'donor is-anon')
    var m = /^(\d{4})-(\d{2})$/.exec(d.since || '')
    var tip = (m ? T.since(Number(m[1]), Number(m[2])) + ' · ' : '') + (T.via[d.via] || '')
    if (tip) t.setAttribute('data-tip', tip)
    t.appendChild(avatar(d))
    t.appendChild(el('span', 'nm', d.name || T.anon))
    return t
  }

  function post(p) {
    var box = el('div', 'post')
    box.appendChild(avatar(p))
    var body = el('div')
    var top = el('div', 'post-top')
    top.appendChild(el('b', null, p.name || T.anon))
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.at || '')
    if (m) {
      var days = Math.round((Date.parse(cnToday()) - Date.parse(p.at)) / 86400000)
      top.appendChild(el('span', null, T.ago(days, Number(m[1]), Number(m[2]), Number(m[3]))))
    }
    if (T.via[p.via]) top.appendChild(el('span', null, T.via[p.via]))
    body.appendChild(top)
    body.appendChild(el('div', 'post-msg', p.msg))
    box.appendChild(body)
    return box
  }

  function clean(list, withMsg) {
    if (!Array.isArray(list)) return []
    return list
      .filter(function (x) { return x && typeof x === 'object' && (!withMsg || (typeof x.msg === 'string' && x.msg)) })
      .map(function (x) {
        return { name: str(x.name, 20) || null, avatar: x.avatar, via: x.via, since: x.since, at: x.at, msg: str(x.msg, 60) }
      })
  }

  function fill(id, nodes) {
    var host = document.getElementById(id)
    if (!host) return
    var block = host.closest ? host.closest('[data-wall-block]') : null
    if (!nodes.length) {
      if (block) block.hidden = true
      return
    }
    for (var i = 0; i < nodes.length; i++) host.appendChild(nodes[i])
  }

  function render(data) {
    var donors = clean(data && data.donors, false)
    if (!donors.length) return false
    var month = cnToday().slice(0, 7)
    var total = Number(data.total)
    var count = document.getElementById('wall-total')
    if (count) count.textContent = String(Number.isFinite(total) && total >= donors.length ? Math.floor(total) : donors.length)
    fill('wall-new', donors.filter(function (d) { return d.since === month }).map(tile))
    fill('wall-old', donors.filter(function (d) { return d.since !== month }).map(tile))
    fill('wall-posts', clean(data.posts, true).slice(0, 5).map(post))
    section.hidden = false
    return true
  }

  var ctrl = typeof AbortController === 'function' ? new AbortController() : null
  var timer = setTimeout(function () { if (ctrl) ctrl.abort() }, 8000)
  fetch(URL_, ctrl ? { signal: ctrl.signal } : undefined)
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (data) {
      if (render(data) && location.hash === '#wall' && section.scrollIntoView) section.scrollIntoView()
    })
    .catch(function () {})
    .then(function () { clearTimeout(timer) })
})()
