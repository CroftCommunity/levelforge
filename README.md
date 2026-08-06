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

See [`SPEC.md`](./SPEC.md) for the full build specification,
[`FOLLOWUP.md`](./FOLLOWUP.md) for milestone status + the remaining backlog, and
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
  schema.ts           types, strict validation, forward migration (0.2 -> 0.8)
  materials.ts        the material table (all physics lives here)
  store.ts            localStorage drafts + working-level autosave + download + manage overlay
  organize.ts         pure sort / filter / tag helpers for the shell
  levels-manifest.ts  committed levels bundled at build time
  editor/
    geometry.ts       pure geometry + magnet/grid snapping + blob hit math
    backdrops.ts      six procedural scenes, custom image, agent brief
    render.ts         procedural per-material canvas rendering (incl. blobs)
    emoji-data.ts     bundled emoji keyword DB for offline picker search
  play/
    bodies.ts         one Matter body per object (shared by both runtimes)
    break-model.ts    the breakage math (unit-tested)
    behaviors.ts      per-emoji hit effects (pop/explode/shatter/splash/confetti)
    world.ts          slingshot Test: build, melt, movers, hero, explode, win/fail
    drive.ts          drive mode (Red Ball): a steerable hero + goal zone
  main.ts             DOM + canvas + gesture glue: forge, game shell, router
levels/<scene>/*.json committed shared library (Claude can author these)
public/               manifest, service worker, icons
test/                 Vitest suites
scripts/gen-icons.mjs regenerate the PWA PNG icons (no deps)
```

## Screens & routing

The app opens on a **level-select shell** (`#/`) grouped by scene; tapping a card
plays it (`#/play/<scene>/<file>` deep-links straight into play), with retry / next
/ back chrome. `✎ Forge` (`#/forge`) opens the editor on your working level.

The shell doubles as the **level manager**. `＋ New level` opens a wizard (pick a
backdrop, hero, and world shape, name it) that creates a draft and drops you into
the forge. Local drafts appear here alongside committed levels; each card has a
`⋯` menu to tag it, archive it, or (drafts only) delete it. Archived levels are
hidden behind a **show archived** toggle, a tag-filter row narrows the list, and a
sort control orders each scene by newest / backdrop / name. Archive state and tags
live in a small `lf:manage` localStorage overlay (see `src/store.ts`), kept outside
the level JSON so they apply to committed levels too and never rewrite a heavy
draft; the pure sort/filter helpers are in `src/organize.ts`.

## Modes

- **Slingshot** (default): fling `meta.hero` at villains (target-material emoji);
  clear them all. Emoji can carry a **hit effect** (`object.hit`) that fires when
  destroyed — `pop`, `explode`, `shatter`, `splash`, `confetti`; 💣/🧨 default to
  explode and chain-detonate neighbours. Set it via the ✨ chip on a selected emoji.
- **Drop** (`meta.mode: "drop"`, tap-to-hop descent): the hero spawns at the start
  marker and falls; tap anywhere to hop, but only while grounded (real contact
  underfoot) or within a short coyote window. Villains are hazards — touching one
  flashes red and restarts the run (attempt counter, nothing destroyed). Reach an
  object marked `role: "goal"` (a static sensor drawn as a catch tray) to clear.
  Tall worlds suit it; grounded/coyote/feel constants live in `src/play/tuning.ts`.
- **Drive** (`meta.mode: "drive"`, Red Ball style): steer the hero with on-screen
  ◀ ▶ / jump and reach the `meta.goal` 🏁 zone; target pieces are hazards. The
  hero is a rubber ball; its bounciness is tunable per level via a Settings
  slider (`meta.bounce`, restitution 0–1; unset uses the rubber default).

## The schema (v0.8)

World dimensions are **level data**, not a constant: `level.world` carries `w`,
`h`, `floorY`. Two editor presets — **wide** (1600 × 900) and **tall** (900 ×
1600, floor at `h − 40`) — are the only sizes the ⚙ shape switch writes; tall is
first-class for drop mode and portrait play. Every module (backdrops, thumbnails,
view-fit, magnet floor, physics walls, the agent brief) derives from the level it
was handed — nothing reads a global world size. Origin top-left, y down. Positions
are object centres; angles are degrees, clockwise positive. `src/schema.ts` is the single
source of truth — it validates strictly (types, ranges, unique ids, known enums)
with human-readable errors, and migrates older versions forward (renaming the
legacy `weld` key to `group`). Shapes: `box`, `circle`, `tri`, `emoji`, and `blob`
(a painted freeform stroke, physically a compound of overlapping circles).
`meta.hero` is the hero emoji; `meta.background` selects scenery; `meta.mode` and
`meta.goal` drive the game mode. Per-object `group` (weld), `role` (destroy /
protect on targets, or `goal` on any object to mark a goal zone), `hit` (behavior
key), and `sprite` are supported and round-trip. Use the
schema modal (`{ }`) in-app to copy/paste levels.

## Levels library

Anything under `levels/<scene>/<name>.json` is the committed, shared library. It is
pulled into the bundle at build time, works offline, and powers both the shell and
the in-app library (alongside your local drafts). To add a level, drop a valid v0.8
JSON file into a scene folder — Claude can author these directly.
