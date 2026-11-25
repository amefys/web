const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const html = fs.readFileSync(path.join(__dirname, '..', 'pro.html'), 'utf8')

test('CN Pro page marks the AI companion as beta without hiding purchase sections', () => {
  assert.match(html, /<section class="s" id="companion">[\s\S]*?Pro 主打 · 内测中/)
  assert.match(html, /<section class="s" id="plans">/)
  assert.match(html, /<section class="s" id="how">/)
  assert.doesNotMatch(html, /国内版暂未开放购买/)
})

test('AI companion FAQs join the shared purchase FAQ once', () => {
  assert.strictEqual(html.match(/<h2>常见问题<\/h2>/g)?.length, 1)
  assert.match(html, /不买会员能先试试 AI 玩伴吗？/)
  assert.match(html, /付款时忘了填识别码怎么办？/)
})
