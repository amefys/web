// 2026-10-04: Baidu gives this site 10 pushes a day and rejects a whole batch
// that exceeds it. The old script sent 20 a day, 11 of them the same money
// pages, so it was refused every day and hero/item pages were never reached.
const test = require('node:test')
const assert = require('node:assert/strict')

const load = () => import('../scripts/baidu-push.mjs')
const DAY = 86_400_000
const site = (p) => `https://amefys.com${p}`

test('money pages come first, then the rest of the sitemap', async () => {
  const { orderUrls } = await load()
  const all = [site('/heroes/axe.html'), site('/about.html'), site('/')]
  assert.deepEqual(orderUrls(all), [site('/'), site('/about.html'), site('/heroes/axe.html')])
})

test('each day pushes a new window, and the cycle covers every page', async () => {
  const { windowFor } = await load()
  const urls = Array.from({ length: 25 }, (_, i) => site(`/p${i}`))
  const seen = new Set()
  for (let d = 0; d < 3; d++) {
    const w = windowFor(urls, 10, d * DAY)
    assert.equal(w.length, 10)
    w.forEach((u) => seen.add(u))
  }
  assert.equal(seen.size, 25)
  assert.notDeepEqual(windowFor(urls, 10, 0), windowFor(urls, 10, DAY))
})

test('never asks for more urls than the list has', async () => {
  const { windowFor } = await load()
  assert.equal(windowFor([site('/')], 10, 0).length, 1)
  assert.deepEqual(windowFor([], 10, 0), [])
})

// 2026-10-15: a new blog post would wait weeks for its turn in the rotation.
test('--urls picks exact pages, with or without the site prefix, and drops other hosts', async () => {
  const { explicitUrls } = await load()
  assert.deepEqual(explicitUrls('/blog/, blog/a.html,https://amefys.com/x.html'), [
    'https://amefys.com/blog/',
    'https://amefys.com/blog/a.html',
    'https://amefys.com/x.html'
  ])
  assert.deepEqual(explicitUrls('https://evil.example/a'), [])
  assert.deepEqual(explicitUrls(''), [])
})

// 2026-10-15: blog pages go ahead of the rotation; the rotation still fills the quota.
test('--first puts pages ahead of the rotation window without duplicates or overflow', async () => {
  const { withFirst } = await load()
  const win = ['https://amefys.com/a', 'https://amefys.com/blog/', 'https://amefys.com/b']
  assert.deepEqual(withFirst(['https://amefys.com/blog/'], win, 3), [
    'https://amefys.com/blog/',
    'https://amefys.com/a',
    'https://amefys.com/b'
  ])
  assert.deepEqual(withFirst([], win, 2), win.slice(0, 2))
})
