# Website versions

The homepage is versioned as whole-page snapshots. The live page is `index.html`;
the archive files are exact copies kept at the repository root so every relative
asset path keeps working.

| Version | File | Date | What changed |
|---|---|---|---|
| v1.0 | `index-v1.0.html` | 2026-10-30 | Snapshot before the feature-intro rewrite: hero carousel + separate draft / trash / assist / pipeline / skins / i18n sections. |
| v2.0 | `index.html` | 2026-10-30 | Feature intro replaced with the software-menu tour (首页 → 游戏中 → 悬浮窗 → 对局记录 → 资料库 → 设置). Hero, trust, FAQ, download and footer stay. |

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
