/* Regression tests for the Waline theme overrides in guestbook.html — run with
   `npm test` (plain `node --test`, no dependencies).

   The bug being locked down: while a comment is being submitted Waline
   disables the primary button and replaces its label with a `currentColor`
   spinner. Upstream's disabled palette (--waline-disable-bg-color /
   --waline-disable-color) is nearly invisible on the dark site theme, and our
   `#waline .wl-btn.primary { color:#1a1408 }` override wins on specificity and
   tints the spinner near-black too — so the button showed up as an empty dark
   box with no visible progress. */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const PAGES = ['guestbook.html', 'en/guestbook.html']

const read = (page) => fs.readFileSync(path.join(__dirname, '..', page), 'utf8')

/** The rule body of the first selector matching `pattern`, or null. */
function ruleBody(html, pattern) {
  const match = html.match(pattern)
  return match ? match[1] : null
}

const DISABLED_RULE = /#waline \.wl-btn\.primary:disabled[^{]*\{([^}]*)\}/

for (const page of PAGES) {
  test(`${page}: the submitting (disabled) primary button gets its own visible palette`, () => {
    const body = ruleBody(read(page), DISABLED_RULE)
    assert.ok(body, `${page} must override #waline .wl-btn.primary:disabled`)
    assert.match(body, /color\s*:\s*var\(--gold\)/, 'spinner must inherit a visible colour')
    assert.match(body, /background\s*:\s*rgba\(232,\s*199,\s*121/, 'button keeps a gold-tinted fill')
    assert.doesNotMatch(body, /--waline-disable-(bg-)?color/, 'must not fall back to the invisible upstream palette')
  })

  test(`${page}: the button keeps its width when the label becomes a spinner`, () => {
    const body = ruleBody(read(page), DISABLED_RULE)
    assert.match(body, /min-width\s*:/, 'a min-width prevents the layout jump on submit')
  })

  test(`${page}: overriding the primary colour always comes with a disabled override`, () => {
    const html = read(page)
    if (!/#waline \.wl-btn\.primary\s*\{[^}]*color\s*:/.test(html)) return
    assert.match(
      html,
      /#waline \.wl-btn\.primary:disabled/,
      'a custom primary colour also tints the disabled spinner — override :disabled too',
    )
  })
}
