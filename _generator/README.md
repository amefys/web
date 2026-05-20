# SEO page generator

Generates `heroes/<slug>.html`, `items/<slug>.html`, `heroes/index.html`,
`items/index.html` and `sitemap.xml` from snapshots of the closed-source
`amefys` data files.

## Why static + committed?

GitHub Pages serves whatever's in the repo. Committing the generated
output keeps the deploy a single artifact upload (no build step on CI),
makes PR diffs honest about what changes, and lets contributors preview
locally with no Node toolchain.

## Refresh

```bash
# From repo root (amefys-web/):
cp ../amefys/src/shared/data/heroes.json _generator/data/
cp ../amefys/src/shared/data/items.json  _generator/data/
cp ../amefys/src/shared/data/builds.json _generator/data/
node _generator/build.mjs
git add heroes/ items/ sitemap.xml _generator/data/
git commit -m "chore(seo): refresh hero + item data snapshot"
```

The script clears `heroes/` and `items/` before writing, so removed
items don't linger.

## What gets emitted

- 127 hero pages — one per `npc_dota_hero_*` entry.
- ~167 item pages — every item that appears in at least one phase of
  the OpenDota build frequency snapshot (recipes / `item_aegis` skipped).
- `sitemap.xml` — includes every emitted hero + item page plus `/`,
  `/about.html`, `/packs/`, `/heroes/`, `/items/`.
- `robots.txt` — only created if missing, never overwritten.

## Compliance

Every data point is publicly available (OpenDota's public API,
Dota 2 client VPK). No game memory, no traffic interception, no fog-
vision data — see `COMPLIANCE.md` in the repo root.
