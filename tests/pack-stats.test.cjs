const test = require('node:test')
const assert = require('node:assert/strict')

test('pack stats allows the mainland mirror without changing the global origin', async () => {
  const { default: worker } = await import('../worker/pack-stats.js')
  const env = { PACK_STATS: { get: async () => '0' } }
  const cn = await worker.fetch(new Request('https://amefys.com/p/stats.json', {
    headers: { origin: 'https://amefys.cn' }
  }), env, { waitUntil() {} })
  assert.equal(cn.headers.get('access-control-allow-origin'), 'https://amefys.cn')
  assert.equal(cn.headers.get('vary'), 'Origin')

  const global = await worker.fetch(new Request('https://amefys.com/p/stats.json'), env, { waitUntil() {} })
  assert.equal(global.headers.get('access-control-allow-origin'), 'https://amefys.com')
})
