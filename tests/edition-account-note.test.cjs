/* The two editions keep separate accounts and memberships (amefys docs/china-deployment-plan.md
   #14): the account page and the Pro purchase section both say so, and point mainland
   players at the China edition. */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
const note = (html) => {
  const m = html.match(/<p class="[^"]*" data-edition-note[^>]*>([\s\S]*?)<\/p>/)
  assert.ok(m, 'data-edition-note paragraph missing')
  return m[1]
}

test('account page: global account, not shared with the China edition', () => {
  const t = note(read('account.html'))
  assert.match(t, /国际版/)
  assert.match(t, /不通用/)
  assert.match(t, /href="https:\/\/amefys\.cn\/"/)
})

test('Pro page: membership is for the global edition; mainland players get pointed to the China edition', () => {
  const t = note(read('pro.html'))
  assert.match(t, /国际版的会员/)
  assert.match(t, /中国大陆/)
  assert.match(t, /不通用/)
  assert.match(t, /href="https:\/\/amefys\.cn\/"/)
})
