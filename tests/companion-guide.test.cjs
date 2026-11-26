// The AI companion's 「可以这样问」 page (2026-11-26) and its entry on the Pro page.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
const guide = read('companion-guide.html')
const cn = guide.match(/<template data-edition="cn">([\s\S]*?)<\/template>/g)?.join('\n') ?? ''

test('every example lives in the cn edition; amefys.com points to amefys.cn', () => {
  for (const id of ['direct', 'chat', 'auto', 'cant', 'tips']) {
    assert.match(cn, new RegExp(`<section class="s" id="${id}">`))
  }
  assert.match(cn, /「?下一件出什么/)
  assert.match(cn, /BKB 还差多少钱/)
  assert.match(cn, /复盘一下/)
  assert.match(guide, /data-edition="global">[^<]*AI 玩伴只在国内版[\s\S]*?amefys\.cn\/companion-guide\.html/)
})

test('the Pro page companion section links to it (cn only)', () => {
  const pro = read('pro.html')
  const section = pro.match(/<template data-edition="cn"><section class="s" id="companion">[\s\S]*?<\/section><\/template>/)?.[0] ?? ''
  assert.match(section, /href="companion-guide\.html"/)
})
