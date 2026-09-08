# amefys-web

Public-facing site + release distribution for [AMEFYS](https://amefys.com).

- **Website**: `index.html` (deployed to GitHub Pages, served at https://amefys.com).
- **Installer downloads**: GitHub Releases on this repo. The macOS DMG and
  Windows NSIS EXE are produced by the `amefys` source repository and pushed
  here automatically when a `v*` tag lands there, via a GitHub App with
  Contents write access.

## Layout

```
index.html              Site root.
CNAME                   Custom domain pin (amefys.com).
.github/workflows/
  pages.yml             Deploy index.html → GitHub Pages on push to main.
```

Releases here are populated by the upstream `amefys` repo's release workflow.
Do not push DMG / EXE assets manually — let the CI add them so the auto-
update channel (latest.yml / latest-mac.yml emitted by electron-builder)
stays consistent.

## Local preview

```sh
python3 -m http.server 8000  # then open http://localhost:8000
```

## Changelog page (`changelog.html`)

`changelog.html` is the user-facing release history. Keep it in sync with
every release cut in the `amefys` repo:

1. Stable or beta tag pushed upstream → add an `<article class="release">`
   at the top (add `beta` class for pre-releases), written for players, not
   commit messages: what is new, what is fixed, anything they must know.
2. Update the two channel cards (current stable / current beta version) and
   the "最近更新" date in the hero.
3. When a beta graduates to stable, fold its entries into the stable entry
   and move the `tag-latest` badge.

Download links stay channel-relative (`/dl/...`, `/dl/beta/...`) so they
never need editing.

## Guestbook (`guestbook.html`, `en/guestbook.html`)

Waline client + a self-hosted worker (`waline.amefys.com`, see the
`waline-worker` repo). Two local scripts patch the client:

- `assets/waline-captcha.js` — drops the previous Turnstile widget before each
  submit, otherwise the second submit hangs on Cloudflare's "already rendered".
- `assets/waline-turnstile-prewarm.js` — runs the Turnstile challenge on page
  load and hands the cached token to Waline on submit. Without it a comment
  takes 15–40s to post from mainland China, because the client only starts the
  challenge after the click.

Rules when touching either file:

1. **Bump the `?v=` in both pages.** Cloudflare serves this site with
   `cache-control: max-age=14400`, so returning visitors keep the old file for
   four hours otherwise — a broken submit path would stay broken for them.
2. **Never pre-define `window.turnstile`**, and never load Cloudflare's
   `api.js` with `async`/`defer` — both break the client in ways that only
   show up on submit (hang, or an `alert()` about `turnstile.ready()`).
3. Run `npm test` (`tests/waline-*.test.cjs`) and verify on the live site, not
   just localhost: the Turnstile site key only accepts amefys.com.

## Top navigation (`assets/mobile-nav.*`, `assets/nav-more.*`)

Every full-nav page loads four shared files from absolute paths, so the bar
behaves identically on `/`, `/en/`, `/packs/`, `/guides/…`:

- `mobile-nav.css` / `mobile-nav.js` — the hamburger panel. It takes over at
  **≤1080px**, the width of `.nav-inner` itself: below that the English link
  list no longer fits on one line, so the bar collapses instead of wrapping.
- `nav-more.css` / `nav-more.js` — the **更多 / More** dropdown that holds the
  tail of the menu (常见问题 / 关于 / 捐助 · FAQ / About / Donate). Hover and
  `:focus-within` open it in CSS; the click path sets `data-open` so it works
  on touch. Inside the hamburger panel the dropdown flattens back into plain
  rows, so mobile users still see all three entries.

Rules when touching them:

1. **Bump the `?v=` on every page that loads the file** — Cloudflare serves
   this site with `cache-control: max-age=14400`.
2. Adding a nav entry means checking the bar at ~1085px (the narrowest desktop
   layout) in both languages; English labels are the ones that overflow first.
3. Generated pages (`heroes/`, `items/`) carry a shorter nav emitted by
   `_generator/build.mjs` — update `nav()` there too, then re-run the build.

## Donate page (`donate.html`, `en/donate.html`)

WeChat tip QR (`assets/qr-tip.svg`) is currently the only live channel — Buy Me
a Coffee is not set up, so nothing should link to it. The page also states that
a tip is a voluntary gift, not a purchase; keep that wording when editing.
