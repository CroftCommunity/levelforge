# LevelForge

A touch-first, phone-friendly 2D physics level editor and test bed, built for
human-and-Claude collaboration on Angry Birds / Red Ball style games.

The product is not the editor — it's the **level schema**: a JSON format a human
edits visually on a phone and Claude reads and writes as text. Build a level by
touch, copy the JSON into a Claude conversation, get edited or brand-new levels
back, paste them in, play them. Notes (per object and per level) travel inside the
schema so intent rides along with the geometry.

See [`SPEC.md`](./SPEC.md) for the full build specification and
[`reference/levelforge.html`](./reference/levelforge.html) for the original
play-tested prototype this build ports.

## Stack

Vite + TypeScript, no UI framework (vanilla DOM + canvas). [Matter.js](https://brm.io/matter-js/)
for physics, bundled for offline. Vitest for unit tests. ESLint + Prettier. Ships
as an installable, offline-capable PWA.

## Getting started

```bash
npm install
npm run dev        # dev server
npm run build      # typecheck + production build to dist/
npm run preview    # serve the built app
npm test           # unit tests (schema, magnet math, break model)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```

## Project layout

```
index.html            app shell (markup + CSS)
src/
  schema.ts           types, strict validation, forward migration (0.2 -> 0.3 -> 0.4)
  materials.ts        the material table (all physics lives here)
  store.ts            localStorage drafts + working-level autosave + download
  levels-manifest.ts  committed levels bundled at build time
  editor/
    geometry.ts       pure geometry + magnet/grid snapping (unit-tested)
    render.ts         procedural per-material canvas rendering
  play/
    break-model.ts    the breakage math (unit-tested)
    world.ts          Matter world build, melt, movers, slingshot, win/fail
  main.ts             DOM + canvas + gesture glue (the editor app)
levels/<scene>/*.json committed shared library (Claude can author these)
public/               manifest, service worker, icons
test/                 Vitest suites
scripts/gen-icons.mjs regenerate the PWA PNG icons (no deps)
```

## The schema (v0.4)

World is fixed at 1600 × 900 units, origin top-left, y down. Positions are object
centres; angles are degrees, clockwise positive. `src/schema.ts` is the single
source of truth — it validates strictly (types, ranges, unique ids, known enums)
with human-readable errors, and migrates older versions forward. See the schema
modal (`{ }`) in-app to copy/paste levels, and `SPEC.md` §3 for the field details.

## Levels library

Anything under `levels/<scene>/<name>.json` is the committed, shared library. It is
pulled into the bundle at build time, so it works offline and shows up (read-only)
in the in-app library alongside your local drafts. To add a level, drop a valid
v0.4 JSON file into a scene folder — Claude can author these directly.
