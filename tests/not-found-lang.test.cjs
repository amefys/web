// 404 language must follow the site section, like every other page: /en/… is
// English, everything else is the Chinese site. It used to follow the browser
// language, so an English-locale browser browsing the Chinese site got an
// English 404 (reported 2026-10-06).
const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const vm = require('node:vm')

const html = readFileSync(resolve(__dirname, '..', '404.html'), 'utf8')
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]

function run(pathname, language) {
  const els = {}
  const el = (id) =>
    (els[id] ||= {
      id, textContent: '', innerHTML: '', className: '',
      attrs: {}, classList: { add() {}, remove() {} },
      firstChild: { textContent: '' },
      setAttribute(k, v) { this.attrs[k] = v },
      getAttribute(k) { return this.attrs[k] },
      addEventListener() {}
    })
  const documentElement = { lang: '', style: { setProperty() {} } }
  const ctx = {
    location: { pathname },
    navigator: { language },
    document: { getElementById: el, documentElement, title: '' },
    window: { matchMedia: () => ({ matches: true }) },
    Math, setTimeout
  }
  vm.runInNewContext(script, ctx)
  return { lang: documentElement.lang, code: els.code.textContent }
}

test('Chinese site paths get a Chinese 404, whatever the browser language', () => {
  for (const p of ['/nope', '/heroes/not-a-hero.html', '/bp/x']) {
    assert.equal(run(p, 'en-US').lang, 'zh', p)
    assert.match(run(p, 'en-US').code, /页面不存在/)
  }
})

test('English site paths get an English 404, even in a Chinese browser', () => {
  for (const p of ['/en/nope', '/en/packs/x.html']) {
    assert.equal(run(p, 'zh-CN').lang, 'en', p)
    assert.match(run(p, 'zh-CN').code, /Page not found/)
  }
})
