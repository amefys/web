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
