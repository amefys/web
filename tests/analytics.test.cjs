// Baidu Tongji rollout (2026-11-26): the loader tag must be present on every
// live page and nowhere else. bp/ and bp-beta/ are copied build output of the
// mobile app (analytics belongs in that build, not here); preview/ holds
// untracked design drafts; index-v1.0.html is the archived old homepage.
const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync, readdirSync, statSync } = require('node:fs')
const { resolve, join } = require('node:path')

const ROOT = resolve(__dirname, '..')
const TAG = '<script src="/assets/baidu-tongji.js" defer></script>'
const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', 'preview', 'bp', 'bp-beta', '_generator'])

function htmlFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) htmlFiles(full, out)
    else if (name.endsWith('.html') && name !== 'index-v1.0.html') out.push(full)
  }
  return out
}

test('every live HTML page loads the analytics loader exactly once', () => {
  const files = htmlFiles(ROOT)
  assert.ok(files.length > 200, `expected the whole site, got ${files.length} files`)
  for (const f of files) {
    const html = readFileSync(f, 'utf8')
    const count = html.split(TAG).length - 1
    assert.equal(count, 1, `${f}: expected exactly one loader tag, found ${count}`)
  }
})

test('the generator template emits the loader tag', () => {
  assert.ok(readFileSync(join(ROOT, '_generator/build.mjs'), 'utf8').includes(TAG))
})

test('the loader stays a no-op until the site ID is configured', () => {
  const loader = readFileSync(join(ROOT, 'assets/baidu-tongji.js'), 'utf8')
  assert.ok(loader.includes("if (BAIDU_HM_ID.indexOf('PENDING_') === 0) return"))
})

test('analytics is disclosed in the privacy policy for both editions', () => {
  const privacy = readFileSync(join(ROOT, 'privacy.html'), 'utf8')
  assert.ok(privacy.split('百度统计').length - 1 >= 3)
})
