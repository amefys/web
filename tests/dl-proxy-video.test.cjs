// The homepage demo video is served through /dl/<tag>/. It came back as
// application/octet-stream + Content-Disposition: attachment (2026-10-05),
// which Safari will not play inline. Video must stream as video/mp4, inline.
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

const r2With = (keys) => ({
  async get(key) {
    if (!keys.includes(key)) return null
    return { body: 'x', size: 1, httpEtag: '"e"', writeHttpMetadata() {} }
  }
})

const VIDEO = '/dl/v0.31.0-demo/amefys-demo-zh.mp4'

test('R2: an mp4 streams inline as video/mp4', async () => {
  const worker = await loadWorker()
  const env = { DL: r2With(['v0.31.0-demo/amefys-demo-zh.mp4']) }
  const res = await worker.fetch(new Request(`https://amefys.com${VIDEO}`), env, {})
  assert.strictEqual(res.status, 200)
  assert.strictEqual(res.headers.get('Content-Type'), 'video/mp4')
  assert.match(res.headers.get('Content-Disposition'), /^inline/)
})

test('GitHub fallback: an mp4 is re-labelled video/mp4, inline', async (t) => {
  const worker = await loadWorker()
  const realFetch = globalThis.fetch
  const realCaches = globalThis.caches
  globalThis.fetch = async () =>
    new Response('x', { status: 200, headers: { 'Content-Type': 'application/octet-stream' } })
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } }
  t.after(() => {
    globalThis.fetch = realFetch
    globalThis.caches = realCaches
  })
  const res = await worker.fetch(new Request(`https://amefys.com${VIDEO}`), {}, { waitUntil() {} })
  assert.strictEqual(res.status, 200)
  assert.strictEqual(res.headers.get('Content-Type'), 'video/mp4')
  assert.match(res.headers.get('Content-Disposition'), /^inline/)
})

test('GitHub fallback: a response already in the edge cache is re-labelled too', async (t) => {
  // The first request cached GitHub's octet-stream answer for 30 days; a
  // cache hit used to be returned as-is, bypassing the video headers.
  const worker = await loadWorker()
  const realCaches = globalThis.caches
  const stale = new Response('x', {
    status: 200,
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="amefys-demo-zh.mp4"' }
  })
  globalThis.caches = { default: { match: async () => stale, put: async () => {} } }
  t.after(() => { globalThis.caches = realCaches })
  const res = await worker.fetch(new Request(`https://amefys.com${VIDEO}`), {}, { waitUntil() {} })
  assert.strictEqual(res.headers.get('Content-Type'), 'video/mp4')
  assert.match(res.headers.get('Content-Disposition'), /^inline/)
})

test('installers still download as attachments', async () => {
  const worker = await loadWorker()
  const env = { DL: r2With(['v0.30.1/AMEFYS-Setup.exe']) }
  const res = await worker.fetch(new Request('https://amefys.com/dl/v0.30.1/AMEFYS-Setup.exe'), env, {})
  assert.match(res.headers.get('Content-Disposition'), /^attachment/)
})

// R2's range object exposes `suffix` even for an offset range (as undefined),
// so `'suffix' in range` picked the suffix branch and every 206 since
// 2026-09-05 carried "Content-Range: bytes NaN-NaN/<size>". Safari rejects
// that for video, and resumable installer downloads got the same header.
test('R2: a byte range answers with a numeric Content-Range', async () => {
  const worker = await loadWorker()
  const size = 7366510
  const bucket = {
    async get(key, opts) {
      if (key !== 'v0.31.0-demo/amefys-demo-zh.mp4') return null
      const h = opts && opts.range
      const m = h && h.get && /bytes=(\d+)-(\d*)/.exec(h.get('Range') || '')
      const range = m
        ? { offset: Number(m[1]), length: m[2] ? Number(m[2]) - Number(m[1]) + 1 : undefined, suffix: undefined }
        : undefined
      return { body: 'x', size, httpEtag: '"e"', range, writeHttpMetadata() {} }
    }
  }
  const req = (r) => new Request(`https://amefys.com${VIDEO}`, { headers: { Range: r } })
  let res = await worker.fetch(req('bytes=0-1023'), { DL: bucket }, {})
  assert.strictEqual(res.status, 206)
  assert.strictEqual(res.headers.get('Content-Range'), `bytes 0-1023/${size}`)
  assert.strictEqual(res.headers.get('Content-Length'), '1024')
  res = await worker.fetch(req('bytes=100-'), { DL: bucket }, {})
  assert.strictEqual(res.headers.get('Content-Range'), `bytes 100-${size - 1}/${size}`)
})

// Live R2 still answered "bytes=100-" with NaN after the suffix fix: its range
// object shape for open-ended ranges is not what the docs suggest. The header
// is now computed from the request's own Range, whatever R2 reports.
test('R2: Content-Range comes from the request even if R2 reports an odd range', async () => {
  const worker = await loadWorker()
  const size = 1000
  const bucket = {
    async get() {
      return { body: 'x', size, httpEtag: '"e"', range: { offset: undefined, length: undefined, suffix: undefined }, writeHttpMetadata() {} }
    }
  }
  const at = async (r) => {
    const res = await worker.fetch(new Request(`https://amefys.com${VIDEO}`, { headers: { Range: r } }), { DL: bucket }, {})
    return [res.status, res.headers.get('Content-Range'), res.headers.get('Content-Length')]
  }
  assert.deepStrictEqual(await at('bytes=100-'), [206, 'bytes 100-999/1000', '900'])
  assert.deepStrictEqual(await at('bytes=0-1023'), [206, 'bytes 0-999/1000', '1000'])
  assert.deepStrictEqual(await at('bytes=-200'), [206, 'bytes 800-999/1000', '200'])
})
