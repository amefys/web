# Website versions

The homepage is versioned as whole-page snapshots. The live page is `index.html`;
the archive files are exact copies kept at the repository root so every relative
asset path keeps working.

| Version | File | Date | What changed |
|---|---|---|---|
| v1.0 | `index-v1.0.html` | 2026-10-30 | Snapshot before the feature-intro rewrite: hero carousel + separate draft / trash / assist / pipeline / skins / i18n sections. The archive copy adds a noindex marker so it never competes with the live page. |
| v2.0 | `index.html` | 2026-10-30 | Feature intro replaced with the software-menu tour (首页 → 游戏中 → 悬浮窗 → 对局记录 → 资料库 → 设置). Hero, trust, FAQ, download and footer stay. New CSS lives in assets/site-v2.css; screenshots in assets/showcase/. |

## Restore

v1.0, without touching the working tree:

~~~bash
git show site-v1.0:index.html > index.html
~~~

or from the archive file:

~~~bash
cp index-v1.0.html index.html
~~~

v2.0:

~~~bash
git show site-v2.0:index.html > index.html
~~~

## Tags

- `site-v1.0` — the commit where the v1.0 homepage was still live.
- `site-v2.0` — the commit where the software-menu feature intro replaced it.

Push the tags once: `git push origin site-v1.0 site-v2.0`.

## Feature-tour video

The v2.0 modal plays the 3:14 software-menu tight 2:17 cut (137 s) in a 720p transcode (6.85 MB, 73.9% smaller than the 26.22 MB 1080p master). It is stored per edition:

- Global (R2, served through amefys.com/dl/):
  https://amefys.com/dl/v0.36.0-demo/feature-tour-menu-tight-720p.mp4
- Mainland (OSS + CDN):
  https://dl.amefys.cn/v0.36.0-demo/feature-tour-menu-tight-720p.mp4
  (amefys.cn/dl/... 302s here)
- Legacy: the earlier 194 s cut stays at feature-tour-menu-194s-720p.mp4; the calibrated-but-untrimmed v2.1 cut stays at feature-tour-menu-v2.1-720p.mp4.
- Poster: the same path with -poster.jpg.

The CN mirror rewrites every https://amefys.com/dl/ in index.html to
https://amefys.cn/dl/, so one source URL covers both editions. Do not add a
second source tag.
