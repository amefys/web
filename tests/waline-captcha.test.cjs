/* Regression tests for assets/waline-captcha.js — run with `npm test`
   (plain `node --test`, no dependencies).

   The bug being locked down: an earlier version of this patch pre-defined
   window.turnstile to wrap render(). Cloudflare's api.js reads an existing
   `turnstile` property as "already loaded", skips initialisation and leaves
   the property null, so Waline's `turnstile?.ready()` short-circuits and
   every guestbook submit hangs with the button spinning and no request. */

const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')

const MODULE_PATH = path.join(__dirname, '..', 'assets', 'waline-captcha.js')

/** Minimal DOM double: enough for capture listeners + the captcha container. */
function makeDom({ fieldId, hasBox = true, turnstile } = {}) {
  const listeners = {}
  const removed = []

  const box = {
    textContent: '<old widget>',
    querySelector(selector) {
      assert.strictEqual(selector, 'input[id^="cf-chl-widget-"]')
      return fieldId ? { id: fieldId } : null
    },
  }

  const doc = {
    addEventListener(type, handler, capture) {
      assert.strictEqual(capture, true, 'listeners must run in the capture phase')
      ;(listeners[type] || (listeners[type] = [])).push(handler)
    },
    querySelector(selector) {
      if (selector !== '.wl-captcha-container') return null
      return hasBox ? box : null
    },
  }

  const win = { document: doc }
  if (turnstile !== undefined) {
    win.turnstile = turnstile === 'spy'
      ? { remove(id) { removed.push(id) } }
      : turnstile
  }

  const fire = (type, event) => (listeners[type] || []).forEach((fn) => fn(event))
  return { doc, win, box, removed, fire, listeners }
}

/** Event double whose target.closest() matches the given selectors. */
function eventFor(matches, extra = {}) {
  return {
    target: { closest: (selector) => (matches.includes(selector) ? {} : null) },
    ...extra,
  }
}

function load() {
  delete require.cache[require.resolve(MODULE_PATH)]
  return require(MODULE_PATH)
}

test('loading the script never defines window.turnstile (b6ca2bd regression)', () => {
  // Importing must not touch the global either: api.js checks for the property.
  assert.strictEqual('turnstile' in globalThis, false)
  const { install } = load()
  const { win } = makeDom()
  install(win.document, win)
  assert.strictEqual('turnstile' in win, false, 'api.js would skip initialisation')
  assert.strictEqual('turnstile' in globalThis, false)
})

test('clicking submit removes the previous widget and empties the container', () => {
  const { install } = load()
  const dom = makeDom({ fieldId: 'cf-chl-widget-cb5nu_response', turnstile: 'spy' })
  install(dom.doc, dom.win)

  dom.fire('click', eventFor(['#waline button.wl-btn.primary']))

  assert.deepStrictEqual(dom.removed, ['cb5nu'])
  assert.strictEqual(dom.box.textContent, '')
})

test('first submit has no widget yet: container cleared, remove not called', () => {
  const { install } = load()
  const dom = makeDom({ turnstile: 'spy' })
  install(dom.doc, dom.win)

  dom.fire('click', eventFor(['#waline button.wl-btn.primary']))

  assert.deepStrictEqual(dom.removed, [])
  assert.strictEqual(dom.box.textContent, '')
})

test('api.js not loaded yet: clearing the container must not throw', () => {
  const { install } = load()
  const dom = makeDom({ fieldId: 'cf-chl-widget-cb5nu_response' })
  install(dom.doc, dom.win)

  dom.fire('click', eventFor(['#waline button.wl-btn.primary']))

  assert.strictEqual(dom.box.textContent, '')
})

test('a throwing turnstile.remove() still clears the container', () => {
  const { install } = load()
  const dom = makeDom({
    fieldId: 'cf-chl-widget-cb5nu_response',
    turnstile: { remove() { throw new Error('unknown widget') } },
  })
  install(dom.doc, dom.win)

  dom.fire('click', eventFor(['#waline button.wl-btn.primary']))

  assert.strictEqual(dom.box.textContent, '')
})

test('clicks outside the submit button leave the widget alone', () => {
  const { install } = load()
  const dom = makeDom({ fieldId: 'cf-chl-widget-cb5nu_response', turnstile: 'spy' })
  install(dom.doc, dom.win)

  dom.fire('click', eventFor(['#waline .wl-editor']))

  assert.deepStrictEqual(dom.removed, [])
  assert.strictEqual(dom.box.textContent, '<old widget>')
})

test('Cmd/Ctrl + Enter inside the editor also drops the widget', () => {
  const { install } = load()
  for (const modifier of ['metaKey', 'ctrlKey']) {
    const dom = makeDom({ fieldId: 'cf-chl-widget-cb5nu_response', turnstile: 'spy' })
    install(dom.doc, dom.win)

    dom.fire('keydown', eventFor(['#waline'], { key: 'Enter', [modifier]: true }))

    assert.deepStrictEqual(dom.removed, ['cb5nu'], modifier)
    assert.strictEqual(dom.box.textContent, '')
  }
})

test('plain Enter and modifier-less keys are ignored', () => {
  const { install } = load()
  const dom = makeDom({ fieldId: 'cf-chl-widget-cb5nu_response', turnstile: 'spy' })
  install(dom.doc, dom.win)

  dom.fire('keydown', eventFor(['#waline'], { key: 'Enter' }))
  dom.fire('keydown', eventFor(['#waline'], { key: 'a', metaKey: true }))

  assert.deepStrictEqual(dom.removed, [])
  assert.strictEqual(dom.box.textContent, '<old widget>')
})

test('missing captcha container is a no-op', () => {
  const { install } = load()
  const dom = makeDom({ hasBox: false, turnstile: 'spy' })
  install(dom.doc, dom.win)

  dom.fire('click', eventFor(['#waline button.wl-btn.primary']))

  assert.deepStrictEqual(dom.removed, [])
})

// Both guestbook pages carried the same inline shim; the English one was easy
// to forget, so assert on every page that boots the Waline client.
for (const [page, src] of [
  ['guestbook.html', 'assets/waline-captcha.js'],
  [path.join('en', 'guestbook.html'), '../assets/waline-captcha.js'],
]) {
  test(`${page} loads the external patch and no inline turnstile shim`, () => {
    const fs = require('node:fs')
    const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8')

    assert.ok(
      html.includes(`<script defer src="${src}"></script>`),
      `${page} must load ${src}`,
    )
    assert.ok(
      !/defineProperty\(\s*window\s*,\s*['"]turnstile['"]/.test(html),
      'pre-defining window.turnstile breaks Cloudflare api.js initialisation',
    )
  })
}
