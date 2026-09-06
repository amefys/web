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
