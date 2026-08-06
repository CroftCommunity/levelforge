# Follow-up & backlog

Living notes for whoever (human or Claude) picks this up next. `SPEC.md` is the
contract; this file tracks what's built, what's deliberately deferred, and where
to reach in to extend it.

## Milestone status

| # | Milestone | State |
|---|-----------|-------|
| 1 | Faithful port of the forge (v0.11 / schema v0.7) | ✅ complete |
| 2 | PWA + persistence + GitHub Pages deploy | ✅ complete |
| 3 | Game shell: level select, play route, win/lose, hero progression | ✅ complete |
| 4 | Collab depth | ✅ mostly (see below) |
| 5 | Modes: slingshot + drop + drive | ✅ drop shipped; drive is a prototype |

Schema is at **v0.8** (`src/schema.ts`). Every push to `main` auto-deploys to
`levelforge.croft.ing` via `.github/workflows/deploy.yml`.

## Drop mode + the world refactor (this pass)

**World is level data now.** `level.world` (`w`, `h`, `floorY`) is the single
source; two presets, `WIDE` 1600×900 and `TALL` 900×1600 (floor `h−40`), are the
only sizes the ⚙ shape switch writes. No module reads a global world size —
backdrops (`editor/backdrops.ts` painters take `W,H,fy`), thumbnails
(`renderThumb`), view-fit/clamp (`main.ts`), the magnet floor, physics walls, and
the agent brief (`agentBrief(world)`, computed dims + floor %) all derive from the
level. The shape switch keeps every object coordinate, clamps the spawn, and
toasts a count of pieces now out of bounds.

**Drop mode** (`meta.mode: "drop"`, `src/play/drop.ts`): tap-to-hop descent. The
hero spawns dynamic at the start marker (r 22, friction 0.35, restitution 0.15);
a tap hops it only while grounded or within a coyote window. Grounded detection is
real contact-based and lives in `src/play/grounded.ts` (`GroundTracker` +
`heroHasFooting`), shared-ready for bounce. Feel constants (`HOP`, `COYOTE_MS`, and
the bounce placeholders `JUMP`/`MAX_ROLL`/`ROLL_ACCEL`/`TAP_MS`) live in
`src/play/tuning.ts` — phone-tuned placeholders. Villains restart the run
(attempt++, red flash, no destruction); goals are `role:'goal'` static sensors
(any material), drawn as a catch tray. Fixture: `levels/demo/first-descent.json`.
Editor tie-ins: ⚙ mode cycles slingshot → drop → drive, the 🏁 chip toggles
`role:'goal'`, and drop uses tall by default.

### Naming note vs. SPEC.md/BUILD_PLAN.md

The spec names the three modes `sling`/`drop`/`bounce` with goals expressed only as
`role:'goal'`. This codebase predates that and shipped `slingshot`/`drive` with a
`meta.goal` zone for drive. To keep the schema-as-contract promise (committed
levels and the paste-and-load loop must not break), drop was added **additively**:
`ModeKind` is `slingshot | drop | drive`, and `role:'goal'` is the goal mechanism
for drop. `drive` is the spec's `bounce`; it still reads `meta.goal`. A future pass
that wants full spec parity could migrate `drive→bounce` and `meta.goal→role:'goal'`
in `migrate()` and fold both jump modes onto the shared `grounded.ts`/`tuning.ts`
already in place — the seams are set up for it.

## Ground-stability diagnosis: stale deploy + floor healing (this pass)

**Root cause of "pieces still sink after everything we've done": the fixes
never reached production.** Every push to `main` between the merge of #19
(11:51 UTC) and #24 (12:57 UTC) built fine, but the `deploy-pages` step timed
out with GitHub Pages stuck in `deployment_queued` (runs 21–26 all
failed/cancelled — a Pages-side queue outage). The live bundle was still the
pre-#19 build: no floor-solid `separate()`, no `clampAboveFloor`, wood
`breakAt` still 9, opaque hills. A `workflow_dispatch` re-run (run 27) went
through and the site now serves current `main`. Lesson: when a shipped fix
"doesn't work", check the deploy run for that commit before re-diagnosing the
code — `.github/workflows/deploy.yml` supports manual dispatch for exactly
this.

**Floor healing on load (`enforceFloor`, `src/schema.ts`).** The interaction
fixes only protected *new* placements; levels already saved with buried
pieces (autosave sessions, drafts, pasted JSON, committed files — all written
before the floor rules) restored verbatim and stayed buried forever.
`loadLevel()` now heals: every non-anchored piece is lifted so its
rotation-aware bounding box rests on the floor line (anchored decor stays
put), and a slingshot-mode launcher is planted so its pole base
(`SLING_POLE_BOTTOM`) sits on the floor. Undo/redo snapshots bypass
`loadLevel`, so `afterHistory()` in `main.ts` applies `enforceFloor` too —
rehydrated replay history can hold pre-fix states. Also closed: un-anchoring
a piece now settles it solid (it was exempt while anchored and nothing
re-checked), the launcher drag/shape-switch clamps account for the pole
length, and the editor backdrop is clipped to the board so scenery can't
spill onto the letterbox. Covered in `test/schema.test.ts` ("floor healing on
load").

## Solid pieces in edit mode (this pass)

Pieces placed or moved in the frozen edit view no longer interpenetrate, so a
structure built there doesn't blow apart the instant physics wakes in Test. The
magnet still snaps edges flush; a new overlap-resolution step pushes the piece
being placed/moved/rotated/nudged out of any solid neighbour along the axis of
least penetration, using each shape's world-space AABB (`worldAABB` +
`separate`, pure, in `editor/geometry.ts`, covered by `test/solid.test.ts`).
Flush contact (overlap ≤ `SOLID_EPS`) is left alone, so magnet seams survive.
Weld-group mates (shared non-empty `group`) are skipped — that overlap is
intentional. Wired in `main.ts` via `settleSolid()` at every finalize point
(place, move/pinch/rotate release, nudge). A **Solid pieces** toggle in ⚙
settings (default on, persisted in `lf:prefs.solid`) restores the old
free-placement "objects sit exactly where placed" behaviour when off.

## Full-session autosave + top-right menu (this pass)

**Autosave persists the whole forge session, local-only.** `src/store.ts`
`saveWorking`/`loadWorkingState` write a versioned `{ v:2, level, undo, redo }`
object to `lf:working`, so a reload or offline PWA relaunch restores the working
level **and its full undo/redo replay history** (rehydrated onto the stacks in
`main.ts`). Offline creation and edit jitter make a local snapshot the only
dependable plan. Robustness: on real quota pressure the replay history is shed
oldest-first (undo first, then redo) rather than letting autosave silently die;
when localStorage is unavailable entirely (private mode) the full session is
kept in the in-memory fallback instead of being discarded — `trySetPersistent`
distinguishes `ok`/`quota`/`unavailable`. Legacy bare-`Level` autosaves still
restore. Autosave preference (`lf:autosave`, default **on**) persists too.

**Top-right hamburger menu** (`index.html` `#menu`, wired in `main.ts`). The
less-used top-bar actions moved under a `☰` dropdown — Library, Lexicon (`{ }`),
Settings, How it works — plus the **Autosave** toggle (checked by default).
Undo / redo / rotate / view / ▶ Test stay on the bar. Dismisses on outside
pointerdown or Escape.

**pdsview links** (`src/pdsview.ts`). DID-canonical links into
`pdsview.croft.ing` (`#/at/<did>/<collection>/<rkey>`, matching pdsview's own
routing) for a saved level (`ing.croft.levelforge.level`) and the level lexicon
(standard `com.atproto.lexicon.schema` collection). A save-confirm modal
(`#svmodal`) shows the saved level as a still frame (`renderThumb`) with the
pdsview link below. The schema/Lexicon modal also carries a "view rendered"
link so the format is read as a record, not raw JSON.

> **DEFERRED — wire the real PDS identity.** `src/pdsview.ts` has a single
> placeholder constant `PDS_DID` (`did:plc:REPLACEME…`). While it contains
> `REPLACEME`, `isConfigured()` is false and every link renders as a *preview*
> with an honest note rather than a dead jump. levelforge publishes nothing on
> its own (static PWA, no repo writes — see the constraint below), so:
> 1. **Minimum to go live:** publish levels (and the level lexicon) to a PDS,
>    then set `PDS_DID` to the real repo DID. No other code change — links go
>    live immediately, keyed by `rkeyForLevel(name)` (a slug of the level name).
> 2. **Bigger piece (out of scope this pass):** an actual publish-to-PDS flow
>    (ATProto auth + network write) so a saved level becomes a resolvable
>    record. This crosses the offline-only line and needs its own design.
> Covered by `test/pdsview.test.ts` (URL shape, slugify, unconfigured guard).

## Passthrough (ghost) pieces (this pass)

Solid pieces made a fresh ⧉ copy unusable: the duplicate spawns overlapping its
original, and the immediate overlap-resolution shoved it (or its neighbours)
around before it could be dragged into place. Now one piece at a time can be a
**passthrough ghost** — exempt from solid settling in both directions (it
neither settles nor blocks others), drawn at reduced alpha so the state reads
at a glance. New pieces and copies start as ghosts; the moment a ghost loses
focus (tap elsewhere, select another piece, arm a shape, enter Test) it settles
solid via the usual `separate()` push. A 👻 chip in the selected-piece controls
(right rail in landscape, floating popup in portrait; only shown while Solid
pieces is on) re-enters the mode for any placed piece, e.g. to slip it through
a tight spot. State is the editor-local `passthroughId` in `main.ts` — never
serialized into the schema — released centrally in `syncInspector()` and
cleared without settling wherever the level is replaced wholesale (undo/redo,
JSON load/clear/demo, library/shell loads) so restored states stay exact.

Field fixes from first phone use: ⧉ copy offsets sideways only (the old
diagonal offset sank each copy generation a grid step into the ground), and
`separate()` now takes an optional `floorY` — the ground is solid, so a
*dynamic* piece can't come to rest buried below the floor line (physics would
eject it in Test). Anchored pieces are exempt: static sunken decor stays put.
The portrait piece-menu popup also treats the nudge pad's corner as occupied
when parking, walking the free corners so it covers neither the piece nor the
arrows (covering the pad only as a last resort, never the piece).

## Light/dark theme + opaque floating controls (this pass)

**First-class theme toggle.** ⚙ Settings now leads with a **Theme** control
cycling **dark → light → auto** (`lf:prefs.theme`, default dark so nothing
changes until someone opts in; auto follows `prefers-color-scheme` live). The
pure pref model (normalize/cycle/resolve/label) is `src/theme.ts`, covered by
`test/theme.test.ts`; main.ts applies it (`data-theme` on `<html>`, canvas
letterbox `--stage` fill, `theme-color` meta), and a tiny inline script in
`index.html` mirrors the resolution **before first paint** so there's no flash.
All chrome colors are CSS custom properties now — the dark palette in `:root`
is byte-for-byte the original look, and `html[data-theme='light']` carries the
daylight set (plus `color-scheme`, so form controls/scrollbars follow). Level
content (backdrops, materials, sprites) is untouched — themes only restyle the
chrome around the stage.

**Opaque floating controls (bug fix).** The nudge arrow pad, drive buttons,
and the floating piece-menu popup used translucent backgrounds; a pad button
straddling the world's edge over a pale backdrop (e.g. desert) rendered
half-washed-out and read as a stuck/pressed arrow, and world pieces ghosted
through the popup behind the readout. Those surfaces are opaque tokens now
(`--pad`, `--float`), and the portrait readout is centered so its wrap looks
intentional. `sw.js` cache bumped to `levelforge-v2` so installed PWAs pick up
the new shell.

## Milestone 4 — what shipped vs. left

Shipped: searchable emoji picker (`editor/emoji-data.ts`), custom emoji sprites
(`object.sprite`), weld groups (`object.group` + 🔗 editor chip), protect-role
targets, blob fracture (`play/fracture.ts`), per-emoji hit effects
(`play/behaviors.ts`: pop/explode/shatter/splash/confetti, set via the ✨ chip;
particle bursts rendered in `play/world.ts`), headless-sim trajectory preview
(`play/world.ts` `buildPreview`/`predict`), committed file assets
(`meta.backgroundSrc` / `object.sprite` resolved by `levels-manifest.ts`).

Left:

- **Audio notes as asset files.** Recommendation: **park it.** Recording via
  `MediaRecorder` is easy, but the only storage options are inline dataURLs
  (which bloat the schema JSON — exactly what we moved *away* from for backdrops
  and sprites) or committed files the browser can't write. It isn't "cheap" in a
  way that respects schema-as-contract. Revisit only if voice memos become a
  real need; if so, prefer a committed-file form (`note` sidecar under the level
  folder, resolved like `backgroundSrc`) over dataURLs.

## Known constraint: no client-side repo writes

A static PWA can't write files into the repo, so **authoring** committed image
assets (a sprite/backdrop *file* under `levels/<scene>/`) isn't possible from the
browser. The in-app 🖼 / 🖼️ upload paths therefore store **inline dataURLs**
(`meta.backgroundImage`, `object.sprite`). The committed **file** form is fully
supported on the read/render side — so Claude (or a human via git) authors those
files directly. See `scripts/gen-assets.mjs` for how the demo assets were made.

## Depth / polish opportunities (nice-to-have, not blocking)

- **Drive-mode feel** (`play/drive.ts`). Grounded detection is still a velocity
  heuristic. Drop mode now ships a real contact-based `GroundTracker` +
  `heroHasFooting` in `play/grounded.ts` with coyote time; drive can adopt it
  directly for a quick, spec-aligned upgrade (and share `play/tuning.ts`).
- **Blob fracture depth** (`play/world.ts` `fractureBlob`). Fragments are
  cosmetic debris that fade. Options: make chunks persistent/collidable for
  longer, or split a large blob into two sub-blobs at the impact seam instead of
  circles.
- **Trajectory through dynamic pieces** (`play/world.ts` `buildPreview`). The
  preview mirror is static-only; it could snapshot current dynamic-body
  positions as static proxies each aim for a closer prediction.
- **Emoji search coverage** (`editor/emoji-data.ts`). The keyword DB is a curated
  ~130 entries. For full coverage, bundle `emojibase` data (watch bundle size) or
  the `emoji-picker-element` web component, keeping the OS keyboard fallback.
- **Scene ordering.** Level-select now sorts each scene by newest / backdrop / name
  (see the shell toolbar; helpers in `src/organize.ts`). For an explicit manual
  order, a `meta.order` field or per-scene manifest would still be the next step.
- **PWA update UX** (`public/sw.js`). App shell is cached with a versioned cache;
  consider a "new version available" prompt on service-worker update.
- **Tests.** Physics runtimes (`world.ts`, `drive.ts`) are covered by pure-helper
  unit tests (schema, magnet, break model, fracture placement, behaviors, asset
  resolver) plus a headless-Chromium smoke pass done before each deploy. A
  committed Playwright E2E harness could formalize the smoke checks.

## Adding content

- **New level:** drop a valid v0.8 JSON at `levels/<scene>/<name>.json`. Optional
  committed assets: a backdrop image in the same folder referenced by
  `meta.background: "custom"` + `meta.backgroundSrc: "backdrop.png"`, and custom
  emoji skins under `sprites/` referenced by `object.sprite: "sprites/foo.png"`.
- **Regenerate demo assets / icons:** `node scripts/gen-assets.mjs`,
  `node scripts/gen-icons.mjs` (both dependency-free).
- **Validate before committing:** `npm run typecheck && npm run lint && npm test && npm run build`.

## Where things live

| Area | File |
|------|------|
| Schema (types, validation, migration) | `src/schema.ts` |
| Materials table | `src/materials.ts` |
| Geometry + magnet/grid snapping | `src/editor/geometry.ts` |
| Procedural backdrops + agent brief | `src/editor/backdrops.ts` |
| Per-material rendering (incl. blobs, sprites) | `src/editor/render.ts` |
| Sprite image cache | `src/editor/sprites.ts` |
| Emoji keyword DB / search | `src/editor/emoji-data.ts` |
| Committed levels + asset resolution | `src/levels-manifest.ts` |
| Matter body per object (shared) | `src/play/bodies.ts` |
| Break model | `src/play/break-model.ts` |
| Hit effects (pop/explode/shatter/splash/confetti) | `src/play/behaviors.ts` |
| Blob fracture placement math | `src/play/fracture.ts` |
| Slingshot Test runtime | `src/play/world.ts` |
| Drop runtime (tap-to-hop) | `src/play/drop.ts` |
| Grounded/coyote helper (shared) | `src/play/grounded.ts` |
| Jump-mode feel constants | `src/play/tuning.ts` |
| Drive runtime | `src/play/drive.ts` |
| Theme pref model (dark / light / auto) | `src/theme.ts` |
| Forge + game shell + router (the glue) | `src/main.ts` |
| Persistence (drafts, full-session autosave + replay history, download, manage overlay) | `src/store.ts` |
| pdsview.croft.ing link construction (single DID config point) | `src/pdsview.ts` |
| Shell sort / filter / tag helpers (pure) | `src/organize.ts` |
