/**
 * Counters and partners per hero, read from the BP draft pack
 * (format: amefys/src/shared/draft/pack.ts).
 *
 * Values are the pack's *net* numbers in win-rate points: the pair's record
 * minus what the two heroes' own strengths already predict, with thin samples
 * shrunk towards zero (amefys/src/shared/draft/net-math.ts). So "+5" means the
 * pairing is worth 5 points beyond "the hero is just strong".
 */

const PP_SCALE = 4
const GAMES_SCALE = 16
/** Game counts are stored as uint8 on a log scale; 255 decodes to this. */
export const GAMES_CAP = Math.round(2 ** (255 / GAMES_SCALE) - 1)
/** Below this many games a pair is not shown at all. */
export const MIN_GAMES = 1000
export const LIST_SIZE = 5

function int8(b64) {
  const u = Buffer.from(b64, 'base64')
  return new Int8Array(u.buffer, u.byteOffset, u.length)
}

function games(b64) {
  return Array.from(Buffer.from(b64, 'base64'), (q) =>
    q === 0 ? 0 : Math.round(2 ** (q / GAMES_SCALE) - 1)
  )
}

/**
 * @returns {(internalName: string) => null | {
 *   counters: Pair[], counteredBy: Pair[], partners: Pair[] }}
 * where Pair = { hero: internalName, pp: number, games: number }.
 * `counters` are heroes this one beats, `counteredBy` the ones it fears.
 */
export function matchupReader(pack) {
  const heroes = pack.heroes
  const n = heroes.length
  const m = pack.ranked
  const vs = int8(m.vs)
  const withT = int8(m.with)
  const gamesVs = games(m.gamesVs)
  const gamesWith = games(m.gamesWith)

  return (internalName) => {
    const i = heroes.indexOf(internalName.replace(/^npc_dota_hero_/, ''))
    if (i < 0) return null
    const rows = []
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      rows.push({
        hero: `npc_dota_hero_${heroes[j]}`,
        vs: vs[i * n + j] / PP_SCALE,
        gamesVs: gamesVs[i * n + j],
        with: withT[i * n + j] / PP_SCALE,
        gamesWith: gamesWith[i * n + j]
      })
    }
    const pick = (key, gamesKey, sign) =>
      rows
        .filter((r) => r[gamesKey] >= MIN_GAMES && sign * r[key] > 0)
        .sort((a, b) => sign * (b[key] - a[key]))
        .slice(0, LIST_SIZE)
        .map((r) => ({ hero: r.hero, pp: r[key], games: r[gamesKey] }))
    return {
      counters: pick('vs', 'gamesVs', 1),
      counteredBy: pick('vs', 'gamesVs', -1),
      partners: pick('with', 'gamesWith', 1)
    }
  }
}

/** "+5.3" / "-2.8": one decimal, always signed. */
export function formatPp(pp) {
  return `${pp > 0 ? '+' : ''}${pp.toFixed(1)}`
}

/** "3.3 万局", "6,000 局", "6.3 万局以上" for the capped top value. */
export function formatGames(n) {
  if (n >= GAMES_CAP) return `${(GAMES_CAP / 10000).toFixed(1)} 万局以上`
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万局`
  return `${(Math.round(n / 100) * 100).toLocaleString('en-US')} 局`
}
