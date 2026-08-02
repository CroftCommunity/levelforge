# Emoji Wars

A touch-first 2D physics game and its level editor (the "forge"), built for
human-and-Claude collaboration. Fling a hero emoji from a launcher at villains
(emoji stamped in fragile **target** material) and destroy them all to clear the
level.

The product's real center is the **level schema**: a JSON format a human edits
visually on a phone and Claude reads and writes as text. Build a level in the
forge, copy the JSON into a Claude conversation for feedback or co-design, paste
Claude's revisions back, load them. Both sides edit the same artifact; notes (per
object and per level) travel inside the schema so intent rides along.

See [`SPEC.md`](./SPEC.md) for the full build specification and
[`reference/levelforge.html`](./reference/levelforge.html) for the play-tested
prototype (forge v0.11, schema v0.7) this build ports.

## Stack

Vite + TypeScript, no UI framework (vanilla DOM + canvas). [Matter.js](https://brm.io/matter-js/)
for physics, bundled for offline. Vitest for unit tests. ESLint + Prettier. Ships
as an installable, offline-capable PWA, deployed to GitHub Pages.

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
  schema.ts           types, strict validation, forward migration (0.2 -> 0.7)
  materials.ts        the material table (all physics lives here)
  store.ts            localStorage drafts + working-level autosave + download
  levels-manifest.ts  committed levels bundled at build time
  editor/
    geometry.ts       pure geometry + magnet/grid snapping + blob hit math
    backdrops.ts      six procedural scenes, custom image, agent brief
    render.ts         procedural per-material canvas rendering (incl. blobs)
  play/
    break-model.ts    the breakage math (unit-tested)
    world.ts          Matter world build, melt, movers, hero slingshot, win/fail
  main.ts             DOM + canvas + gesture glue (the forge)
levels/<scene>/*.json committed shared library (Claude can author these)
public/               manifest, service worker, icons
test/                 Vitest suites
scripts/gen-icons.mjs regenerate the PWA PNG icons (no deps)
```

## The schema (v0.7)

World is fixed at 1600 × 900 units, origin top-left, y down. Positions are object
centres; angles are degrees, clockwise positive. `src/schema.ts` is the single
source of truth — it validates strictly (types, ranges, unique ids, known enums)
with human-readable errors, and migrates older versions forward. Shapes: `box`,
`circle`, `tri`, `emoji`, and `blob` (a painted freeform stroke, physically a
compound of overlapping circles). `meta.hero` is the flung emoji; `meta.background`
selects scenery. The optional `group` / `role` / `sprite` / `hit` fields are
v0.8-forward and round-trip untouched. Use the schema modal (`{ }`) in-app to
copy/paste levels.

## Levels library

Anything under `levels/<scene>/<name>.json` is the committed, shared library. It is
pulled into the bundle at build time, works offline, and shows up (read-only) in
the in-app library alongside your local drafts. To add a level, drop a valid v0.7
JSON file into a scene folder — Claude can author these directly.
