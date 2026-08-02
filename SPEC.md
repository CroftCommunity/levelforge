# LEVELFORGE — Build Specification for Claude Code

This document is the contract for building the production version of LevelForge: a
touch-first, phone-friendly 2D physics level editor and test bed, designed for
human-and-Claude collaboration on Angry Birds / Red Ball style games. It distills
five iterations of a working prototype (`reference/levelforge.html`, included in
this repo) that was play-tested on a phone. Where this spec and the prototype
disagree, this spec wins; where this spec is silent, the prototype is the
reference behavior.

## 1. The core idea

The product is not the editor. The product is the **level schema**: a JSON format
that a human edits visually on a phone and Claude reads and writes as text. The
editor is the human's interface to the schema; chat is Claude's. Everything in
this build serves the round trip: build a level by touch, copy the JSON into a
Claude conversation, get edited or brand-new levels back, paste them in, play
them. Notes (free text per object and per level) travel inside the schema so
intent rides along with geometry.

Design principles that emerged from prototyping and must be preserved:

Shape and material are independent axes. Shapes are pure geometry (plank, block,
ball, tri, emoji); materials carry all physics (wood, stone, metal, ice, rubber,
target). New pieces stamp in the current material.

Modes are explicit and mutually exclusive. Adjust (select and manipulate), view
(pan and zoom), and stamp (armed shape places on tap) never overlap, so a touch
always means one thing.

Edit mode is a frozen god view with no gravity. Physics exists only in Test.
Precision comes from grid snap plus magnet snapping, never from simulation.

The board gets the screen. Chrome is icon-first, collapsible, and pushed to side
rails in landscape.

Every mutation is one undo step. Whole gestures (a full drag or pinch) are single
steps, not micro-steps.

## 2. Deployment model

Own repository. Static site (no backend, all client-side), deployed to a
subdomain of croft.ing alongside the fun.croft.ing games, via whatever static
hosting that domain already uses (GitHub Pages or equivalent — confirm with the
repo owner and match the existing setup). Installable PWA: web app manifest,
service worker with offline caching of the app shell and committed levels,
landscape orientation preferred but portrait functional.

Recommended stack: Vite + TypeScript, no UI framework (the prototype proves
vanilla DOM + canvas is sufficient and it keeps the PWA tiny). Matter.js
(currently 0.19.x) as the physics engine, bundled rather than CDN-loaded so
offline works. Vitest for unit tests. Prettier + ESLint.

Repository layout:

```
levelforge/
  index.html
  src/
    schema.ts        # types, validation, migration — the single source of truth
    materials.ts     # material table (section 4)
    editor/          # canvas, gestures, tray, inspector, library
    play/            # Matter world build, break model, melt, movers, slingshot
    store.ts         # localStorage drafts + import/export
  levels/
    <scene-name>/
      <level-name>.json
  reference/
    levelforge.html  # the chat prototype, kept as living documentation
  public/
    manifest.webmanifest, icons, service worker
  SPEC.md            # this file
```

Committed levels under `levels/` are the shared library: the site loads them by
fetch, and Claude can author them as ordinary files in the repo. A scene is a
folder. The in-app library (section 8) reads both committed levels and local
drafts.

## 3. Level schema v0.4

The schema is versioned with a `schemaVersion` string. The app must load any
prior version (0.2 and 0.3 exist in the wild from the prototype) by migrating
forward; migrations live in `schema.ts` next to the types. Never mutate the
meaning of an existing field; add fields instead.

World space is fixed at 1600 × 900 units, origin top-left, y down. All positions
are object centers. Angles are degrees, clockwise positive. Sizes and positions
are snapped to a 10-unit grid at rest (magnet-snapped values may be off-grid and
that is correct — flush contact beats grid purity).

```jsonc
{
  "schemaVersion": "0.4",
  "meta": {
    "name": "untitled",
    "scene": "",             // scene = folder = ordered set of levels
    "gravity": 1,            // multiplier on engine default
    "note": ""               // level-wide intent, free text
  },
  "world": { "w": 1600, "h": 900, "floorY": 860 },
  "slingshot": { "x": 230, "y": 770 },
  "objects": [
    {
      "id": "o1",            // "o" + integer, unique within level
      "shape": "box",        // box | circle | tri | emoji
      "x": 1100, "y": 820,
      "w": 30, "h": 80,      // box and tri only
      // "r": 30,            // circle and emoji only
      "angle": 0,
      "material": "wood",    // key into the material table
      "anchored": false,     // static body
      "path": null,          // or { "x": ..., "y": ..., "speed": 90 }
      "note": "",            // per-object intent, free text
      // "emoji": "🎃",      // emoji shape only
      // --- v0.4 additions, editor support per roadmap ---
      // "weld": "groupA",   // objects sharing a weld id form one compound body
      // "role": "destroy"   // targets only: destroy (default) | protect
    }
  ]
}
```

Field semantics that are easy to get wrong:

`anchored` and `path` both produce a static body; `path` additionally moves it
kinematically, ping-ponging between (x, y) and (path.x, path.y) at `speed`
world-units per second. A pathed object ignores `anchored`.

`tri` is an isoceles wedge, apex up, defined by bounding w × h, with vertices
expressed relative to the triangle's centroid so drawing and physics agree:
(-w/2, h/3), (w/2, h/3), (0, -2h/3). Rotation covers ramps and deflectors.

`emoji` is physically a circle of radius r in its material; the glyph is skin.

`role: "protect"` inverts the win interaction for that target: breaking it fails
the level instead of clearing it (the "hostage" variant). Win condition overall:
all destroy-role targets broken and no protect-role target broken.

Validation must be strict on load (types, ranges, unique ids, known enums) with
a human-readable error surfaced in the paste-and-load UI, because hand-written
and Claude-written JSON is a first-class input path.

## 4. Materials

Materials carry all physics. Values below are the play-tested prototype numbers;
keep them in one table in `materials.ts` and treat them as tuning knobs.

| material | density | friction | restitution | breakAt | special |
|----------|---------|----------|-------------|---------|---------|
| wood     | 0.0010  | 0.40     | 0.20        | 9       | grain texture |
| stone    | 0.0025  | 0.60     | 0.10        | 20      | speckle texture |
| metal    | 0.0040  | 0.30     | 0.05        | never   | rivet border |
| ice      | 0.0009  | 0.05     | 0.10        | 6.5     | melts in Test (see 7) |
| rubber   | 0.0012  | 0.90     | 0.85        | never   | highlight sheen |
| target   | 0.0008  | 0.50     | 0.30        | 3.2     | creature face; win condition |

Rendering is procedural-canvas per material (see the prototype's
`drawMaterialCtx`): the texture is the label, which is why the UI can be
icon-only. Ice renders at ~0.82 alpha.

## 5. Editor interaction model

Three input modes, shown as tray buttons, exactly one active:

**✋ Adjust** (default). Tap a piece to select. Drag moves it; after ~10 screen
px of touch movement the piece lifts 80/zoom world-units above the fingertip so
the drop point is visible (mouse input does not lift). Two-finger pinch on a
selection resizes (min 24 box side, min 14 radius); twist rotates in whole
degrees. Tap empty space to deselect. The slingshot and each path endpoint are
draggable handles.

**🔍 View.** One finger pans, two fingers pinch-zoom 1×–4× about the gesture
midpoint, double-tap resets to fit. Pan/zoom clamps to the board. A zoom badge
shows when zoomed. Entering Test resets the view.

**Stamp** (any armed shape). Tapping the board places the shape, centered under
the finger, in the current material, and selects it; the shape stays armed for
repeated stamping. Tapping the armed plank flips its orientation
(horizontal/vertical) in place, updating the tray icon. Tapping the armed emoji
tile reopens the emoji picker. Arming exits view mode; ✋ or 🔍 disarms.

Snapping: positions and sizes grid-snap to 10 on gesture end. During moves and on
placement, a magnet snaps edges and centers to other pieces' edges and centers
and bottoms to the floor, threshold 14/zoom + 4 world units, for axis-aligned
pieces only (angle a multiple of 90°; circles and emoji always; triangles never
— extend per roadmap). Magnet-snapped axes skip grid snap so contact stays
flush.

Undo/redo: snapshot the whole level JSON at the start of every mutating action
(place, delete, material change, toggles, note save, gesture start, clear, load,
library load). Stack depth ≥ 80. Buttons live top-left (↶) and top-right (↷)
and disable when empty.

Selection inspector shows, always in the same order: material swatches (with
small text labels), then behavior — ⚓ anchored, ↔ moving, ✎ note, ✕ delete —
then a live readout `x,y · w×h (or r) · angle°`. The material row doubles as the
stamp-material picker when nothing is selected; picking a material with a
selection repaints it and sets the stamp.

Layout: portrait stacks topbar / board / tray / inspector; landscape puts the
tray as a left rail and the inspector as a right rail with the board maximized
between. Rails must not need scrolling on a typical phone in landscape — if the
current control set overflows, shrink or group controls rather than scroll (a
known rough edge in the prototype). Test mode hides both rails.

## 6. Notes and dictation

The ✎ editor is a modal textarea. A 🎤 button runs the Web Speech API
(`SpeechRecognition` / `webkitSpeechRecognition`), continuous mode, appending
final transcripts; it must degrade gracefully (clear message, typing still
works) where the API or mic permission is unavailable. In the installed PWA this
is the primary path because the on-screen keyboard's dictation eats screen
space. Notes are plain strings in the schema. Recorded audio as a level asset
(file in the level's folder, referenced by filename) is roadmap, not v1.

## 7. Test mode (play)

Build a Matter.js world from the schema: static floor slab below `floorY`,
static side walls, one body per object with its material's density, friction,
restitution. Enable sleeping. Pathed objects are static bodies moved each frame
along their ping-pong path with both `setPosition` and matching `setVelocity`
so they impart momentum.

Breakage: on `collisionStart`, compute relative speed of the pair. For each
breakable body in the pair, impact = speed × 0.55 if the other body is static,
else speed × min(otherMass, 10) × 0.3. Break (remove) when impact exceeds the
material's breakAt. Skip all breakage during the first 500 ms of Test (settle
grace) so imperfectly placed pieces land quietly — omitting this reproduced a
memorable bug where fresh ice "fell through the floor" (it was shattering on
floor contact).

Ice melts: every frame, scale each ice body by 0.9985 (both physics via
`Body.scale` and render size), removing it below 30% of original. Ice pillars
are timed supports; this is a deliberate mechanic, keep it.

Slingshot: a rubber ball (r 22, density 0.0016) loads at the launcher. Drag
within reach pulls it back (capped at 200 units) with band rendering and a
dotted aim preview (the preview is a visual approximation, not a physics-exact
trajectory — replacing it with a short headless simulation is a nice
improvement). Release launches at 0.16 × pull vector; a fresh ball loads ~3.8 s
after launch. Win: all destroy-role targets broken (banner "LEVEL CLEAR");
protect-role targets breaking shows a fail banner and offers reset. ■ returns to
edit with the level exactly as authored.

## 8. Library and persistence

In the deployed app, persistence has three layers. Local drafts: autosave the
working level and named saves to localStorage (the artifact prototype used a
chat-specific storage API; localStorage is correct in the PWA). Committed
levels: everything under `levels/<scene>/` in the repo, listed via a build-time
manifest. Exchange: the schema modal's Copy / Paste & Load round trip with
Claude in chat, plus a Download .json button.

The library UI groups by scene as horizontal rows of thumbnail cards (render the
level small onto a canvas — the prototype's `renderThumb` is the reference),
newest first, tap to load, ✕ to delete local drafts (committed levels are
read-only in-app; deleting those is a git operation). Saving writes name and
scene into `meta`.

## 9. Milestones

1. **Port**: reproduce the prototype feature-for-feature in the Vite/TS
   structure with `schema.ts` validation and migrations, unit tests on schema,
   magnet math, and the break model. Deploy behind the subdomain.
2. **PWA + persistence**: manifest, service worker, offline, localStorage
   drafts, levels/ manifest loading, download/copy/paste flows.
3. **Schema v0.4 features**: weld groups (compound bodies via Matter parts,
   editor UX: select piece → weld chip → join to selection), protect-role
   targets with fail state.
4. **Polish backlog**: angled snapping (contact-point snapping for rotated
   pieces), per-emoji hit behaviors (💣 explodes with area impulse, ⭐ score
   pickup, etc. — a small behavior registry keyed by emoji), trajectory preview
   via headless sim, sound, level-select page for playing a scene start to
   finish.
5. **Character mode** (the Red Ball direction): a controllable ball with tuned
   platformer feel, goal zones instead of slingshot. This is a distinct game
   mode reading the same schema; do not let rigid-body defaults stand in for
   platforming feel — it will need its own tuning pass and likely custom
   contact handling.

## 10. Working agreement

The human builds and annotates levels on a phone; Claude reads, critiques, and
writes levels as JSON, and Claude Code implements against this spec. Keep
`schema.ts` and this spec in sync in the same commit whenever the schema
changes, and bump `schemaVersion` for any additive change. When behavior
questions come up that this spec doesn't answer, check `reference/levelforge.html`
first, then ask.

---

## Implementation status

This section tracks what the current build implements against the milestones
above. Update it alongside code changes.

- **Milestone 1 (Port): complete.** The prototype is reproduced feature-for-feature
  in the Vite/TS structure. `src/schema.ts` is the single source of truth for
  types, strict validation, and forward migration (0.2 → 0.3 → 0.4). Unit tests
  cover schema validation/migration, magnet math, and the break model.
- **Milestone 2 (PWA + persistence): substantially complete.** Web app manifest,
  service worker with app-shell + committed-level offline caching, localStorage
  drafts + working-level autosave, build-time `levels/` manifest loading, and the
  Copy / Paste & Load / Download `.json` exchange flows are all implemented.
- **Milestone 3 (Schema v0.4): partial.** The schema types, validation, and
  migration are v0.4. Play-side `protect`-role targets (fail state) and `weld`
  compound bodies are implemented. Editor UX for authoring weld groups and the
  protect role is minimal (roles/welds round-trip through JSON and are honored in
  Test; a richer editor affordance is future work).
- **Milestones 4–5:** not started (polish backlog and Character mode).
