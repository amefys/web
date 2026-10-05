// Homepage content audit (2026-10-05): the page advertised four translation
// languages the app does not have, a faction-themed UI that was never built,
// and a footer of dead links. These checks keep the claims tied to the product.
const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync, existsSync } = require('node:fs')
const { resolve } = require('node:path')

const read = (f) => readFileSync(resolve(__dirname, '..', f), 'utf8')
const css = read('assets/home.css')
const PAGES = { zh: read('index.html'), en: read('en/index.html') }
// Visible text only: drop <style>, <script> and tags.
const text = (html) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')

for (const [lang, html] of Object.entries(PAGES)) {
  test(`${lang}: no dead "#" links`, () => {
    assert.deepEqual([...html.matchAll(/href="#"/g)].length, 0)
  })

  test(`${lang}: translation claims match the six languages the app ships`, () => {
    // TranslateLang in amefys src/shared/types.ts: zh en ru vi id fil.
    const t = text(html)
    assert.doesNotMatch(t, /9 国|9 languages|nine languages/i)
    assert.doesNotMatch(t, /中 ⇄ (ES|PT|MS|TH)|ZH ⇄ (ES|PT|MS|TH)/)
    // Thai may appear in the OCR FAQ (Windows cannot read it); Malay never shipped.
    assert.doesNotMatch(t, /马来|Malay|中 ⇄ 泰|西 · 葡/)
  })

  test(`${lang}: no features the app does not have`, () => {
    const t = text(html)
    // No faction-based theming exists in the renderer.
    assert.doesNotMatch(t, /阵营氛围|随天辉|辉夜紫|faction-aware|follows your side|Radiant sunlight/i)
    // Item cards show no confidence / gold-gap figures; match detail has no gold curve.
    assert.doesNotMatch(t, /置信|缺口|Conf \d|GOLD ADVANTAGE|建议命中|AI 复盘/)
  })

  test(`${lang}: sample chat does not use real pro players`, () => {
    assert.doesNotMatch(text(html), /Yatoro|topson|miposika|\bame ·/i)
  })

  test(`${lang}: player copy carries no developer jargon`, () => {
    assert.doesNotMatch(text(html), /data-effects|prefers-reduced-motion|clip-path|portable JSON|i18n|Supabase/)
  })

  test(`${lang}: motion and keyboard accessibility`, () => {
    // Shared rules live in /assets/home.css; the page must load it.
    assert.match(html, /href="\/assets\/home\.css/)
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
    assert.match(css, /:focus-visible/)
    // Outline only: a border-radius here squared off the round carousel dots.
    assert.doesNotMatch(css, /:focus-visible[^{]*\{[^}]*border-radius/)
    assert.match(html, /class="skip-link"/)
    assert.match(html, /id="main"/)
  })

  test(`${lang}: footer brand shows the real logo, not an empty gradient box`, () => {
    const footer = html.slice(html.indexOf('<footer'))
    assert.match(footer, /<img[^>]+src="[^"]*icon\.svg/)
  })

  test(`${lang}: markup stays balanced and the carousel keeps its dots container`, () => {
    // A slide cleanup once deleted <div class="hc-dots"> along with the old dots,
    // leaving a stray </div> that closed the carousel early.
    const body = html.slice(html.indexOf('<body'))
    assert.strictEqual((body.match(/<div[\s>]/g) || []).length, (body.match(/<\/div>/g) || []).length)
    const dots = html.match(/<div class="hc-dots" data-hc-dots>([\s\S]*?)<\/div>/)
    assert.ok(dots, 'hc-dots container missing')
    const slides = (html.match(/class="hc-slide /g) || []).length
    assert.strictEqual((dots[1].match(/data-hc-go=/g) || []).length, slides)
  })

  test(`${lang}: demo video is current and streams as video`, () => {
    assert.doesNotMatch(html, /v1\.0\.1-demo/)
    assert.match(html, /<video[^>]+poster="/)
  })
}

test('the nav carries few enough links to fit one line at 1440px', () => {
  const links = PAGES.zh.match(/<div class="links">([\s\S]*?)<div class="nav-more"/)[1]
  assert.ok([...links.matchAll(/<a /g)].length <= 8)
})

test('a branded 404 page exists', () => {
  assert.ok(existsSync(resolve(__dirname, '..', '404.html')))
  assert.match(read('404.html'), /icon\.svg/)
})

test('every 404 hero has self-hosted art and an existing hero page', () => {
  const page = read('404.html')
  const ids = [...page.matchAll(/\{ id: '([a-z-]+)', slug: '([a-z-]+)'/g)]
  assert.ok(ids.length >= 4)
  for (const [, id, slug] of ids) {
    assert.ok(existsSync(resolve(__dirname, '..', 'assets', '404', `${id}.webp`)), id)
    assert.ok(existsSync(resolve(__dirname, '..', 'heroes', `${slug}.html`)), slug)
  }
  // Credit Valve for the art.
  assert.match(page, /Valve/)
})
