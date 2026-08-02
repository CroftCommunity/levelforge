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

## Milestone 4 — what shipped vs. left

Shipped: searchable emoji picker (`editor/emoji-data.ts`), custom emoji sprites
(`object.sprite`), weld groups (`object.group` + 🔗 editor chip), protect-role
targets, blob fracture (`play/fracture.ts`), per-emoji hit behaviors
(`play/behaviors.ts`, 💣 explode), headless-sim trajectory preview
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
- **Scene ordering.** Level-select orders by filename within a scene. If deliberate
  ordering matters, add a `meta.order` field or a per-scene manifest.
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
| Hit behaviors (explode) | `src/play/behaviors.ts` |
| Blob fracture placement math | `src/play/fracture.ts` |
| Slingshot Test runtime | `src/play/world.ts` |
| Drop runtime (tap-to-hop) | `src/play/drop.ts` |
| Grounded/coyote helper (shared) | `src/play/grounded.ts` |
| Jump-mode feel constants | `src/play/tuning.ts` |
| Drive runtime | `src/play/drive.ts` |
| Forge + game shell + router (the glue) | `src/main.ts` |
| Persistence (drafts, autosave, download) | `src/store.ts` |
