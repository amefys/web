#!/usr/bin/env node
/**
 * Downloads the latest BP draft pack (the same file the desktop client and
 * amefys.com/bp score from) into `data/draft-pack.json`.
 *
 * Usage (from amefys-web/):
 *   node _generator/fetch-draft.mjs
 *
 * The pack is published daily by the amefys draft-data workflow to
 * https://cdn.amefys.com/draft/; `index.json` names the latest file and its
 * sha256, which is checked before anything is written.
 */

import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CDN = 'https://cdn.amefys.com/draft'
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'data/draft-pack.json')

const index = await (await fetch(`${CDN}/index.json`)).json()
const { path, sha256 } = index.latest
if (!/^packs\/[\w.-]+\.json$/.test(path)) throw new Error(`unexpected pack path ${path}`)

const body = Buffer.from(await (await fetch(`${CDN}/${path}`)).arrayBuffer())
const actual = createHash('sha256').update(body).digest('hex')
if (actual !== sha256) throw new Error(`sha256 mismatch for ${path}`)

writeFileSync(OUT, body)
const pack = JSON.parse(body.toString('utf8'))
console.log(
  `wrote ${OUT}: patch ${pack.patch}, ${pack.window.from}…${pack.window.to}, ${pack.ranked.matches} ranked matches`
)
