/**
 * The donor wall on donate.html and en/donate.html (2026-10-24).
 *
 * Reads https://cdn.amefys.com/donors.json (written hourly by worker/donor-wall.js)
 * and fills <section id="wall">. The section ships `hidden`: if the file fails,
 * times out, is junk or lists nobody, the page looks exactly as it did before.
 *
 * Names and notes are typed by donors, so everything goes in through
 * textContent — never innerHTML — and avatars are only ever afdian's CDN.
 *
 * Each card is greeted by a hero (assets/donor-heroes.js, generated from the
 * game's own chat wheel "thank" lines). Heroes are handed out oldest donor
 * first, so a new donor never takes the hero someone already had.
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
  var HEROES = typeof window !== 'undefined' && Array.isArray(window.AMEFYS_DONOR_HEROES) ? window.AMEFYS_DONOR_HEROES : []
  var ART = 'https://cdn.amefys.com/hero-art/v2/portraits/'

  /** donors are newest first; walk them oldest first, each takes their seed's hero or the next free one. */
  function assignHeroes(donors) {
    var n = HEROES.length
    if (!n) return donors.map(function () { return null })
    var used = {}
    var out = new Array(donors.length)
    for (var i = donors.length - 1; i >= 0; i--) {
      var start = donors[i].seed % n
      var pick = start
      for (var k = 0; k < n; k++) {
        if (!used[(start + k) % n]) { pick = (start + k) % n; break }
      }
      if (Object.keys(used).length >= n) used = {}
      used[pick] = true
      out[i] = HEROES[pick]
    }
    return out
  }

  function heroArt(h) {
    var box = el('div', 'donor-art')
    var img = el('img')
    img.src = ART + h.id + '.webp'
    img.alt = ''
    img.loading = 'lazy'
    img.width = 256
    img.height = 144
    img.onerror = function () { box.className = 'donor-art is-empty' }
    box.appendChild(img)
    return box
  }

  /** The hero's chat wheel line, shown the way the game prints it: (Hero): line */
  function heroLine(h) {
    var line = el('div', 'donor-hero')
    line.appendChild(el('span', 'spk'))
    line.appendChild(el('b', null, en ? h.name.en : h.name.zh))
    line.appendChild(el('span', 'donor-hero-line', en ? h.line.en : h.line.zh))
    return line
  }

  function okAvatar(u) { return typeof u === 'string' && /^https:\/\/([a-z0-9-]+\.)*afdiancdn\.com\//.test(u) }

  function initial(name) {
    var s = el('span', 'av', Array.from(name)[0].toUpperCase())
    s.style.background = hue(name)
    return s
  }
  function anon() {
    var a = el('span', 'av anon', '☕')
    a.setAttribute('aria-hidden', 'true')
    return a
  }
  // Name and avatar are judged separately: a custom avatar shows even when the
  // name is the default (anonymous) one.
  function fallback(p) { return p.name ? initial(p.name) : anon() }
  function avatar(p) {
    if (!okAvatar(p.avatar)) return fallback(p)
    var wrap = el('span', 'av')
    var img = el('img')
    img.src = p.avatar
    img.alt = ''
    img.loading = 'lazy'
    img.referrerPolicy = 'no-referrer'
    img.onerror = function () { if (wrap.parentNode) wrap.parentNode.replaceChild(fallback(p), wrap) }
    wrap.appendChild(img)
    return wrap
  }

  function ago(at) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(at || '')
    if (!m) return ''
    var days = Math.round((Date.parse(cnToday()) - Date.parse(at)) / 86400000)
    return T.ago(days, Number(m[1]), Number(m[2]), Number(m[3]))
  }

  /** One card per person: avatar, name, when and how they joined, and their own notes. */
  function card(d) {
    var c = el('div', d.name ? 'donor' : 'donor is-anon')
    if (d.hero) c.appendChild(heroArt(d.hero))
    var head = el('div', 'donor-head')
    head.appendChild(avatar(d))
    var who = el('div', 'donor-who')
    who.appendChild(el('div', 'nm', d.name || T.anon))
    var m = /^(\d{4})-(\d{2})$/.exec(d.since || '')
    var meta = [m ? T.since(Number(m[1]), Number(m[2])) : '', T.via[d.via] || ''].filter(Boolean).join(' · ')
    if (meta) who.appendChild(el('div', 'meta', meta))
    head.appendChild(who)
    c.appendChild(head)
    for (var i = 0; i < d.notes.length; i++) {
      var n = el('div', 'donor-note')
      n.appendChild(el('div', 'donor-note-msg', d.notes[i].msg))
      var when = ago(d.notes[i].at)
      if (when) n.appendChild(el('div', 'donor-note-at', when))
      c.appendChild(n)
    }
    if (d.hero) c.appendChild(heroLine(d.hero))
    return c
  }

  function notes(list) {
    if (!Array.isArray(list)) return []
    return list
      .filter(function (x) { return x && typeof x === 'object' && typeof x.msg === 'string' && x.msg })
      .slice(0, 3)
      .map(function (x) { return { at: x.at, msg: str(x.msg, 60) } })
  }

  function clean(list) {
    if (!Array.isArray(list)) return []
    return list
      .filter(function (x) { return x && typeof x === 'object' })
      .map(function (x) {
        return { name: str(x.name, 20) || null, avatar: x.avatar, via: x.via, since: x.since, seed: x.seed, notes: notes(x.notes) }
      })
      .map(function (d, i, all) {
        // Older files have no seed; fall back to something stable enough for one page view.
        var ok = typeof d.seed === 'number' && d.seed >= 0 && d.seed % 1 === 0
        d.seed = ok ? d.seed : (all.length - i) * 7919
        return d
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
    var donors = clean(data && data.donors)
    if (!donors.length) return false
    var heroes = assignHeroes(donors)
    for (var i = 0; i < donors.length; i++) donors[i].hero = heroes[i]
    var month = cnToday().slice(0, 7)
    var total = Number(data.total)
    var count = document.getElementById('wall-total')
    if (count) count.textContent = String(Number.isFinite(total) && total >= donors.length ? Math.floor(total) : donors.length)
    fill('wall-new', donors.filter(function (d) { return d.since === month }).map(card))
    fill('wall-old', donors.filter(function (d) { return d.since !== month }).map(card))
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
