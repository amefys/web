const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const html = fs.readFileSync(path.join(__dirname, '..', 'changelog.html'), 'utf8')

test('CN changelog carries 0.36.0 without changing the global stable version', () => {
  const globalChannels = html.match(/<section class="channels" data-edition="global">[\s\S]*?<\/section>/)?.[0]
  const cnRelease = html.match(/<template data-edition="cn"><!-- ── 0\.36\.0 ── -->([\s\S]*?)<\/template>/)?.[1]
  assert.ok(globalChannels)
  assert.ok(cnRelease)
  assert.match(globalChannels, /稳定版<\/span> 0\.35\.0/)
  assert.doesNotMatch(globalChannels, /0\.36\.0/)
  assert.match(cnRelease, /<h2>0\.36\.0<\/h2>/)
  assert.match(cnRelease, /当前稳定版/)
  assert.match(cnRelease, /手机 BP 注册/)
  assert.match(html, /<span class="tag tag-latest" data-edition="global">当前稳定版<\/span>/)
})
