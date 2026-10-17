#!/usr/bin/env node
// Homepage "玩家群" section: QQ group, WeChat group, cloud-drive mirror.
//
// assets/community.json is the single source. This script renders it into
// index.html between <!-- community:start --> and <!-- community:end -->,
// each QR code re-encoded from its link as a 2–4 KB PNG data URI (no image
// files to load). PNG, not SVG: phones save a PNG to the photo album on long
// press (the way to scan a code on the same phone: WeChat → 扫一扫 → album)
// and WeChat's long-press recognition reads it; an SVG does neither reliably.
//
// Display rules: 4-module quiet zone (ISO/IEC 18004), whole pixels per module
// (crisp edges), about 200 CSS px whatever the code's density.
//
//   node scripts/community-qr.mjs                 re-render from the JSON
//   node scripts/community-qr.mjs --check         exit 1 if index.html is stale
//   node scripts/community-qr.mjs wechat <shot>   new WeChat group code (expires in 7 days)
//   node scripts/community-qr.mjs wechat <shot> --expires 2026-10-30
//   node scripts/community-qr.mjs qq|pan <shot|url>
//   node scripts/community-qr.mjs tip <shot|wxp://…>   WeChat tip code → assets/qr-tip.png
//
// The tip code is a file, not a homepage block: the donate page and the
// 「赞助一杯咖啡」 modals (changelog / about / guestbook) all load
// assets/qr-tip.png. A PNG so phones can long-press save it to the album.
//
// Decoding needs zbarimg (brew install zbar) and, for WeChat screenshots whose
// big centre logo defeats zbar, ImageMagick to crop and threshold first.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'assets/community.json')
const PAGE = join(ROOT, 'index.html')
const TIP_PNG = join(ROOT, 'assets/qr-tip.png')
const START = '<!-- community:start -->'
const END = '<!-- community:end -->'
const HOSTS = {
  qq: /^https:\/\/qm\.qq\.com\//,
  wechat: /^https:\/\/weixin\.qq\.com\/g\//,
  pan: /^https:\/\/[\w.-]*123pan\.(cn|com)\//,
  tip: /^wxp:\/\//
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

const QUIET = 4
const TARGET_PX = 200
/** Every card's white tile is this wide: the code sits inside at whole px per module. */
const TILE_PX = 208

/** PNG at a whole number of px per module, sized close to TARGET_PX. */
async function qr(url) {
  const opts = { errorCorrectionLevel: 'M', margin: QUIET }
  const modules = QRCode.create(url, opts).modules.size + 2 * QUIET
  const scale = Math.max(4, Math.round(TARGET_PX / modules))
  const src = await QRCode.toDataURL(url, { ...opts, scale, color: { dark: '#000000', light: '#ffffff' } })
  const size = modules * scale
  if (size > TILE_PX) throw new Error(`${url}: ${size}px does not fit the ${TILE_PX}px tile`)
  // pad to the tile in whole px (a half-px offset would blur every module)
  const a = Math.floor((TILE_PX - size) / 2)
  const b = TILE_PX - size - a
  return { src, size, pad: `${a}px ${b}px ${b}px ${a}px` }
}

function decode(file) {
  const zbar = (f) => {
    try {
      return execFileSync('zbarimg', ['-q', '--raw', f], { encoding: 'utf8' }).trim().split('\n')[0]
    } catch {
      return ''
    }
  }
  let text = zbar(file)
  if (text) return text
  // WeChat cards: QR in the middle, a big logo on top of it, text around
  const dir = mkdtempSync(join(tmpdir(), 'community-qr-'))
  for (const crop of ['80%x60%', '76%x50%', '90%x70%'])
    for (const t of ['50%', '40%', '60%'])
      for (const scale of ['100%', '50%', '200%']) {
        const out = join(dir, 'q.png')
        execFileSync('magick', [file, '-gravity', 'center', '-crop', `${crop}+0+0`, '+repage',
          '-colorspace', 'gray', '-threshold', t, '-resize', scale, out])
        text = zbar(out)
        if (text) return text
      }
  throw new Error(`could not read a QR code from ${file}`)
}

/** YYYY-MM-DD seven days from today, China time (what WeChat prints under the code). */
function inSevenDays() {
  const cn = new Date(Date.now() + 8 * 3600e3 + 7 * 864e5)
  return cn.toISOString().slice(0, 10)
}

function expiryLabel(date) {
  const [, m, d] = date.split('-').map(Number)
  return `${m} 月 ${d} 日前有效`
}

const ICON = {
  qq: '<path d="M12 3c-3 0-5 2.4-5 5.6 0 1-.3 1.6-.8 2.6-.7 1.3-1.7 3-1.2 4.6.2.6.7.6 1.3-.1.3 1 .9 1.9 1.7 2.6-.9.3-1.6.8-1.6 1.3 0 .8 1.6 1.2 3.4 1.2 1 0 1.8-.1 2.2-.4.4.3 1.2.4 2.2.4 1.8 0 3.4-.4 3.4-1.2 0-.5-.7-1-1.6-1.3.8-.7 1.4-1.6 1.7-2.6.6.7 1.1.7 1.3.1.5-1.6-.5-3.3-1.2-4.6-.5-1-.8-1.6-.8-2.6C17 5.4 15 3 12 3Z"/>',
  wechat: '<path d="M9 4C5.1 4 2 6.6 2 9.8c0 1.8 1 3.4 2.6 4.5L4 16.5l2.6-1.3c.8.2 1.6.3 2.4.3h.4a5.4 5.4 0 0 1-.2-1.4c0-3.2 3-5.7 6.8-5.7h.6C15.7 5.8 12.7 4 9 4Zm6.1 6c-3 0-5.4 2-5.4 4.5S12.1 19 15.1 19c.6 0 1.2-.1 1.8-.3l2.1 1.1-.5-1.8c1.3-.8 2.1-2.1 2.1-3.5 0-2.5-2.5-4.5-5.5-4.5Z"/>',
  pan: '<path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Zm8 3v5m-2.5-2.5L12 15l2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
}
const icon = (k) =>
  `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICON[k]}</svg>`

async function render(data) {
  const [qq, wx, pan] = await Promise.all([qr(data.qq.url), qr(data.wechat.url), qr(data.pan.url)])
  // phones: actions above the code (nobody can scan their own screen); the
  // stylesheet reorders and swaps the desktop / phone hint
  const card = ({ key, title, sub, code, alt, extra = '', actions = '', desk, phone, attrs = '' }) => `
        <div class="comm-card" data-community="${key}"${attrs}>
          <h3>${icon(key)}${title}</h3>
          <p class="comm-sub">${sub}</p>
          <img class="comm-qr" src="${code.src}" width="${code.size}" height="${code.size}" style="--pad:${code.pad}" alt="${alt}" decoding="async">${extra}${
            actions ? `\n          <div class="comm-actions">${actions}</div>` : ''
          }
          <p class="comm-note comm-desk">${desk}</p>
          <p class="comm-note comm-phone">${phone}</p>
        </div>`
  const chip = (key, label) =>
    `<button type="button" class="comm-chip" data-comm-open="${key}" aria-expanded="false" aria-controls="comm-panel">${icon(key)}${label}</button>`
  return `${START}
      <div class="comm-chips"><span class="comm-chips-label">加入玩家群</span>${chip('qq', 'QQ 群')}${chip('wechat', '微信群')}${chip('pan', '网盘下载')}</div>
      <div class="comm-panel" id="comm-panel" hidden>
      <div class="comm-grid">${card({
        key: 'qq',
        title: 'QQ 群',
        sub: `群号 <b>${esc(data.qq.group)}</b>`,
        code: qq,
        alt: 'AMEFYS QQ 群二维码',
        actions: `<a class="comm-btn" href="${esc(data.qq.url)}" rel="noopener" target="_blank">打开 QQ 加群</a><button type="button" class="comm-btn ghost" data-copy="${esc(data.qq.group)}">复制群号</button>`,
        desk: '用手机 QQ 扫码，或在 QQ 里搜群号。进群后在<b>群文件</b>里也能下载安装包。',
        phone: '点「打开 QQ 加群」直接跳到 QQ；也可以复制群号到 QQ 里搜。进群后在<b>群文件</b>里也能下载安装包。'
      })}${card({
        key: 'wechat',
        title: '微信群',
        sub: `Amefys 交流群<span class="comm-exp"> · ${expiryLabel(data.wechat.expires)}</span>`,
        code: wx,
        alt: 'AMEFYS 微信交流群二维码',
        attrs: ` data-expires="${data.wechat.expires}T00:00:00+08:00"`,
        extra: '\n          <p class="comm-expired">这张二维码已过期，新的马上换上。着急的话先加 QQ 群。</p>',
        desk: '用微信「扫一扫」扫码进群。',
        phone: '在微信里打开本页：长按二维码识别。在其他浏览器里：长按保存到相册，再到微信「扫一扫」右上角选这张图。'
      })}${card({
        key: 'pan',
        title: '网盘下载',
        sub: '123 云盘 · 备用下载',
        code: pan,
        alt: 'AMEFYS 123 云盘下载二维码',
        actions: `<a class="comm-btn" href="${esc(data.pan.url)}" rel="noopener" target="_blank">打开网盘</a>`,
        desk: '官网下载太慢或打不开时，从这里下载安装包。',
        phone: '官网下载太慢或打不开时，从这里下载安装包。'
      })}
      </div>
      </div>
      ${END}`
}

function splice(page, block) {
  const a = page.indexOf(START)
  const b = page.indexOf(END)
  if (a < 0 || b < a) throw new Error(`index.html has no ${START} … ${END} block`)
  return page.slice(0, a) + block + page.slice(b + END.length)
}

async function main() {
  const [cmd, arg, ...rest] = process.argv.slice(2)
  const data = JSON.parse(readFileSync(DATA, 'utf8'))
  if (cmd && cmd !== '--check') {
    if (!HOSTS[cmd] || !arg) throw new Error('usage: community-qr.mjs [--check | qq|wechat|pan <screenshot|url>]')
    const url = existsSync(arg) ? decode(arg) : arg
    if (!HOSTS[cmd].test(url)) throw new Error(`${cmd}: unexpected link ${url}`)
    data[cmd] = { ...data[cmd], url }
    if (cmd === 'wechat') {
      const i = rest.indexOf('--expires')
      const exp = i >= 0 ? rest[i + 1] : inSevenDays()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(exp || '')) throw new Error(`bad --expires ${exp}`)
      data.wechat.expires = exp
    }
    writeFileSync(DATA, JSON.stringify(data, null, 2) + '\n')
    console.log(`${cmd}: ${url}${cmd === 'wechat' ? ` (expires ${data.wechat.expires})` : ''}`)
  }
  if (data.tip?.url && cmd !== '--check') {
    await QRCode.toFile(TIP_PNG, data.tip.url, { errorCorrectionLevel: 'M', margin: QUIET, scale: 12, color: { dark: '#000000', light: '#ffffff' } })
    console.log('assets/qr-tip.png updated')
  }
  const page = readFileSync(PAGE, 'utf8')
  const next = splice(page, await render(data))
  if (cmd === '--check') {
    if (next !== page) {
      console.error('index.html is out of date: run node scripts/community-qr.mjs')
      process.exit(1)
    }
    console.log('community block up to date')
    return
  }
  writeFileSync(PAGE, next)
  console.log('index.html updated')
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
