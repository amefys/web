const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const html = fs.readFileSync(path.join(__dirname, '..', 'changelog.html'), 'utf8')

test('both editions are on 0.40.0; the cn-only 0.36.0 note stays cn-only and is no longer the latest', () => {
  const globalChannels = html.match(/<section class="channels" data-edition="global">[\s\S]*?<\/section>/)?.[0]
  const cnChannels = html.match(/<template data-edition="cn"><section class="channels">([\s\S]*?)<\/template>/)?.[1]
  const cnRelease = html.match(/<template data-edition="cn"><!-- ── 0\.36\.0 ── -->([\s\S]*?)<\/template>/)?.[1]
  assert.ok(globalChannels)
  assert.ok(cnChannels)
  assert.ok(cnRelease)
  assert.match(globalChannels, /稳定版<\/span> 0\.40\.0/)
  assert.match(cnChannels, /稳定版<\/span> 0\.40\.0/)
  assert.doesNotMatch(globalChannels, /0\.36\.0/)
  assert.match(cnRelease, /<h2>0\.36\.0<\/h2>/)
  assert.doesNotMatch(cnRelease, /当前稳定版/)
  // One latest badge, on the shared 0.40.0 entry (outside any edition block).
  assert.equal(html.match(/当前稳定版/g)?.length, 1)
  assert.match(html, /\n    <!-- ── 0\.40\.0 ── -->\n    <article class="release" id="v0-40-0">\n.*当前稳定版/)
})
