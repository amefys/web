/* Comments under tech-blog posts — run with `npm test` (plain `node --test`).

   Locks down three things:
   1. Every post has a comment box whose Waline path is that post's own path.
      A copied block with the previous post's path would silently merge two
      posts' threads.
   2. The loader reuses the guestbook's Turnstile helpers instead of copying
      them, and keeps them out of the page until the reader nears the end.
   3. The stylesheet gives the submitting (disabled) button its own palette —
      the guestbook shipped an invisible spinner without it
      (tests/guestbook-styles.test.cjs). */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const posts = fs.readdirSync(path.join(root, 'blog')).filter((f) => f.endsWith('.html') && f !== 'index.html')

test('there are blog posts to check', () => {
  assert.ok(posts.length >= 2)
})

for (const post of posts) {
  test(`blog/${post}: comment box keyed to its own path`, () => {
    const html = read(`blog/${post}`)
    const boxes = html.match(/<div id="waline"[^>]*>/g) || []
    assert.strictEqual(boxes.length, 1, 'exactly one #waline per post')
    assert.match(boxes[0], new RegExp(`data-path="/blog/${post.replace('.', '\\.')}"`))
    assert.match(html, /href="\/assets\/blog-comments\.css\?v=\d+"/)
    assert.match(html, /src="\/assets\/blog-comments\.js\?v=\d+" defer/)
    assert.match(html, /class="comments-fallback"[\s\S]*amefys@gmail\.com/, 'fallback names a way to reach us')
    assert.match(html, /href="\/privacy\.html"/, 'the box links the privacy policy')
  })
}

test('loader reuses the guestbook helpers and waits for the reader', () => {
  const js = read('assets/blog-comments.js')
  assert.match(js, /\/assets\/waline-captcha\.js/)
  assert.match(js, /\/assets\/waline-turnstile-prewarm\.js/)
  assert.match(js, /IntersectionObserver/, 'Waline and the Turnstile pre-warm load only near the comments')
  assert.match(js, /s\.async = false/, 'api.js must not end up async (see waline-turnstile-prewarm.js)')
  assert.doesNotMatch(js, /window\.turnstile\s*=/, 'never pre-define window.turnstile')
  assert.match(js, /serverURL: SERVER/)
  assert.match(js, /'https:\/\/waline\.amefys\.com'/)
})

test('the submitting button keeps a visible palette', () => {
  const css = read('assets/blog-comments.css')
  const m = css.match(/#waline \.wl-btn\.primary:disabled[^{]*\{([^}]*)\}/)
  assert.ok(m, 'override #waline .wl-btn.primary:disabled')
  assert.match(m[1], /color\s*:\s*var\(--gold\)/)
  assert.match(m[1], /min-width\s*:/)
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,6}\b/, 'colours come from blog.css tokens so both themes work')
})
