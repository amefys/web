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
