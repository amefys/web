// Stable tags build Windows only; /dl/AMEFYS.dmg must keep resolving to the
// newest release that has a DMG (latest-mac.json), not to a Windows-only one.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function loadWorker() {
  // The worker is an ES module in a CommonJS package: load a .mjs copy.
  const src = fs.readFileSync(path.join(__dirname, '..', 'worker', 'dl-proxy.js'), 'utf8')
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dlp-')), 'dl-proxy.mjs')
  fs.writeFileSync(tmp, src)
  return (await import(tmp)).default
}

/** R2 stub: pointer objects plus the installer keys that exist. */
function bucket(pointers, objects) {
  return {
    async get(key) {
      if (key.endsWith('.json') && !key.includes('/')) {
        const name = key.slice(0, -5)
        return name in pointers ? { json: async () => ({ tag: pointers[name] }) } : null
      }
      if (!objects.includes(key)) return null
      return { body: 'x', size: 1, httpEtag: '"e"', writeHttpMetadata() {} }
    }
  }
}

async function servedKey(worker, env, urlPath) {
  const res = await worker.fetch(new Request(`https://amefys.com${urlPath}`), env, {})
  return { status: res.status, source: res.headers.get('X-AMEFYS-Source') }
}

const OBJECTS = [
  'v0.29.3/AMEFYS-Setup.exe',
  'v0.29.3/latest.yml',
  'v0.29.2/AMEFYS.dmg',
  'v0.29.2/latest-mac.yml',
  'v0.29.2/AMEFYS.dmg.blockmap'
]

test('stable mac files come from latest-mac.json, windows files from latest.json', async () => {
  const worker = await loadWorker()
  const env = { DL: bucket({ latest: 'v0.29.3', 'latest-mac': 'v0.29.2' }, OBJECTS) }
  for (const p of ['/dl/AMEFYS.dmg', '/dl/latest-mac.yml', '/dl/AMEFYS.dmg.blockmap', '/dl/AMEFYS-Setup.exe', '/dl/latest.yml']) {
    const r = await servedKey(worker, env, p)
    assert.deepStrictEqual(r, { status: 200, source: 'r2' }, p)
  }
})

test('mac files fall back to latest.json when no mac pointer exists', async () => {
  const worker = await loadWorker()
  const env = { DL: bucket({ latest: 'v0.29.2' }, OBJECTS) }
  assert.deepStrictEqual(await servedKey(worker, env, '/dl/AMEFYS.dmg'), { status: 200, source: 'r2' })
})
