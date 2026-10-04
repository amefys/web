// Homepage structured data (2026-10-04 audit): softwareVersion sat at 0.22.1
// for seven releases because nothing tied it to the changelog.
const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const read = (f) => readFileSync(resolve(__dirname, '..', f), 'utf8')
const home = read('index.html')
const ldBlocks = [...home.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
  (m) => JSON.parse(m[1])
)
const byType = (t) => ldBlocks.find((b) => b['@type'] === t)

test('every JSON-LD block parses', () => {
  assert.ok(ldBlocks.length >= 2)
})

test('softwareVersion is the newest release in the changelog', () => {
  const latest = read('changelog.html').match(/<h2>(\d+\.\d+\.\d+)/)[1]
  assert.equal(byType('SoftwareApplication').softwareVersion, latest)
})

test('every FAQ question in JSON-LD is also visible on the page', () => {
  const visible = [...home.matchAll(/<summary>([\s\S]*?)<\/summary>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, '').trim()
  )
  for (const q of byType('FAQPage').mainEntity) assert.ok(visible.includes(q.name), q.name)
})

test('the homepage title and description mention BP and the mobile page', () => {
  assert.match(home.match(/<title>(.*?)<\/title>/)[1], /BP/)
  assert.match(home, /<meta name="description" content="[^"]*amefys\.com\/bp/)
})
