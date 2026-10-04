#!/usr/bin/env node
/**
 * Writes `data/names.json` — the official Chinese name and the common player
 * nicknames for every hero and item — from the amefys glossary build
 * (`amefys/src/shared/data/glossary/terms.json`).
 *
 * Usage (from amefys-web/):
 *   node _generator/extract-names.mjs [path/to/terms.json]
 *
 * Only nicknames a reader would recognise make it onto the page:
 *   - Chinese ones (跳刀, 斧子), and
 *   - short Latin abbreviations players type (BKB),
 * never pinyin spellings (tiaodao) or anything the glossary marks as
 * ambiguous or gated (bs = Bloodseeker or Bloodstone).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_TERMS = resolve(HERE, '../../amefys/src/shared/data/glossary/terms.json')
const MAX_NICKNAMES = 5

const CJK = /[一-鿿]/
const ABBREVIATION = /^[a-z]{2,4}$/

export function pickNicknames(entity, blocked) {
  const zh = entity.names?.zh
  const seen = new Set([zh])
  const out = []
  for (const alias of entity.aliases?.zh ?? []) {
    if (blocked.has(alias.toLowerCase())) continue
    const shown = CJK.test(alias)
      ? alias
      : ABBREVIATION.test(alias) && (entity.aliases?.en ?? []).includes(alias)
        ? alias.toUpperCase()
        : null
    if (!shown || seen.has(shown)) continue
    seen.add(shown)
    out.push(shown)
    if (out.length === MAX_NICKNAMES) break
  }
  return out
}

export function extractNames(terms) {
  const blocked = new Set(
    [...(terms.ambiguous ?? []), ...(terms.gated ?? [])].map((x) => x.term.toLowerCase())
  )
  const names = {}
  for (const e of terms.entities) {
    if (e.kind !== 'hero' && e.kind !== 'item') continue
    if (!e.names?.zh) continue
    names[e.key] = { zh: e.names.zh, nicknames: pickNicknames(e, blocked) }
  }
  return names
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const termsPath = resolve(process.argv[2] ?? DEFAULT_TERMS)
  const names = extractNames(JSON.parse(readFileSync(termsPath, 'utf8')))
  const out = resolve(HERE, 'data/names.json')
  writeFileSync(out, JSON.stringify(names, null, 1) + '\n')
  console.log(`wrote ${out} (${Object.keys(names).length} entries)`)
}
