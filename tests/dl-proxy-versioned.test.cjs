// From v0.36.0 installers ship as AMEFYS-Setup-<version>.exe / AMEFYS-<version>.dmg.
// The unversioned URLs every page links to must keep working, for new releases
// and old ones alike, and the browser should save the file under its version.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function loadWorker() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'worker', 'dl-proxy.js'), 'utf8')
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dlp-')), 'dl-proxy.mjs')
  fs.writeFileSync(tmp, src)
  return (await import(tmp)).default
}

/** R2 stub: pointer objects plus the keys that exist; records object reads. */
function bucket(pointers, objects, reads = []) {
  return {
    async get(key) {
      if (key.endsWith('.json') && !key.includes('/')) {
        const name = key.slice(0, -5)
        return name in pointers ? { json: async () => ({ tag: pointers[name] }) } : null
      }
      if (!objects.includes(key)) return null
      reads.push(key)
      return { body: 'x', size: 1, httpEtag: '"e"', writeHttpMetadata() {} }
    }
  }
}

const get = (worker, env, p, ctx = {}) => worker.fetch(new Request(`https://amefys.com${p}`), env, ctx)

test('unversioned link serves the versioned object of the newest release', async () => {
  const worker = await loadWorker()
  const reads = []
  const env = { DL: bucket({ latest: 'v0.36.0' }, ['v0.36.0/AMEFYS-Setup-0.36.0.exe'], reads) }
  const res = await get(worker, env, '/dl/AMEFYS-Setup.exe')
  assert.strictEqual(res.status, 200)
  assert.deepStrictEqual(reads, ['v0.36.0/AMEFYS-Setup-0.36.0.exe'])
  assert.strictEqual(res.headers.get('Content-Disposition'), 'attachment; filename="AMEFYS-Setup-0.36.0.exe"')
})

test('older releases with unversioned objects still serve, saved under their version', async () => {
  const worker = await loadWorker()
  const env = { DL: bucket({ latest: 'v0.35.0' }, ['v0.35.0/AMEFYS-Setup.exe']) }
  for (const p of ['/dl/AMEFYS-Setup.exe', '/dl/v0.35.0/AMEFYS-Setup.exe']) {
    const res = await get(worker, env, p)
    assert.strictEqual(res.status, 200, p)
    assert.strictEqual(res.headers.get('Content-Disposition'), 'attachment; filename="AMEFYS-Setup-0.35.0.exe"', p)
  }
})

test('beta channel and pinned tags resolve the versioned name, prerelease suffix included', async () => {
  const worker = await loadWorker()
  const env = {
    DL: bucket({ beta: 'v0.37.0-beta.1' }, ['v0.37.0-beta.1/AMEFYS-Setup-0.37.0-beta.1.exe', 'v0.36.0/AMEFYS-0.36.0.dmg'])
  }
  const beta = await get(worker, env, '/dl/beta/AMEFYS-Setup.exe')
  assert.strictEqual(beta.headers.get('Content-Disposition'), 'attachment; filename="AMEFYS-Setup-0.37.0-beta.1.exe"')
  const dmg = await get(worker, env, '/dl/v0.36.0/AMEFYS.dmg')
  assert.strictEqual(dmg.status, 200)
})

test('the updater fetches versioned names directly; mac ones follow latest-mac.json', async () => {
  const worker = await loadWorker()
  const env = {
    DL: bucket({ latest: 'v0.36.1', 'latest-mac': 'v0.36.0' }, [
      'v0.36.1/AMEFYS-Setup-0.36.1.exe.blockmap',
      'v0.36.0/AMEFYS-0.36.0.dmg',
      'v0.36.0/AMEFYS-0.36.0.dmg.blockmap'
    ])
  }
  for (const p of ['/dl/AMEFYS-Setup-0.36.1.exe.blockmap', '/dl/AMEFYS-0.36.0.dmg', '/dl/AMEFYS-0.36.0.dmg.blockmap']) {
    assert.strictEqual((await get(worker, env, p)).status, 200, p)
  }
})

test('telemetry keeps one unversioned name per installer', async () => {
  const worker = await loadWorker()
  const points = []
  const env = {
    DL: bucket({ latest: 'v0.36.0' }, ['v0.36.0/AMEFYS-Setup-0.36.0.exe']),
    DL_STATS: { writeDataPoint: (p) => points.push(p) }
  }
  await get(worker, env, '/dl/AMEFYS-Setup.exe')
  await get(worker, env, '/dl/AMEFYS-Setup-0.36.0.exe')
  assert.deepStrictEqual(points.map((p) => p.blobs[1]), ['AMEFYS-Setup.exe', 'AMEFYS-Setup.exe'])
  assert.deepStrictEqual(points.map((p) => p.indexes[0]), ['AMEFYS-Setup.exe', 'AMEFYS-Setup.exe'])
})

test('GitHub fallback: the alias resolves the latest tag and fetches the versioned asset', async (t) => {
  const worker = await loadWorker()
  const realFetch = globalThis.fetch
  const realCaches = globalThis.caches
  const urls = []
  globalThis.fetch = async (u) => {
    const url = String(u)
    urls.push(url)
    if (url.endsWith('/releases/latest')) return Response.json({ tag_name: 'v0.36.0' })
    if (url.endsWith('/releases/download/v0.36.0/AMEFYS-Setup-0.36.0.exe')) return new Response('x', { status: 200 })
    return new Response('nope', { status: 404 })
  }
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } }
  t.after(() => {
    globalThis.fetch = realFetch
    globalThis.caches = realCaches
  })
  const res = await get(worker, {}, '/dl/AMEFYS-Setup.exe', { waitUntil() {} })
  assert.strictEqual(res.status, 200)
  assert.strictEqual(res.headers.get('Content-Disposition'), 'attachment; filename="AMEFYS-Setup-0.36.0.exe"')
  assert.ok(urls.some((u) => u.endsWith('/releases/download/v0.36.0/AMEFYS-Setup-0.36.0.exe')))
})

test('GitHub fallback: an old release without the versioned asset falls back to the plain name', async (t) => {
  const worker = await loadWorker()
  const realFetch = globalThis.fetch
  const realCaches = globalThis.caches
  globalThis.fetch = async (u) => {
    const url = String(u)
    if (url.endsWith('/releases/latest')) return Response.json({ tag_name: 'v0.35.0' })
    if (url.endsWith('/releases/latest/download/AMEFYS-Setup.exe')) return new Response('x', { status: 200 })
    return new Response('nope', { status: 404 })
  }
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } }
  t.after(() => {
    globalThis.fetch = realFetch
    globalThis.caches = realCaches
  })
  const res = await get(worker, {}, '/dl/AMEFYS-Setup.exe', { waitUntil() {} })
  assert.strictEqual(res.status, 200)
})
