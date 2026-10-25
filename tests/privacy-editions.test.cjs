/* privacy.html holds both editions' wording in one file (amefys docs/china-deployment-plan.md #3):
   <… data-edition="global"> blocks show on amefys.com, <template data-edition="cn"> blocks are
   inert here and unwrapped by the amefys repo's scripts/cn/mirror-site.ts for amefys.cn. */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const html = fs.readFileSync(path.join(__dirname, '..', 'privacy.html'), 'utf8')
const cnBlocks = [...html.matchAll(/<template data-edition="cn">([\s\S]*?)<\/template>/g)].map((m) => m[1])

test('both editions are written down, and cn blocks are well formed', () => {
  assert.ok(cnBlocks.length >= 5, `expected the cn wording in several places, found ${cnBlocks.length}`)
  assert.ok((html.match(/data-edition="global"/g) || []).length >= 5)
  assert.strictEqual((html.match(/<template data-edition="cn">/g) || []).length, cnBlocks.length, 'an unclosed cn template')
  for (const b of cnBlocks) {
    assert.doesNotMatch(b, /<template/, 'cn templates must not nest')
    assert.doesNotMatch(b, /\sid="/, 'ids inside a template would be duplicated once unwrapped')
    assert.doesNotMatch(b, /<script/i)
  }
})

test('the global page says where its data lives; the cn wording says mainland and what leaves it', () => {
  assert.doesNotMatch(html, /中国香港区/, 'global accounts live in Singapore')
  assert.match(html, /<span data-edition="global"><span class="tag tag-cloud">Supabase<\/span>（新加坡）/)
  const cn = cnBlocks.join('\n')
  assert.match(cn, /中国境内/)
  assert.match(cn, /国内版默认关闭/)
  assert.match(cn, /OpenDota/)
  assert.match(cn, /个人信息保护法/)
})

test('account deletion is explained for both editions', () => {
  assert.match(html, /<h3 id="delete-account">注销账号<\/h3>/)
  assert.match(html, /设置 → 账号 → 注销账号/)
  assert.match(html, /保留 3 年/)
  assert.doesNotMatch(html, /48 小时内生效/, 'deletion is immediate now')
})
