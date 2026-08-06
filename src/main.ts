/* =====================================================================
   main.ts — the Emoji Wars forge (editor) application.

   Ports the play-tested prototype (reference/levelforge.html, forge v0.11)
   into the typed, modular structure: schema/materials/geometry/render/
   backdrops/store are the reusable cores; this file is the DOM + canvas +
   gesture glue. Sections mirror the reference: view, undo/redo, drawing,
   gestures + paint, nudge pad, tray, topbar, emoji picker, settings,
   backdrops, inspector, notes, schema modal, library, and Test mode.
   ===================================================================== */

import {
  Level,
  LevelObject,
  ShapeKind,
  BackgroundKind,
  emptyLevel,
  maxIdNum,
  serializeLevel,
  parseLevel,
  WIDE,
  TALL,
  floorYFor,
  DEFAULT_HERO,
  BRUSH_DEFAULT,
  WorldShape,
} from './schema';
import { MATERIALS, MaterialKey } from './materials';
import { SNAP, snapN, triVerts, pointInTri, distToSeg, magnetSnap, separate, clampToWorld, GeomObject } from './editor/geometry';
import { drawSlingshotCtx, drawMaterialCtx, renderThumb, DEG } from './editor/render';
import { drawBackdrop, agentBrief } from './editor/backdrops';
import {
  saveWorking,
  loadWorkingState,
  loadAutosavePref,
  saveAutosavePref,
  saveDraft,
  listDrafts,
  deleteDraft,
  hasPersistentStore,
  downloadLevel,
  manageKey,
  getManage,
  setArchived,
  setTags,
} from './store';
import * as pdsview from './pdsview';
import { committedLevels } from './levels-manifest';
import {
  LevelEntry,
  SortKey,
  SORT_KEYS,
  SORT_LABELS,
  allTags,
  filterEntries,
  sortEntries,
} from './organize';
import { PlaySession } from './play/world';
import { DriveSession } from './play/drive';
import { DropSession } from './play/drop';
import { searchEmoji } from './editor/emoji-data';
import { behaviorFor, EFFECTS, HIT_BEHAVIORS } from './play/behaviors';
import { ThemePref, DEFAULT_THEME, normalizeTheme, cycleTheme, resolveTheme, themeLabel } from './theme';

const MAXZOOM = 4;
const BRUSH = BRUSH_DEFAULT;

/* ---------------------------- shape presets --------------------------- */
interface ShapePreset {
  name: string;
  shape: ShapeKind;
  w?: number;
  h?: number;
  r?: number;
  rotatable?: boolean;
}
const SHAPES: ShapePreset[] = [
  { name: 'plank', shape: 'box', w: 170, h: 24, rotatable: true },
  { name: 'block', shape: 'box', w: 72, h: 72 },
  { name: 'ball', shape: 'circle', r: 30 },
  { name: 'tri', shape: 'tri', w: 90, h: 70 },
  { name: 'emoji', shape: 'emoji', r: 30 },
  { name: 'paint', shape: 'blob' },
];

const EMOJI_PALETTE = [
  '😀', '😎', '🥸', '🤠', '🥶', '🤡', '👻', '💀', '👽', '🤖', '👿', '😈',
  '🎃', '🐶', '🐱', '🦊', '🐻', '🐼', '🐸', '🦆', '🐟', '🐙', '🦀', '🐢',
  '🦖', '🐉', '🕷️', '🐝', '🌵', '🌲', '🍄', '🌸', '🍉', '🍕', '🍩', '🎂',
  '⚽', '🏀', '🎳', '🎯', '🎲', '🧨', '💣', '🧱', '🪵', '🪨', '⭐', '🌙',
  '☄️', '⚡', '🔥', '❄️', '💧', '🌈', '💎', '🔔', '🎁', '🏆', '🚗', '🚀',
  '⚓', '🛸', '🎈', '🪁', '🧊', '🫧', '🥊', '🛡️', '⚔️', '🔮', '🧲', '💰',
];

/* ------------------------------ prefs --------------------------------- */
interface Prefs {
  afterPlace: 'adjust' | 'stamp';
  /** Solid pieces: push placed/moved pieces out of overlap so structures hold. */
  solid: boolean;
  /** Chrome palette: dark (default), light, or auto (follow the OS). */
  theme: ThemePref;
  hero: string;
  recents: string[];
}
const PREFS_KEY = 'lf:prefs';
function loadPrefs(): Prefs {
  const fallback: Prefs = { afterPlace: 'adjust', solid: true, theme: DEFAULT_THEME, hero: DEFAULT_HERO, recents: ['🎃', '💣', '⭐', '🦆', '👿'] };
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw);
    return {
      afterPlace: p.afterPlace === 'stamp' ? 'stamp' : 'adjust',
      solid: p.solid === false ? false : true,
      theme: normalizeTheme(p.theme),
      hero: typeof p.hero === 'string' && p.hero ? p.hero : DEFAULT_HERO,
      recents: Array.isArray(p.recents) && p.recents.length ? p.recents.slice(0, 10) : fallback.recents,
    };
  } catch {
    return fallback;
  }
}
function savePrefs(): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ afterPlace: settings.afterPlace, solid: settings.solid, theme: settings.theme, hero: prefHero, recents: emojiRecents }));
  } catch {
    /* ignore */
  }
}

const prefs = loadPrefs();
const settings = { afterPlace: prefs.afterPlace, solid: prefs.solid, theme: prefs.theme };

/* ------------------------------ theme --------------------------------- */
// The inline <head> script already set data-theme before first paint; this is
// the live side — re-apply on toggle and when the OS scheme flips under auto.
const systemDarkMq = window.matchMedia('(prefers-color-scheme: dark)');
let stageFill = '#0a0f16'; // canvas letterbox outside the world; synced to --stage
function applyTheme(): void {
  const resolved = resolveTheme(settings.theme, systemDarkMq.matches);
  document.documentElement.dataset.theme = resolved;
  const css = getComputedStyle(document.documentElement);
  stageFill = css.getPropertyValue('--stage').trim() || stageFill;
  // keep the browser/OS chrome (address bar, status bar) matched to the shell
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', css.getPropertyValue('--bg').trim() || '#0f1722');
}
systemDarkMq.addEventListener('change', () => {
  if (settings.theme === 'auto') {
    applyTheme();
    syncSettings();
  }
});
let prefHero = prefs.hero;
let emojiRecents = [...prefs.recents];
let curEmoji = '🎃';
let emojiFor: 'stamp' | 'hero' | 'newlevel' = 'stamp';

let idSeq = 1;
const nid = (): string => 'o' + idSeq++;
let curMat: MaterialKey = 'wood';

function demoObjects(): LevelObject[] {
  const F = 860;
  return [
    { id: nid(), shape: 'box', x: 1100, y: F - 40, w: 30, h: 80, angle: 0, material: 'wood', anchored: false, path: null, note: '' },
    { id: nid(), shape: 'box', x: 1240, y: F - 40, w: 30, h: 80, angle: 0, material: 'wood', anchored: false, path: null, note: '' },
    { id: nid(), shape: 'box', x: 1170, y: F - 95, w: 220, h: 26, angle: 0, material: 'wood', anchored: false, path: null, note: '' },
    { id: nid(), shape: 'blob', x: 960, y: F - 120, angle: 0, material: 'stone', anchored: true, path: null, brushR: 26, pts: [[-60, 110], [-40, 40], [-10, -30], [20, -90], [45, -110]], note: 'painted stone spire' },
    { id: nid(), shape: 'emoji', x: 1170, y: F - 133, r: 26, angle: 0, material: 'target', emoji: '👿', anchored: false, path: null, note: 'villain on the roof' },
    { id: nid(), shape: 'emoji', x: 1170, y: F - 38, r: 26, angle: 0, material: 'target', emoji: '🎃', anchored: false, path: null, note: 'villain in the house' },
    { id: nid(), shape: 'box', x: 560, y: F - 260, w: 180, h: 22, angle: 0, material: 'metal', anchored: true, path: { x: 820, y: F - 260, speed: 90 }, note: 'moving platform' },
  ];
}

// Restore the whole forge session from the local autosave: the working level
// plus its undo/redo replay history (see restore below, once the stacks exist).
const restored = loadWorkingState();
let level: Level = restored?.level ?? withHero(emptyLevel());
idSeq = maxIdNum(level) + 1;

function withHero(l: Level): Level {
  l.meta.hero = prefHero;
  return l;
}

/* ------------------------------ DOM refs ------------------------------ */
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const cv = $<HTMLCanvasElement>('cv');
const ctx = cv.getContext('2d')!;

/* ------------------------------- autosave ----------------------------- */
let autosaveDue = false;
let lastAutosaveT = 0;
let autosaveOn = loadAutosavePref();
function scheduleAutosave(): void {
  autosaveDue = true;
}
/** Persist the current level plus the full replay history right now. */
function autosaveNow(): void {
  saveWorking({ level, undo: undoStack, redo: redoStack, savedAt: Date.now() });
}

/* ------------------------------ undo / redo --------------------------- */
const undoStack: string[] = [];
const redoStack: string[] = [];
// Rehydrate the replay history saved alongside the working level so undo/redo
// survive a reload or offline relaunch.
if (restored) {
  for (const s of restored.undo) undoStack.push(s);
  for (const s of restored.redo) redoStack.push(s);
}
function snap(): void {
  undoStack.push(JSON.stringify(level));
  if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0;
  syncHistoryBtns();
  scheduleAutosave();
}
function doUndo(): void {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(level));
  level = JSON.parse(undoStack.pop()!);
  afterHistory();
}
function doRedo(): void {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(level));
  level = JSON.parse(redoStack.pop()!);
  afterHistory();
}
function afterHistory(): void {
  selId = null;
  gesture = null;
  // the level was replaced wholesale — drop the exemption without settling so
  // the restored state stays exactly as recorded
  passthroughId = null;
  idSeq = Math.max(idSeq, maxIdNum(level) + 1);
  syncInspector();
  syncHistoryBtns();
  syncHero();
  syncBg();
  scheduleAutosave();
}
function syncHistoryBtns(): void {
  $<HTMLButtonElement>('undo').disabled = !undoStack.length;
  $<HTMLButtonElement>('redo').disabled = !redoStack.length;
}

/* ---------------------- canvas + zoomable view ------------------------ */
interface View {
  scale: number;
  ox: number;
  oy: number;
  fit: number;
  zoom: number;
}
const view: View = { scale: 1, ox: 0, oy: 0, fit: 1, zoom: 1 };
let cw = 1;
let chh = 1;

function orient(): void {
  document.body.classList.toggle('land', window.innerWidth > window.innerHeight * 1.15);
}
function clampView(): void {
  view.zoom = Math.min(Math.max(view.zoom, 1), MAXZOOM);
  view.scale = view.fit * view.zoom;
  const W = level.world.w * view.scale;
  const H = level.world.h * view.scale;
  if (W <= cw) view.ox = (cw - W) / 2;
  else view.ox = Math.min(0, Math.max(cw - W, view.ox));
  if (H <= chh) view.oy = (chh - H) / 2;
  else view.oy = Math.min(0, Math.max(chh - H, view.oy));
}
function resize(): void {
  orient();
  const r = cv.parentElement!.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, r.width * dpr);
  cv.height = Math.max(1, r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cw = r.width;
  chh = r.height;
  view.fit = Math.min(cw / level.world.w, chh / level.world.h);
  clampView();
  if (selId) placeSelwrap();
}
function resetView(): void {
  view.zoom = 1;
  clampView();
}
window.addEventListener('resize', () => setTimeout(resize, 80));
// Recompute the canvas the instant its box changes (orientation, layout, rail
// reflow) rather than waiting on the debounced window-resize — keeps the world
// mapping in sync so a drag never lands on stale coordinates.
if ('ResizeObserver' in window) {
  let lw = 0;
  let lh = 0;
  new ResizeObserver((entries) => {
    const cr = entries[0].contentRect;
    if (Math.abs(cr.width - lw) < 0.5 && Math.abs(cr.height - lh) < 0.5) return;
    lw = cr.width;
    lh = cr.height;
    resize();
  }).observe(cv.parentElement!);
}

const s2w = (sx: number, sy: number): { x: number; y: number } => {
  const r = cv.getBoundingClientRect();
  return { x: (sx - r.left - view.ox) / view.scale, y: (sy - r.top - view.oy) / view.scale };
};
const scr = (e: PointerEvent): { sx: number; sy: number } => {
  const r = cv.getBoundingClientRect();
  return { sx: e.clientX - r.left, sy: e.clientY - r.top };
};

/* ------------------------------ drawing ------------------------------- */
function drawWorldBase(editGrid: boolean): void {
  ctx.clearRect(0, 0, cw, chh);
  ctx.fillStyle = stageFill;
  ctx.fillRect(0, 0, cw, chh);
  ctx.save();
  ctx.translate(view.ox, view.oy);
  ctx.scale(view.scale, view.scale);
  drawBackdrop(ctx, level, editGrid);
}

/** A spawn pad for the non-slingshot modes (the launcher reinterpreted). */
function drawStartPad(c: CanvasRenderingContext2D, x: number, y: number): void {
  c.save();
  c.strokeStyle = 'rgba(200,215,235,.8)';
  c.lineWidth = 3 / view.zoom;
  c.setLineDash([8, 7]);
  c.beginPath();
  c.arc(x, y, 30, 0, 7);
  c.stroke();
  c.setLineDash([]);
  c.fillStyle = 'rgba(200,215,235,.85)';
  c.font = '14px ui-monospace,monospace';
  c.textAlign = 'center';
  c.fillText('start', x, y + 52);
  c.restore();
}

function drawEdit(): void {
  drawWorldBase(true);
  const sx = level.slingshot.x;
  const sy = level.slingshot.y;
  if (level.meta.mode === 'slingshot') {
    drawSlingshotCtx(ctx, sx, sy, true);
    // ghost hero at the launcher
    drawMaterialCtx(ctx, { shape: 'emoji', x: sx, y: sy - 30, r: 22, angle: 0, material: 'rubber', emoji: level.meta.hero || DEFAULT_HERO }, true);
  } else {
    // drop/drive reinterpret the launcher as a spawn pad
    drawStartPad(ctx, sx, sy);
    drawMaterialCtx(ctx, { shape: 'emoji', x: sx, y: sy, r: 22, angle: 0, material: 'rubber', emoji: level.meta.hero || DEFAULT_HERO }, true);
  }
  // drive-mode goal handle
  if (level.meta.mode === 'drive' && level.meta.goal) {
    const g = level.meta.goal;
    ctx.save();
    ctx.strokeStyle = '#ffd24a';
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 3 / view.zoom;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r, 0, 7);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = g.r * 1.1 + 'px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏁', g.x, g.y);
    ctx.restore();
  }

  if (level.objects.length === 0 && !(gesture && gesture.kind === 'paint')) {
    ctx.fillStyle = 'rgba(200,212,228,.85)';
    ctx.font = '30px ui-monospace,monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      armed ? (armed.shape === 'blob' ? 'drag to paint' : 'tap the board to stamp') : 'arm a shape, then tap the board · 💡 explains everything',
      level.world.w / 2,
      level.world.h * 0.42,
    );
  }
  for (const o of level.objects) {
    if (o.path) {
      ctx.strokeStyle = 'rgba(120,170,230,.7)';
      ctx.setLineDash([8, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(o.path.x, o.path.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#6fa9e6';
      ctx.beginPath();
      ctx.arc(o.path.x, o.path.y, 12, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#0f1722';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('↔', o.path.x, o.path.y);
    }
    // the passthrough piece renders as a ghost so "not yet solid" is visible
    const ghost = o.id === passthroughId;
    if (ghost) ctx.globalAlpha = 0.55;
    drawMaterialCtx(ctx, o, false);
    if (ghost) ctx.globalAlpha = 1;
  }
  // live paint preview
  if (gesture && gesture.kind === 'paint' && gesture.pts.length) {
    drawMaterialCtx(ctx, { shape: 'blob', x: 0, y: 0, angle: 0, material: curMat, brushR: BRUSH, pts: gesture.pts.map((p) => [p.x, p.y] as [number, number]) }, true);
  }
  const sel = selected();
  if (sel) {
    ctx.save();
    ctx.translate(sel.x, sel.y);
    ctx.rotate((sel.angle || 0) / DEG);
    ctx.strokeStyle = '#ff8a3d';
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2.5 / view.zoom;
    if (sel.shape === 'box') {
      ctx.strokeRect(-sel.w! / 2 - 6, -sel.h! / 2 - 6, sel.w! + 12, sel.h! + 12);
    } else if (sel.shape === 'tri') {
      const v = triVerts({ w: sel.w!, h: sel.h! });
      ctx.beginPath();
      ctx.moveTo(v[0].x, v[0].y);
      ctx.lineTo(v[1].x, v[1].y);
      ctx.lineTo(v[2].x, v[2].y);
      ctx.closePath();
      ctx.stroke();
    } else if (sel.shape === 'blob') {
      ctx.lineWidth = (sel.brushR ?? BRUSH) * 2 + 12;
      ctx.globalAlpha = 0.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const pts = sel.pts!;
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.1, pts[0][1]);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, sel.r! + 7, 0, 7);
      ctx.stroke();
    }
    // corner grab-handles: drag one to free-rotate the piece in place
    const ext = handleExtents(sel);
    if (ext) {
      // for non-box shapes, draw the rectangular guide the handles sit on
      if (sel.shape !== 'box') {
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = '#ff8a3d';
        ctx.lineWidth = 2 / view.zoom;
        ctx.globalAlpha = 0.6;
        ctx.strokeRect(-ext.hw, -ext.hh, ext.hw * 2, ext.hh * 2);
        ctx.globalAlpha = 1;
      }
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff8a3d';
      ctx.strokeStyle = '#1a1205';
      ctx.lineWidth = 1.5 / view.zoom;
      const hr = 7 / view.zoom;
      for (const [sx, sy] of CORNER_SIGNS) {
        ctx.beginPath();
        ctx.arc(sx * ext.hw, sy * ext.hh, hr, 0, 7);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.setLineDash([]);
  }
  if (view.zoom > 1.01) {
    ctx.restore();
    ctx.fillStyle = 'rgba(90,162,230,.85)';
    ctx.font = '12px ui-monospace,monospace';
    ctx.textAlign = 'right';
    ctx.fillText('🔍 ' + view.zoom.toFixed(1) + '×', cw - 10, 20);
    return;
  }
  ctx.restore();
}

/* --------------------------- edit input ------------------------------- */
let selId: string | null = null;
let prevSelId: string | null = null;
let armed: ShapePreset | null = null;
let armedRot = false;
let handMode: 'adjust' | 'view' = 'adjust';
const selected = (): LevelObject | null => level.objects.find((o) => o.id === selId) || null;

type Gesture =
  | { kind: 'vzoom'; d0: number; m0: { sx: number; sy: number }; z0: number; ox0: number; oy0: number }
  | { kind: 'vpan'; last: { sx: number; sy: number }; start: { sx: number; sy: number }; downT: number; moved: boolean }
  | { kind: 'pinch'; d0: number; a0: number; o: LevelObject }
  | { kind: 'rotate'; cx: number; cy: number; a0: number; pa0: number }
  | { kind: 'move'; dx: number; dy: number; s0: { sx: number; sy: number }; lifted: boolean }
  | { kind: 'paint'; pts: { x: number; y: number }[] }
  | { kind: 'path' }
  | { kind: 'sling' }
  | { kind: 'goal' };

const pointers = new Map<number, { x: number; y: number }>();
const spointers = new Map<number, { sx: number; sy: number }>();
let gesture: Gesture | null = null;
let lastTapT = 0;

function hitObject(p: { x: number; y: number }): LevelObject | null {
  for (let i = level.objects.length - 1; i >= 0; i--) {
    const o = level.objects[i];
    const dx = p.x - o.x;
    const dy = p.y - o.y;
    const a = -(o.angle || 0) / DEG;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const lx = dx * c - dy * s;
    const ly = dx * s + dy * c;
    const pad = 12 / view.zoom + 4;
    if (o.shape === 'box') {
      if (Math.abs(lx) <= o.w! / 2 + pad && Math.abs(ly) <= o.h! / 2 + pad) return o;
    } else if (o.shape === 'tri') {
      if (pointInTri(lx, ly, triVerts({ w: o.w! + pad * 2, h: o.h! + pad * 2 }))) return o;
    } else if (o.shape === 'blob') {
      const r = (o.brushR ?? BRUSH) + pad;
      const pts = o.pts!;
      if (pts.length === 1) {
        if (Math.hypot(lx - pts[0][0], ly - pts[0][1]) <= r) return o;
      } else {
        for (let j = 0; j < pts.length - 1; j++) {
          if (distToSeg(lx, ly, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1]) <= r) return o;
        }
      }
    } else {
      if (lx * lx + ly * ly <= (o.r! + pad) * (o.r! + pad)) return o;
    }
  }
  return null;
}
const near = (p: { x: number; y: number }, x: number, y: number, r: number): boolean =>
  (p.x - x) ** 2 + (p.y - y) ** 2 <= r * r;

/** Local (unrotated) half-extents of a piece's rotate-handle guide box, or
 *  null for radially-symmetric shapes (circle/emoji) that have no corners. */
function handleExtents(o: LevelObject): { hw: number; hh: number } | null {
  if (o.shape === 'box' || o.shape === 'tri') return { hw: o.w! / 2 + 6, hh: o.h! / 2 + 6 };
  if (o.shape === 'blob') {
    let mx = 0;
    let my = 0;
    for (const [px, py] of o.pts!) {
      mx = Math.max(mx, Math.abs(px));
      my = Math.max(my, Math.abs(py));
    }
    const r = o.brushR ?? BRUSH;
    return { hw: mx + r + 6, hh: my + r + 6 };
  }
  return null;
}
/** The four corner offsets of the guide box, in local space. */
const CORNER_SIGNS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
/** World-space positions of the four corner rotate handles, or null. */
function handleCorners(o: LevelObject): { x: number; y: number }[] | null {
  const ext = handleExtents(o);
  if (!ext) return null;
  const a = (o.angle || 0) / DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return CORNER_SIGNS.map(([sx, sy]) => {
    const lx = sx * ext.hw;
    const ly = sy * ext.hh;
    return { x: o.x + lx * c - ly * s, y: o.y + lx * s + ly * c };
  });
}

function applyMagnet(sel: LevelObject): { sx: boolean; sy: boolean } {
  const res = magnetSnap(sel as GeomObject, level.objects as GeomObject[], { zoom: view.zoom, floorY: level.world.floorY });
  sel.x = res.x;
  sel.y = res.y;
  return { sx: res.snappedX, sy: res.snappedY };
}

/** When solid pieces are on, push `sel` out of any overlapping neighbour so a
 *  structure built in the frozen edit view holds together once physics runs.
 *  Called after a piece is placed, moved, rotated, or nudged into position.
 *  The passthrough piece is non-solid both ways: it neither settles nor is
 *  settled against, so a ghost sitting inside a structure displaces nothing. */
function settleSolid(sel: LevelObject): void {
  if (!settings.solid) return;
  if (sel.id === passthroughId) return;
  const others = passthroughId ? level.objects.filter((o) => o.id !== passthroughId) : level.objects;
  const res = separate(sel as GeomObject, others as GeomObject[], {
    worldW: level.world.w,
    worldH: level.world.h,
    // dynamic pieces also settle up out of the ground — physics would eject a
    // buried one in Test. Anchored pieces stay static there, so intentionally
    // sunken decor (a stump, a ramp base) is left where it was put.
    floorY: sel.anchored ? undefined : level.world.floorY,
  });
  sel.x = res.x;
  sel.y = res.y;
}

/* ------------------------ passthrough (ghost) -------------------------- */
/** The one piece temporarily exempt from solid settling. A freshly stamped
 *  piece or ⧉ copy starts here — it may sit inside neighbours while you drag
 *  it into place — and the 👻 chip re-enters the mode for any selected piece.
 *  The moment the piece loses focus it settles solid like everything else. */
let passthroughId: string | null = null;
/** End passthrough: settle the ghost out of any overlap and drop the exemption. */
function settlePassthrough(): void {
  if (!passthroughId) return;
  const o = level.objects.find((x) => x.id === passthroughId);
  passthroughId = null;
  if (o) {
    settleSolid(o);
    scheduleAutosave();
  }
}

function placeArmed(p: { x: number; y: number }, sp: { sx: number; sy: number }): void {
  snap();
  const pr = armed!;
  const c = clampToWorld(p.x, p.y, level.world.w, level.world.h);
  const o: LevelObject = { id: nid(), shape: pr.shape, x: c.x, y: c.y, angle: 0, material: curMat, anchored: false, path: null, note: '' };
  if (pr.shape === 'box') {
    o.w = pr.rotatable && armedRot ? pr.h : pr.w;
    o.h = pr.rotatable && armedRot ? pr.w : pr.h;
  } else if (pr.shape === 'tri') {
    o.w = pr.w;
    o.h = pr.h;
  } else {
    o.r = pr.r;
    if (pr.shape === 'emoji') o.emoji = curEmoji;
  }
  const m = applyMagnet(o);
  if (!m.sx) o.x = snapN(o.x);
  if (!m.sy) o.y = snapN(o.y);
  settlePassthrough();
  level.objects.push(o);
  selId = o.id;
  // a fresh piece starts in passthrough: it may overlap neighbours while you
  // drag it into place, and settles solid the moment it loses focus.
  if (settings.solid) passthroughId = o.id;
  if (settings.afterPlace === 'adjust') {
    setArmed(null, true);
    gesture = { kind: 'move', dx: o.x - p.x, dy: o.y - p.y, s0: sp, lifted: false };
  }
  syncInspector();
}

function finishPaint(pts: { x: number; y: number }[]): void {
  if (!pts.length) return;
  snap();
  let cxx = 0;
  let cyy = 0;
  for (const p of pts) {
    cxx += p.x;
    cyy += p.y;
  }
  cxx /= pts.length;
  cyy /= pts.length;
  const o: LevelObject = {
    id: nid(),
    shape: 'blob',
    x: snapN(cxx),
    y: snapN(cyy),
    angle: 0,
    material: curMat,
    anchored: false,
    path: null,
    note: '',
    brushR: BRUSH,
    pts: pts.map((p) => [Math.round(p.x - cxx), Math.round(p.y - cyy)] as [number, number]),
  };
  level.objects.push(o);
  selId = o.id;
  if (settings.afterPlace === 'adjust') setArmed(null, true);
  syncInspector();
}

cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  const p = s2w(e.clientX, e.clientY);
  const sp = scr(e);
  pointers.set(e.pointerId, p);
  spointers.set(e.pointerId, sp);

  if (mode === 'play') {
    if (session instanceof PlaySession) session.pointerDown(p);
    else if (session instanceof DropSession) session.tap();
    return;
  }

  if (handMode === 'view' && !armed) {
    if (spointers.size === 2) {
      const [a, b] = [...spointers.values()];
      gesture = { kind: 'vzoom', d0: Math.hypot(a.sx - b.sx, a.sy - b.sy), m0: { sx: (a.sx + b.sx) / 2, sy: (a.sy + b.sy) / 2 }, z0: view.zoom, ox0: view.ox, oy0: view.oy };
    } else {
      const now = performance.now();
      if (now - lastTapT < 300) {
        resetView();
        lastTapT = 0;
      } else lastTapT = now;
      gesture = { kind: 'vpan', last: sp, start: sp, downT: now, moved: false };
    }
    return;
  }

  if (pointers.size === 2 && selected() && gesture && (gesture.kind === 'move' || gesture.kind === 'pinch')) {
    const [a, b] = [...pointers.values()];
    gesture = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), a0: Math.atan2(b.y - a.y, b.x - a.x), o: JSON.parse(JSON.stringify(selected())) };
    return;
  }
  if (pointers.size > 1) return;

  // grab a corner of the selection's guide box to free-rotate it in place
  const rotSel = selected();
  if (rotSel && !armed) {
    const corners = handleCorners(rotSel);
    if (corners) {
      const hitR = 16 / view.zoom + 4;
      if (corners.some((c) => near(p, c.x, c.y, hitR))) {
        snap();
        gesture = { kind: 'rotate', cx: rotSel.x, cy: rotSel.y, a0: rotSel.angle || 0, pa0: Math.atan2(p.y - rotSel.y, p.x - rotSel.x) };
        return;
      }
    }
  }

  if (armed && armed.shape === 'blob') {
    gesture = { kind: 'paint', pts: [p] };
    return;
  }

  const sel = selected();
  if (sel && sel.path && near(p, sel.path.x, sel.path.y, 30 / view.zoom + 6)) {
    snap();
    gesture = { kind: 'path' };
    return;
  }
  if (level.meta.mode === 'drive' && level.meta.goal && near(p, level.meta.goal.x, level.meta.goal.y, level.meta.goal.r + 10)) {
    snap();
    gesture = { kind: 'goal' };
    selId = null;
    syncInspector();
    return;
  }
  if (near(p, level.slingshot.x, level.slingshot.y + 30, 60)) {
    snap();
    gesture = { kind: 'sling' };
    selId = null;
    syncInspector();
    return;
  }
  const hit = hitObject(p);
  if (hit) {
    if (selId && selId !== hit.id) prevSelId = selId;
    selId = hit.id;
    syncInspector();
    snap();
    gesture = { kind: 'move', dx: hit.x - p.x, dy: hit.y - p.y, s0: sp, lifted: false };
    return;
  }
  if (armed) {
    placeArmed(p, sp);
    return;
  }
  selId = null;
  syncInspector();
});

cv.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const p = s2w(e.clientX, e.clientY);
  const sp = scr(e);
  pointers.set(e.pointerId, p);
  const prevS = spointers.get(e.pointerId)!;
  spointers.set(e.pointerId, sp);
  if (mode === 'play') {
    if (session instanceof PlaySession) session.pointerMove(p);
    return;
  }
  if (!gesture) return;
  const sel = selected();

  if (gesture.kind === 'paint') {
    const last = gesture.pts[gesture.pts.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) > BRUSH * 0.6 && gesture.pts.length < 70) gesture.pts.push(p);
  } else if (gesture.kind === 'vpan') {
    view.ox += sp.sx - prevS.sx;
    view.oy += sp.sy - prevS.sy;
    if (Math.hypot(sp.sx - gesture.start.sx, sp.sy - gesture.start.sy) > 8) gesture.moved = true;
    clampView();
  } else if (gesture.kind === 'vzoom' && spointers.size >= 2) {
    const [a, b] = [...spointers.values()];
    const d = Math.hypot(a.sx - b.sx, a.sy - b.sy);
    const mid = { sx: (a.sx + b.sx) / 2, sy: (a.sy + b.sy) / 2 };
    const k = d / gesture.d0;
    view.zoom = Math.min(Math.max(gesture.z0 * k, 1), MAXZOOM);
    const sc = view.fit * view.zoom;
    const sc0 = view.fit * gesture.z0;
    view.ox = mid.sx - (gesture.m0.sx - gesture.ox0) * (sc / sc0);
    view.oy = mid.sy - (gesture.m0.sy - gesture.oy0) * (sc / sc0);
    clampView();
  } else if (gesture.kind === 'pinch' && pointers.size >= 2 && sel) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const k = Math.max(0.2, d / gesture.d0);
    if (sel.shape === 'box' || sel.shape === 'tri') {
      sel.w = Math.max(24, gesture.o.w! * k);
      sel.h = Math.max(24, gesture.o.h! * k);
    } else if (sel.shape === 'blob') {
      sel.brushR = Math.max(10, (gesture.o.brushR ?? BRUSH) * k);
      sel.pts = gesture.o.pts!.map(([px, py]) => [px * k, py * k] as [number, number]);
    } else {
      sel.r = Math.max(14, gesture.o.r! * k);
    }
    sel.angle = Math.round(gesture.o.angle + (ang - gesture.a0) * DEG);
  } else if (gesture.kind === 'rotate' && sel) {
    const pa = Math.atan2(p.y - gesture.cy, p.x - gesture.cx);
    let deg = gesture.a0 + (pa - gesture.pa0) * DEG;
    // soft-snap to 15° steps so common decline angles are easy to hit exactly
    const nearest = Math.round(deg / 15) * 15;
    if (Math.abs(deg - nearest) <= 3) deg = nearest;
    sel.angle = ((Math.round(deg) % 360) + 360) % 360;
    syncReadout();
  } else if (gesture.kind === 'move' && sel) {
    if (!gesture.lifted) {
      const ds = Math.hypot(sp.sx - gesture.s0.sx, sp.sy - gesture.s0.sy);
      if (ds > 10 && e.pointerType !== 'mouse') {
        gesture.dy -= 80 / view.zoom;
        gesture.lifted = true;
      } else if (ds > 10) gesture.lifted = true;
    }
    const c = clampToWorld(p.x + gesture.dx, p.y + gesture.dy, level.world.w, level.world.h);
    sel.x = c.x;
    sel.y = c.y;
    applyMagnet(sel);
  } else if (gesture.kind === 'path' && sel && sel.path) {
    const c = clampToWorld(p.x, p.y, level.world.w, level.world.h);
    sel.path.x = c.x;
    sel.path.y = c.y;
  } else if (gesture.kind === 'sling') {
    const c = clampToWorld(p.x, Math.min(p.y, level.world.floorY - 60), level.world.w, level.world.h);
    level.slingshot.x = c.x;
    level.slingshot.y = c.y;
  } else if (gesture.kind === 'goal' && level.meta.goal) {
    const c = clampToWorld(p.x, p.y, level.world.w, level.world.h);
    level.meta.goal.x = c.x;
    level.meta.goal.y = c.y;
  }
});

function endPointer(e: PointerEvent): void {
  pointers.delete(e.pointerId);
  spointers.delete(e.pointerId);
  if (mode === 'play') {
    if (pointers.size === 0 && session instanceof PlaySession) session.pointerUp();
    return;
  }
  if (pointers.size > 0) return;
  const sel = selected();
  if (gesture) {
    if (gesture.kind === 'paint') finishPaint(gesture.pts);
    if (gesture.kind === 'move' && sel) {
      const m = applyMagnet(sel);
      if (!m.sx) sel.x = snapN(sel.x);
      if (!m.sy) sel.y = snapN(sel.y);
      settleSolid(sel);
    }
    if (gesture.kind === 'pinch' && sel) {
      if (sel.shape === 'box' || sel.shape === 'tri') {
        sel.w = snapN(sel.w!);
        sel.h = snapN(sel.h!);
      } else if (sel.shape !== 'blob') {
        sel.r = snapN(sel.r!);
      }
      const m = applyMagnet(sel);
      if (!m.sx) sel.x = snapN(sel.x);
      if (!m.sy) sel.y = snapN(sel.y);
      settleSolid(sel);
    }
    if (gesture.kind === 'rotate' && sel) settleSolid(sel);
    if (gesture.kind === 'path' && sel && sel.path) {
      sel.path.x = snapN(sel.path.x);
      sel.path.y = snapN(sel.path.y);
    }
    if (gesture.kind === 'sling') {
      level.slingshot.x = snapN(level.slingshot.x);
      level.slingshot.y = snapN(level.slingshot.y);
    }
    if (gesture.kind === 'goal' && level.meta.goal) {
      level.meta.goal.x = snapN(level.meta.goal.x);
      level.meta.goal.y = snapN(level.meta.goal.y);
    }
    // A stationary quick tap while in 🔍 view mode grabs the piece under the
    // finger and drops into ✋ adjust, so "zoom in, then tap to select" works
    // without hunting for the mode toggle. Dragging still pans.
    if (gesture.kind === 'vpan' && !gesture.moved && performance.now() - gesture.downT < 300) {
      const hit = hitObject(s2w(e.clientX, e.clientY));
      if (hit) {
        selId = hit.id;
        handMode = 'adjust';
        adjEl.classList.toggle('on', !armed && handMode === 'adjust');
        syncViewBtn();
      }
    }
    scheduleAutosave();
  }
  gesture = null;
  syncInspector();
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);

/* ---------------------------- nudge pad ------------------------------- */
let nudgeLast = { id: '', t: 0 };
document.querySelectorAll<HTMLButtonElement>('#nudge button[data-n]').forEach((b) => {
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const s = selected();
    if (!s || mode !== 'edit') return;
    const [dx, dy] = b.dataset.n!.split(',').map(Number);
    const now = performance.now();
    if (!(nudgeLast.id === s.id && now - nudgeLast.t < 1500)) snap();
    nudgeLast = { id: s.id, t: now };
    const c = clampToWorld(s.x + dx * SNAP, s.y + dy * SNAP, level.world.w, level.world.h);
    s.x = c.x;
    s.y = c.y;
    settleSolid(s);
    syncReadout();
    scheduleAutosave();
  });
});
function syncNudge(): void {
  const s = selected();
  const el = $('nudge');
  if (!s || mode !== 'edit') {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'grid';
  // manifest in the corner diagonally opposite the piece so it never covers it
  const sx = s.x * view.scale + view.ox;
  const sy = s.y * view.scale + view.oy;
  if (sx > cw / 2) {
    el.style.left = '10px';
    el.style.right = 'auto';
  } else {
    el.style.right = '10px';
    el.style.left = 'auto';
  }
  if (sy > chh / 2) {
    el.style.top = '10px';
    el.style.bottom = 'auto';
  } else {
    el.style.bottom = '10px';
    el.style.top = 'auto';
  }
}

/* -------------------- floating piece-menu popup ----------------------- */
// In portrait the per-piece controls float over the canvas. They park on the
// side of the screen away from the selected piece so they never hide what they
// edit. Once placed they stay put as you tap other pieces (continuity) and only
// relocate when the current spot would cover the newly selected one. The grip
// lets you drag the popup anywhere. Landscape keeps these in the side rail.
let wrapPos: { x: number; y: number } | null = null;

function pieceScreenExtent(o: LevelObject): number {
  let wr: number;
  if (o.shape === 'box' || o.shape === 'tri') wr = Math.hypot((o.w ?? 40) / 2, (o.h ?? 40) / 2);
  else if (o.shape === 'blob') {
    let m = 0;
    for (const p of o.pts ?? []) m = Math.max(m, Math.hypot(p[0], p[1]));
    wr = m + (o.brushR ?? BRUSH);
  } else wr = o.r ?? 26;
  return wr * view.scale;
}

function applyWrapPos(l: number, t: number): void {
  const el = $('selwrap');
  el.style.left = `${Math.round(l)}px`;
  el.style.top = `${Math.round(t)}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
  el.style.transform = 'none';
}

function placeSelwrap(): void {
  const el = $('selwrap');
  if (document.body.classList.contains('land')) {
    // landscape keeps the controls docked in the side rail — drop any floating
    // layout so the CSS grid rules take over.
    el.style.left = el.style.top = el.style.right = el.style.bottom = el.style.transform = '';
    return;
  }
  const sel = selected();
  if (!sel || el.style.display === 'none') return;
  const wb = el.getBoundingClientRect();
  const ww = wb.width || 150;
  const wh = wb.height || 120;
  const rect = cv.getBoundingClientRect();
  const cx = rect.left + sel.x * view.scale + view.ox;
  const cy = rect.top + sel.y * view.scale + view.oy;
  const rad = pieceScreenExtent(sel) + 14; // clearance kept around the piece
  const pl = cx - rad;
  const pr = cx + rad;
  const pt = cy - rad;
  const pb = cy + rad;
  const overlaps = (l: number, t: number): boolean => !(l + ww < pl || l > pr || t + wh < pt || t > pb);
  // the nudge pad parks in the corner diagonally opposite the piece (see
  // syncNudge, which runs before this) — treat its rectangle as occupied too
  // so the popup never covers the arrows.
  const nEl = $('nudge');
  const nr = nEl.style.display !== 'none' ? nEl.getBoundingClientRect() : null;
  const overNudge = (l: number, t: number): boolean =>
    !!nr && !(l + ww < nr.left - 6 || l > nr.right + 6 || t + wh < nr.top - 6 || t > nr.bottom + 6);
  const clearOf = (l: number, t: number): boolean => !overlaps(l, t) && !overNudge(l, t);

  const m = 8;
  const maxL = Math.max(m, window.innerWidth - ww - m);
  const maxT = Math.max(m, window.innerHeight - wh - m);

  // continuity: an existing spot that still clears the piece and the pad is
  // left untouched (only nudged back on-screen after a rotate/resize).
  if (wrapPos) {
    wrapPos.x = Math.min(Math.max(wrapPos.x, m), maxL);
    wrapPos.y = Math.min(Math.max(wrapPos.y, m), maxT);
    if (clearOf(wrapPos.x, wrapPos.y)) {
      applyWrapPos(wrapPos.x, wrapPos.y);
      return;
    }
  }

  const vpL = Math.max(rect.left, 0);
  const vpR = Math.min(rect.right, window.innerWidth);
  const vpT = Math.max(rect.top, 0);
  const vpB = Math.min(rect.bottom, window.innerHeight);
  const leftL = vpL + m;
  const rightL = vpR - ww - m;
  const topT = vpT + m;
  const botT = Math.max(vpT + m, vpB - wh - m);
  const midT = Math.min(Math.max(cy - wh / 2, topT), botT);
  const awayL = cx > (vpL + vpR) / 2 ? leftL : rightL; // horizontal side away from the piece
  const nearL = cx > (vpL + vpR) / 2 ? rightL : leftL;
  const awayT = cy > (vpT + vpB) / 2 ? topT : botT; // vertical edge away from the piece (the pad's corner)
  const nearT = cy > (vpT + vpB) / 2 ? botT : topT;
  // prefer the away side vertically centred on the piece, then walk the
  // corners the piece and the pad leave free.
  const cands: Array<[number, number]> = [
    [awayL, midT],
    [awayL, nearT],
    [nearL, awayT],
    [nearL, nearT],
    [nearL, midT],
  ];
  let pick: { x: number; y: number } | null = null;
  for (const [l0, t0] of cands) {
    const l = Math.min(Math.max(l0, m), maxL);
    const t = Math.min(Math.max(t0, m), maxT);
    if (clearOf(l, t)) {
      pick = { x: l, y: t };
      break;
    }
  }
  if (!pick) {
    // nowhere clears both — fall back to the old away-side placement dodging
    // the piece only; covering the pad beats covering the piece being edited
    const l = Math.min(Math.max(awayL, m), maxL);
    let t = midT;
    if (overlaps(l, t)) t = awayT;
    pick = { x: l, y: Math.min(Math.max(t, m), maxT) };
  }
  wrapPos = pick;
  applyWrapPos(pick.x, pick.y);
}

// drag the popup by its grip; the chosen spot sticks (subject to not covering
// the next piece you select).
{
  const grip = $('selgrip');
  const el = $('selwrap');
  let drag: { dx: number; dy: number; id: number } | null = null;
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const wb = el.getBoundingClientRect();
    drag = { dx: e.clientX - wb.left, dy: e.clientY - wb.top, id: e.pointerId };
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const wb = el.getBoundingClientRect();
    const maxL = Math.max(4, window.innerWidth - wb.width - 4);
    const maxT = Math.max(4, window.innerHeight - wb.height - 4);
    const l = Math.min(Math.max(e.clientX - drag.dx, 4), maxL);
    const t = Math.min(Math.max(e.clientY - drag.dy, 4), maxT);
    wrapPos = { x: l, y: t };
    applyWrapPos(l, t);
  });
  const end = (e: PointerEvent): void => {
    if (drag && e.pointerId === drag.id) drag = null;
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

/* ------------------------------ tray ---------------------------------- */
const tray = $('tray');
const trayEls: Array<{ el: HTMLElement; pr: ShapePreset }> = [];

const adjEl = document.createElement('div');
adjEl.className = 'preset on';
adjEl.innerHTML = '<span class="ico">✋</span>adjust';
adjEl.addEventListener('click', () => {
  handMode = 'adjust';
  setArmed(null);
});
tray.appendChild(adjEl);

for (const pr of SHAPES) {
  const el = document.createElement('div');
  el.className = 'preset';
  el.innerHTML = `<span class="ico"></span>${pr.name}`;
  el.addEventListener('click', () => {
    if (mode === 'play') return;
    if (armed === pr && pr.shape === 'emoji') {
      openEmoji('stamp');
      return;
    }
    if (armed === pr) {
      setArmed(null);
      return;
    }
    armedRot = false;
    setArmed(pr);
  });
  trayEls.push({ el, pr });
  tray.appendChild(el);
}
function drawIco(): void {
  const col = MATERIALS[curMat].color;
  for (const { el, pr } of trayEls) {
    const ico = el.querySelector('.ico') as HTMLElement;
    if (pr.shape === 'box') {
      let w = pr.w!;
      let h = pr.h!;
      if (pr.rotatable && armed === pr && armedRot) [w, h] = [h, w];
      const iw = Math.min(40, w * 0.22);
      const ih = Math.min(22, Math.max(6, h * 0.22));
      ico.innerHTML = `<span class="shp" style="width:${iw}px;height:${ih}px;border-radius:3px;background:${col}"></span>`;
    } else if (pr.shape === 'tri') {
      ico.innerHTML = `<span class="shp" style="width:0;height:0;border:none;border-left:11px solid transparent;border-right:11px solid transparent;border-bottom:19px solid ${col}"></span>`;
    } else if (pr.shape === 'emoji') {
      ico.textContent = curEmoji;
    } else if (pr.shape === 'blob') {
      ico.textContent = '🖌';
    } else {
      ico.innerHTML = `<span class="shp" style="width:20px;height:20px;border-radius:50%;background:${col}"></span>`;
    }
  }
}
function setArmed(pr: ShapePreset | null, _keepSel?: boolean): void {
  armed = pr;
  if (!armed) armedRot = false;
  trayEls.forEach((x) => x.el.classList.toggle('on', x.pr === armed));
  if (armed) {
    selId = null;
    handMode = 'adjust';
  }
  adjEl.classList.toggle('on', !armed && handMode === 'adjust');
  syncViewBtn();
  drawIco();
  syncInspector();
}

/* --------------------- topbar rotate / view --------------------------- */
function rotateSelected(): boolean {
  const s = selected();
  if (s) {
    snap();
    s.angle = ((s.angle || 0) + 90) % 360;
    syncInspector();
    return true;
  }
  return false;
}
$('b-rot').onclick = () => {
  if (mode === 'play') return;
  if (rotateSelected()) return;
  if (armed && armed.rotatable) {
    armedRot = !armedRot;
    drawIco();
  }
};
$('b-view').onclick = () => {
  if (mode === 'play') return;
  if (armed) setArmed(null);
  handMode = handMode === 'view' ? 'adjust' : 'view';
  adjEl.classList.toggle('on', !armed && handMode === 'adjust');
  syncViewBtn();
};
function syncViewBtn(): void {
  $('b-view').classList.toggle('viewon', handMode === 'view' && !armed);
}

/* --------------------------- emoji picker ----------------------------- */
function renderEmojiPicker(): void {
  const rec = $('erecents');
  rec.innerHTML = '';
  for (const em of emojiRecents) {
    const b = document.createElement('button');
    b.textContent = em;
    b.addEventListener('click', () => pickEmoji(em));
    rec.appendChild(b);
  }
  const pal = $('epicks');
  if (!pal.childElementCount) {
    for (const em of EMOJI_PALETTE) {
      const b = document.createElement('button');
      b.textContent = em;
      b.addEventListener('click', () => pickEmoji(em));
      pal.appendChild(b);
    }
  }
}
function renderEmojiResults(query: string): void {
  const box = $('eresults');
  box.innerHTML = '';
  const hits = searchEmoji(query);
  for (const em of hits) {
    const b = document.createElement('button');
    b.textContent = em;
    b.addEventListener('click', () => pickEmoji(em));
    box.appendChild(b);
  }
}
$<HTMLInputElement>('esearch').addEventListener('input', (e) => renderEmojiResults((e.target as HTMLInputElement).value));

function openEmoji(mode2: 'stamp' | 'hero' | 'newlevel'): void {
  emojiFor = mode2;
  $('etitle').textContent =
    mode2 === 'stamp'
      ? 'EMOJI STAMP — a round physics body in the current material. Stamp villains with target material.'
      : 'PICK YOUR HERO — the emoji you fling at the villains.';
  $<HTMLInputElement>('einput').value = '';
  $<HTMLInputElement>('esearch').value = '';
  $('eresults').innerHTML = '';
  renderEmojiPicker();
  $('emodal').style.display = 'flex';
}
function pickEmoji(em: string): void {
  emojiRecents = [em, ...emojiRecents.filter((x) => x !== em)].slice(0, 10);
  if (emojiFor === 'newlevel') {
    wizardHero = em;
    $('nl-hero').textContent = em;
  } else if (emojiFor === 'hero') {
    snap();
    level.meta.hero = em;
    prefHero = em;
    syncHero();
  } else {
    curEmoji = em;
    drawIco();
  }
  savePrefs();
  $('emodal').style.display = 'none';
}
$('e-set').onclick = () => {
  const v = $<HTMLInputElement>('einput').value.trim();
  if (v) pickEmoji(v);
  else $('emodal').style.display = 'none';
};
$('e-close').onclick = () => ($('emodal').style.display = 'none');
function syncHero(): void {
  $('herobtn').textContent = level.meta.hero || DEFAULT_HERO;
}

/* --------------------------- help & settings -------------------------- */
$('b-help').onclick = () => ($('hmodal').style.display = 'flex');
$('h-close').onclick = () => ($('hmodal').style.display = 'none');
$('b-set').onclick = () => {
  syncSettings();
  $('smodal').style.display = 'flex';
};
$('s-close').onclick = () => ($('smodal').style.display = 'none');
$('set-after').onclick = () => {
  settings.afterPlace = settings.afterPlace === 'adjust' ? 'stamp' : 'adjust';
  savePrefs();
  syncSettings();
};
$('set-solid').onclick = () => {
  settings.solid = !settings.solid;
  // solid off means free placement everywhere — a lingering ghost exemption
  // would just be a misleading indicator, so drop it without moving anything
  if (!settings.solid) passthroughId = null;
  savePrefs();
  syncSettings();
  syncInspector();
};
$('set-theme').onclick = () => {
  settings.theme = cycleTheme(settings.theme);
  savePrefs();
  applyTheme();
  syncSettings();
};
$('set-mode').onclick = () => {
  snap();
  // cycle slingshot → drop → drive → slingshot
  if (level.meta.mode === 'slingshot') {
    level.meta.mode = 'drop';
    // drop plays top-to-bottom: move the spawn marker up near the ceiling
    level.slingshot.y = Math.min(level.slingshot.y, 120);
    level.slingshot.x = Math.max(60, Math.min(level.slingshot.x, level.world.w - 60));
    if (!level.objects.some((o) => o.role === 'goal')) {
      toast('drop mode — mark a piece as the 🏁 goal (catch tray) so it can be cleared');
    }
  } else if (level.meta.mode === 'drop') {
    level.meta.mode = 'drive';
    // give drive levels a goal zone to reach if they don't have one yet
    if (!level.meta.goal) level.meta.goal = { x: level.world.w - 220, y: level.world.floorY - 60, r: 44 };
  } else {
    level.meta.mode = 'slingshot';
  }
  syncSettings();
};
$('set-shape').onclick = () => {
  snap();
  const goTall = level.world.w >= level.world.h; // currently wide → switch to tall
  const preset = goTall ? TALL : WIDE;
  level.world.w = preset.w;
  level.world.h = preset.h;
  level.world.floorY = floorYFor(preset.h);
  // clamp the spawn/launcher back into bounds; keep every object coordinate
  level.slingshot.x = Math.max(20, Math.min(level.slingshot.x, level.world.w - 20));
  level.slingshot.y = Math.max(20, Math.min(level.slingshot.y, level.world.floorY - 20));
  const oob = level.objects.filter((o) => o.x < 0 || o.x > level.world.w || o.y < 0 || o.y > level.world.h).length;
  resize();
  syncSettings();
  toast(oob ? `${goTall ? 'tall' : 'wide'} world — ${oob} piece${oob > 1 ? 's' : ''} now out of bounds` : `${goTall ? 'tall' : 'wide'} world`);
};
function modeLabel(m: Level['meta']['mode']): string {
  return m === 'drive' ? '🏁 drive (Red Ball)' : m === 'drop' ? '🪂 drop (tap to hop)' : '🎯 slingshot';
}

/* Hero bounciness (drive mode) — meta.bounce is restitution 0–1; the slider is a
   0–100 percentage. Unset falls back to the rubber material's own bounce. */
const DEFAULT_BOUNCE = MATERIALS.rubber.restitution;
const bounceEl = $<HTMLInputElement>('set-bounce');
let bounceDirty = false;
bounceEl.addEventListener('input', () => {
  if (!bounceDirty) {
    snap(); // one undo step per drag/keyboard-adjust, taken before the first change
    bounceDirty = true;
  }
  const pct = Number(bounceEl.value);
  level.meta.bounce = pct / 100;
  $('set-bounce-val').textContent = `${pct}%`;
});
bounceEl.addEventListener('change', () => {
  bounceDirty = false;
});

function syncSettings(): void {
  $('set-after').textContent = settings.afterPlace === 'adjust' ? '→ ✋ adjust new piece' : 'keep stamping';
  $('set-solid').textContent = settings.solid ? 'on — no overlaps' : 'off — free placement';
  $('set-theme').textContent = themeLabel(settings.theme, systemDarkMq.matches);
  $('set-mode').textContent = modeLabel(level.meta.mode);
  const tall = level.world.h > level.world.w;
  $('set-shape').textContent = `${tall ? '⬍ tall' : '⬌ wide'} ${level.world.w}×${level.world.h}`;
  // Bounciness only matters in drive mode — show the slider there, hide it elsewhere.
  const drive = level.meta.mode === 'drive';
  $('set-bounce-row').style.display = drive ? '' : 'none';
  if (drive) {
    const pct = Math.round((level.meta.bounce ?? DEFAULT_BOUNCE) * 100);
    bounceEl.value = String(pct);
    $('set-bounce-val').textContent = `${pct}%`;
  }
  syncHero();
}
$('herobtn').onclick = () => {
  $('smodal').style.display = 'none';
  openEmoji('hero');
};

/* ------------------- backdrops: picker, upload, brief ----------------- */
document.querySelectorAll<HTMLElement>('.bgw[data-bg]').forEach((b) =>
  b.addEventListener('click', () => {
    const bg = b.dataset.bg as BackgroundKind;
    if (bg === 'custom' && !level.meta.backgroundImage) return;
    if (level.meta.background === bg) return;
    snap();
    level.meta.background = bg;
    syncBg();
  }),
);
function syncBg(): void {
  const cur = level.meta.background || 'grid';
  document.querySelectorAll<HTMLElement>('.bgw[data-bg]').forEach((b) => b.classList.toggle('on', b.dataset.bg === cur));
  const cs = $('bg-custom');
  if (level.meta.backgroundImage) {
    cs.style.display = 'inline-block';
    cs.style.backgroundImage = `url(${level.meta.backgroundImage})`;
  } else {
    cs.style.display = 'none';
  }
}
$('bg-upload').onclick = () => $<HTMLInputElement>('bg-file').click();
$<HTMLInputElement>('bg-file').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files && input.files[0];
  input.value = '';
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    const url = String(rd.result);
    snap();
    level.meta.backgroundImage = url;
    level.meta.background = 'custom';
    syncBg();
    toast(url.length > 2500000 ? 'backdrop imported — heads up: it makes the schema JSON heavy' : 'backdrop imported');
  };
  rd.onerror = () => toast('could not read that image');
  rd.readAsDataURL(f);
});
$('bg-brief').onclick = () => {
  $<HTMLTextAreaElement>('brieftext').value = agentBrief(level.world);
  $('bmodal').style.display = 'flex';
};
$('br-close').onclick = () => ($('bmodal').style.display = 'none');
$('br-copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($<HTMLTextAreaElement>('brieftext').value);
    toast('brief copied — add your style notes');
  } catch {
    $<HTMLTextAreaElement>('brieftext').select();
    document.execCommand('copy');
    toast('brief copied — add your style notes');
  }
};

/* ----------------------------- inspector ------------------------------ */
function syncInspector(): void {
  // losing focus is what finally makes a passthrough piece settle solid —
  // every selection change routes through here.
  if (passthroughId && passthroughId !== selId) settlePassthrough();
  const sel = selected();
  $('selwrap').style.display = sel ? 'block' : 'none';
  const shown = sel ? sel.material : curMat;
  document.querySelectorAll<HTMLElement>('.swwrap[data-m]').forEach((c) => c.classList.toggle('on', c.dataset.m === shown));
  syncNudge();
  if (!sel) return;
  $('tg-anchor').classList.toggle('on', !!sel.anchored);
  const pass = $('tg-pass');
  pass.style.display = settings.solid ? 'flex' : 'none';
  pass.classList.toggle('on', sel.id === passthroughId);
  $('tg-move').classList.toggle('on', !!sel.path);
  $('tg-note').classList.toggle('on', !!sel.note);
  $('tg-weld').classList.toggle('on', !!sel.group);
  const sprite = $('tg-sprite');
  sprite.style.display = sel.shape === 'emoji' ? 'flex' : 'none';
  sprite.classList.toggle('on', !!sel.sprite);
  const protect = $('tg-protect');
  protect.style.display = sel.material === 'target' ? 'flex' : 'none';
  protect.classList.toggle('on', sel.role === 'protect');
  const effect = $('tg-effect');
  effect.style.display = sel.shape === 'emoji' ? 'flex' : 'none';
  const eff = behaviorFor(sel);
  effect.classList.toggle('on', !!eff);
  effect.textContent = eff ? EFFECTS[eff].icon : '✨';
  effect.title = eff ? `hit effect: ${EFFECTS[eff].label}` : 'hit effect (emoji)';
  $('tg-goal').classList.toggle('on', sel.role === 'goal');
  syncReadout();
  placeSelwrap();
}
function syncReadout(): void {
  const sel = selected();
  if (!sel) return;
  let size: string;
  if (sel.shape === 'box' || sel.shape === 'tri') size = `${Math.round(sel.w!)}×${Math.round(sel.h!)}`;
  else if (sel.shape === 'blob') size = `~${sel.pts!.length}pt brush ${Math.round(sel.brushR ?? BRUSH)}`;
  else size = `r${Math.round(sel.r!)}`;
  $('readout').textContent = `${Math.round(sel.x)},${Math.round(sel.y)} · ${size} · ${Math.round(sel.angle || 0)}°`;
}
document.querySelectorAll<HTMLElement>('.swwrap[data-m]').forEach((c) =>
  c.addEventListener('click', () => {
    curMat = c.dataset.m as MaterialKey;
    drawIco();
    const s = selected();
    if (s) {
      snap();
      s.material = curMat;
      if (s.material !== 'target') delete s.role;
    }
    syncInspector();
  }),
);
$('tg-rot').onclick = () => {
  rotateSelected();
};
$('tg-anchor').onclick = () => {
  const s = selected();
  if (s) {
    snap();
    s.anchored = !s.anchored;
    syncInspector();
  }
};
$('tg-pass').onclick = () => {
  const s = selected();
  if (!s || !settings.solid) return;
  if (s.id === passthroughId) {
    settlePassthrough();
    toast('solid again — settled out of any overlap');
  } else {
    settlePassthrough();
    passthroughId = s.id;
    scheduleAutosave();
    toast('passthrough — overlap freely; turns solid when it loses focus');
  }
  syncInspector();
};
$('tg-move').onclick = () => {
  const s = selected();
  if (!s) return;
  snap();
  s.path = s.path ? null : { x: Math.min(s.x + 200, level.world.w - 40), y: s.y, speed: 90 };
  syncInspector();
};
$('tg-protect').onclick = () => {
  const s = selected();
  if (!s || s.material !== 'target') return;
  snap();
  s.role = s.role === 'protect' ? 'destroy' : 'protect';
  syncInspector();
};
$('tg-goal').onclick = () => {
  const s = selected();
  if (!s) return;
  snap();
  if (s.role === 'goal') {
    delete s.role;
    toast('goal cleared');
  } else {
    s.role = 'goal';
    toast('goal set — reach it to clear the level (catch tray in drop, flag in drive)');
  }
  syncInspector();
};
$('tg-weld').onclick = () => {
  const s = selected();
  if (!s) return;
  if (s.group) {
    snap();
    delete s.group;
    syncInspector();
    return;
  }
  if (s.shape === 'blob') {
    toast('a blob is already one welded piece');
    return;
  }
  const prev = prevSelId ? level.objects.find((o) => o.id === prevSelId && o.id !== s.id) : null;
  if (!prev) {
    toast('tap another piece first, then 🔗 to weld the two together');
    return;
  }
  snap();
  const gid = prev.group || `g-${prev.id}`;
  prev.group = gid;
  s.group = gid;
  syncInspector();
  toast('welded — they move as one rigid piece in Test');
};
$('tg-sprite').onclick = () => {
  const s = selected();
  if (!s || s.shape !== 'emoji') return;
  if (s.sprite) {
    snap();
    delete s.sprite;
    syncInspector();
    toast('sprite removed — back to the emoji glyph');
    return;
  }
  $<HTMLInputElement>('sprite-file').click();
};
$<HTMLInputElement>('sprite-file').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files && input.files[0];
  input.value = '';
  const s = selected();
  if (!f || !s || s.shape !== 'emoji') return;
  const rd = new FileReader();
  rd.onload = () => {
    snap();
    s.sprite = String(rd.result);
    syncInspector();
    toast(String(rd.result).length > 2000000 ? 'sprite set — heads up: big images make the schema JSON heavy' : 'sprite set — the image skins this piece');
  };
  rd.onerror = () => toast('could not read that image');
  rd.readAsDataURL(f);
});
$('copy').onclick = () => {
  const s = selected();
  if (!s) return;
  snap();
  const dup: LevelObject = JSON.parse(JSON.stringify(s));
  dup.id = nid();
  // offset sideways only so the copy is visible — keeping y means a piece
  // resting on the floor copies to the same height instead of sinking into
  // the ground a step per generation
  const off = SNAP * 2;
  dup.x = Math.max(0, Math.min(s.x + off, level.world.w));
  dup.y = s.y;
  // a copy is an independent piece — it keeps material, role, anchor, path,
  // note, sprite and its ✨ hit effect, but not the weld relationship (which
  // would fuse it to the original as one rigid body).
  delete dup.group;
  // settle any current ghost (e.g. a just-stamped original) before the copy
  // lands on top of it, then spawn the copy itself in passthrough so it can
  // be dragged out of the pile-up instead of being shoved solid immediately.
  settlePassthrough();
  level.objects.push(dup);
  if (selId) prevSelId = selId;
  selId = dup.id;
  if (settings.solid) passthroughId = dup.id;
  syncInspector();
  toast('copied — drag it into place; it turns solid when it loses focus');
};
$('del').onclick = () => {
  if (!selId) return;
  snap();
  level.objects = level.objects.filter((o) => o.id !== selId);
  selId = null;
  syncInspector();
};

/* ---------------------------- hit effects ----------------------------- */
function openEffectPicker(): void {
  const sel = selected();
  if (!sel || sel.shape !== 'emoji') return;
  const cur = behaviorFor(sel);
  const list = $('eflist');
  list.innerHTML = '';
  for (const key of HIT_BEHAVIORS) {
    const spec = EFFECTS[key];
    const opt = document.createElement('div');
    opt.className = 'efopt' + (cur === key ? ' on' : '');
    opt.innerHTML = `<span class="efico">${spec.icon}</span><span><span class="efname">${spec.label}</span><br /><span class="efblurb">${spec.blurb}</span></span>`;
    opt.addEventListener('click', () => {
      const s = selected();
      if (!s) return;
      snap();
      s.hit = key;
      syncInspector();
      $('efmodal').style.display = 'none';
      toast(`hit effect: ${spec.label}`);
    });
    list.appendChild(opt);
  }
  $('efmodal').style.display = 'flex';
}
$('tg-effect').onclick = openEffectPicker;
$('ef-close').onclick = () => ($('efmodal').style.display = 'none');
$('ef-none').onclick = () => {
  const s = selected();
  if (!s) {
    $('efmodal').style.display = 'none';
    return;
  }
  snap();
  // if the glyph alone implies an effect (e.g. 💣 → explode), store an explicit
  // off-sentinel to suppress it; otherwise just drop the key.
  const probe = JSON.parse(JSON.stringify(s)) as LevelObject;
  delete probe.hit;
  if (behaviorFor(probe)) s.hit = 'none';
  else delete s.hit;
  syncInspector();
  $('efmodal').style.display = 'none';
  toast('hit effect cleared');
};
$('undo').onclick = doUndo;
$('redo').onclick = doRedo;

/* -------------------- hamburger menu (top-right) ---------------------- */
/* The less-used top-bar actions live here to keep the bar thumb-light:
   Library, Lexicon, Settings, Help — plus the autosave toggle. */
const menuEl = $('menu');
const menuBtn = $('b-menu');
function setMenu(open: boolean): void {
  menuEl.style.display = open ? 'flex' : 'none';
  menuEl.setAttribute('aria-hidden', String(!open));
  menuBtn.setAttribute('aria-expanded', String(open));
}
menuBtn.onclick = (e) => {
  e.stopPropagation();
  setMenu(menuEl.style.display !== 'flex');
};
// Dismiss on an outside tap or Escape.
document.addEventListener('pointerdown', (e) => {
  if (menuEl.style.display !== 'flex') return;
  const t = e.target as Node;
  if (!menuEl.contains(t) && t !== menuBtn) setMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setMenu(false);
});
// The action items open their own modals; close the menu behind them.
for (const id of ['b-lib', 'b-schema', 'b-set', 'b-help']) {
  $(id).addEventListener('click', () => setMenu(false));
}

/* Autosave toggle — checked by default; off stops persisting the session. */
const autosaveChk = $<HTMLInputElement>('autosave-chk');
autosaveChk.checked = autosaveOn;
autosaveChk.onchange = () => {
  autosaveOn = autosaveChk.checked;
  saveAutosavePref(autosaveOn);
  if (autosaveOn) {
    autosaveNow();
    toast('autosave on — kept in this browser');
  } else {
    toast("autosave off — changes won't be kept");
  }
};

/* ---------------------- note editor + dictation ----------------------- */
let recog: any = null;
let recActive = false;
$('tg-note').onclick = () => {
  const s = selected();
  if (!s) return;
  $<HTMLTextAreaElement>('notetext').value = s.note || '';
  $('nmodal').style.display = 'flex';
};
$('n-cancel').onclick = () => {
  stopDictation();
  $('nmodal').style.display = 'none';
};
$('n-save').onclick = () => {
  stopDictation();
  const s = selected();
  if (s) {
    snap();
    s.note = $<HTMLTextAreaElement>('notetext').value.trim();
    syncInspector();
  }
  $('nmodal').style.display = 'none';
};
function stopDictation(): void {
  if (recog) {
    try {
      recog.stop();
    } catch {
      /* ignore */
    }
  }
  recActive = false;
  $('n-mic').classList.remove('rec');
  $('n-mic').textContent = '🎤 dictate';
}
$('n-mic').onclick = () => {
  if (recActive) {
    stopDictation();
    return;
  }
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) {
    toast('no speech engine here — dictation needs a supporting browser');
    return;
  }
  try {
    recog = new SR();
    recog.continuous = true;
    recog.interimResults = false;
    recog.onresult = (ev: any) => {
      let add = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) add += ev.results[i][0].transcript + ' ';
      if (add) {
        const t = $<HTMLTextAreaElement>('notetext');
        t.value = (t.value ? t.value.replace(/\s+$/, '') + ' ' : '') + add.trim();
      }
    };
    recog.onerror = (e: any) => {
      stopDictation();
      toast(e.error === 'not-allowed' ? 'mic blocked — check permissions' : 'dictation error: ' + e.error);
    };
    recog.onend = () => {
      if (recActive) stopDictation();
    };
    recog.start();
    recActive = true;
    $('n-mic').classList.add('rec');
    $('n-mic').textContent = '■ stop';
  } catch {
    toast('mic unavailable');
  }
};

/* --------------------------- schema modal ----------------------------- */
$('b-schema').onclick = () => {
  $<HTMLTextAreaElement>('json').value = serializeLevel(level);
  $('err').textContent = '';
  applyPdsLink($<HTMLAnchorElement>('lex-pdslink'), $('lex-pdsnote'), pdsview.lexiconUrl(), 'lexicon');
  $('modal').style.display = 'flex';
};

/* Point a pdsview link at a record and describe its state. Until a real repo
   DID is wired into pdsview.ts the link is a preview, so say so plainly rather
   than dangle a dead "verify on your PDS" jump. */
function applyPdsLink(
  link: HTMLAnchorElement,
  note: HTMLElement,
  url: string,
  kind: 'level' | 'lexicon',
): void {
  link.href = url;
  if (pdsview.isConfigured()) {
    link.classList.remove('preview');
    note.textContent =
      kind === 'level'
        ? 'Opens this level on your PDS in the croft.ing viewer — a rendered record, not raw JSON.'
        : 'Opens the level lexicon rendered on the croft.ing viewer.';
  } else {
    link.classList.add('preview');
    note.textContent =
      'Preview — the link goes live once levels are published to your PDS (set the repo DID in src/pdsview.ts).';
  }
}
$('m-close').onclick = () => ($('modal').style.display = 'none');
$('m-copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($<HTMLTextAreaElement>('json').value);
    toast('copied — paste it to Claude');
  } catch {
    $<HTMLTextAreaElement>('json').select();
    document.execCommand('copy');
    toast('copied — paste it to Claude');
  }
};
$('m-download').onclick = () => {
  downloadLevel(level);
  toast('downloading .json');
};
$('m-load').onclick = () => {
  try {
    const l = parseLevel($<HTMLTextAreaElement>('json').value);
    snap();
    level = l;
    idSeq = maxIdNum(level) + 1;
    selId = null;
    passthroughId = null;
    syncInspector();
    syncHero();
    syncBg();
    $('modal').style.display = 'none';
    toast('level loaded');
  } catch (err) {
    $('err').textContent = (err as Error).message || 'could not load that JSON';
  }
};
$('m-clear').onclick = () => {
  snap();
  const { hero, background, backgroundImage } = level.meta;
  level = emptyLevel();
  level.meta.hero = hero;
  level.meta.background = background;
  level.meta.backgroundImage = backgroundImage;
  idSeq = 1;
  selId = null;
  passthroughId = null;
  syncInspector();
  syncBg();
  $<HTMLTextAreaElement>('json').value = serializeLevel(level);
  toast('cleared — undo brings it back');
};
$('m-demo').onclick = () => {
  snap();
  const hero = level.meta.hero;
  level = emptyLevel();
  level.meta.name = 'villain-house';
  level.meta.hero = hero;
  level.meta.background = 'grass';
  level.objects = demoObjects();
  idSeq = maxIdNum(level) + 1;
  selId = null;
  passthroughId = null;
  syncInspector();
  syncBg();
  $('modal').style.display = 'none';
  toast('demo loaded — hit ▶');
};

let toastT: ReturnType<typeof setTimeout>;
function toast(msg: string): void {
  const t = $('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.style.display = 'none'), 2600);
}

/* ------------------------------ library ------------------------------- */
$('b-lib').onclick = () => {
  $<HTMLInputElement>('sv-name').value = level.meta.name !== 'untitled' ? level.meta.name : '';
  $<HTMLInputElement>('sv-scene').value = level.meta.scene || '';
  $('lmodal').style.display = 'flex';
  renderLib();
  if (!hasPersistentStore()) toast('no persistent storage here — saves last for this session only');
};
$('l-close').onclick = () => ($('lmodal').style.display = 'none');
$('sv-go').onclick = () => {
  const name = $<HTMLInputElement>('sv-name').value.trim();
  if (!name) {
    toast('give it a name');
    return;
  }
  level.meta.name = name;
  level.meta.scene = $<HTMLInputElement>('sv-scene').value.trim();
  if (saveDraft(name, level.meta.scene, level)) {
    renderLib();
    showSaveConfirm(level);
  } else toast('save failed (custom backdrops can exceed storage limits)');
};

/* Confirm a save by showing the designed level as a still frame — the intent
   the user just captured — with a link to view it on the PDS below. */
function showSaveConfirm(l: Level): void {
  renderThumb($<HTMLCanvasElement>('sv-thumb'), l);
  $('sv-caption').textContent = l.meta.scene ? `“${l.meta.name}” · ${l.meta.scene}` : `“${l.meta.name}”`;
  applyPdsLink($<HTMLAnchorElement>('sv-pdslink'), $('sv-pdsnote'), pdsview.levelUrl(l.meta.name), 'level');
  $('svmodal').style.display = 'flex';
}
$('sv-done').onclick = () => ($('svmodal').style.display = 'none');

function loadIntoEditor(l: Level, label: string): void {
  snap();
  level = JSON.parse(JSON.stringify(l));
  idSeq = maxIdNum(level) + 1;
  selId = null;
  passthroughId = null;
  syncInspector();
  syncHero();
  syncBg();
  $('lmodal').style.display = 'none';
  toast('loaded: ' + label);
}

interface SceneRow {
  scene: string;
  cards: Array<{ name: string; level: Level; committed: boolean }>;
}
function renderLib(): void {
  const list = $('lib-list');
  list.innerHTML = '';
  const scenes = new Map<string, SceneRow>();
  const ensure = (scene: string): SceneRow => {
    const key = scene || '(no scene)';
    if (!scenes.has(key)) scenes.set(key, { scene: key, cards: [] });
    return scenes.get(key)!;
  };
  for (const c of committedLevels()) ensure(c.scene).cards.push({ name: c.name, level: c.level, committed: true });
  for (const d of listDrafts()) ensure(d.scene).cards.push({ name: d.name, level: d.level, committed: false });

  if (scenes.size === 0) {
    list.innerHTML = '<div style="color:var(--dim);font-size:12px">nothing here yet — name the current level above and Save, or commit levels under /levels/.</div>';
    return;
  }
  for (const row of scenes.values()) {
    const wrap = document.createElement('div');
    wrap.className = 'scene';
    wrap.innerHTML = `<h3>${row.scene.toUpperCase()}</h3>`;
    const cards = document.createElement('div');
    cards.className = 'cards';
    for (const rec of row.cards) {
      const card = document.createElement('div');
      card.className = 'card';
      const th = document.createElement('canvas');
      th.width = 300;
      th.height = 169;
      card.appendChild(th);
      const nm = document.createElement('div');
      nm.className = 'nm';
      nm.textContent = rec.name;
      card.appendChild(nm);
      if (rec.committed) {
        const badge = document.createElement('div');
        badge.className = 'badge';
        badge.textContent = 'committed';
        card.appendChild(badge);
      } else {
        const rm = document.createElement('button');
        rm.className = 'rm';
        rm.textContent = '✕';
        rm.addEventListener('click', (ev) => {
          ev.stopPropagation();
          deleteDraft(rec.name);
          renderLib();
          toast('deleted: ' + rec.name);
        });
        card.appendChild(rm);
      }
      try {
        renderThumb(th, rec.level);
      } catch {
        /* ignore */
      }
      card.addEventListener('click', () => loadIntoEditor(rec.level, rec.name));
      cards.appendChild(card);
    }
    wrap.appendChild(cards);
    list.appendChild(wrap);
  }
}

/* --------------------------- Test mode -------------------------------- */
type PlayCtx = { source: 'forge' } | { source: 'shell'; levels: Level[]; index: number };
let mode: 'edit' | 'play' = 'edit';
let session: PlaySession | DriveSession | DropSession | null = null;
let playKind: 'slingshot' | 'drive' | 'drop' = 'slingshot';
let playCtx: PlayCtx = { source: 'forge' };
let lastStatus: 'playing' | 'won' | 'failed' = 'playing';

function hideBanner(): void {
  const b = $('banner');
  b.style.display = 'none';
  b.classList.remove('fail');
  $('nextbtn').style.display = 'none';
}
function newSession(): void {
  hideBanner();
  lastStatus = 'playing';
  session?.destroy();
  playKind = level.meta.mode === 'drive' ? 'drive' : level.meta.mode === 'drop' ? 'drop' : 'slingshot';
  session = playKind === 'drive' ? new DriveSession(level) : playKind === 'drop' ? new DropSession(level) : new PlaySession(level);
  $('playhint').textContent =
    playKind === 'drive'
      ? 'steer with ◀ ▶ · ⤒ to jump · reach the 🏁 goal'
      : playKind === 'drop'
        ? 'tap anywhere to hop · reach the 🏁 tray, dodge the villains'
        : 'drag your hero back · release to launch';
  // drive uses on-screen ◀ ▶ ⤒; drop taps anywhere on the board
  $('drive').style.display = playKind === 'drive' ? 'flex' : 'none';
}
function startPlay(ctx: PlayCtx = { source: 'forge' }): void {
  playCtx = ctx;
  mode = 'play';
  selId = null;
  setArmed(null);
  resetView();
  syncInspector();
  $('b-play').textContent = '■';
  $('playhint').style.display = 'block';
  $('resetbtn').style.display = 'block';
  $('backbtn').style.display = ctx.source === 'shell' ? 'block' : 'none';
  $('tray').style.display = 'none';
  $('inspector').style.display = 'none';
  $('nudge').style.display = 'none';
  setTimeout(resize, 80);
  newSession();
}
function stopPlay(): void {
  mode = 'edit';
  session?.destroy();
  session = null;
  playCtx = { source: 'forge' };
  $('b-play').textContent = '▶';
  $('playhint').style.display = 'none';
  $('resetbtn').style.display = 'none';
  $('backbtn').style.display = 'none';
  $('drive').style.display = 'none';
  hideBanner();
  $('tray').style.display = 'flex';
  $('inspector').style.display = 'flex';
  setTimeout(resize, 80);
  syncInspector();
}
$('b-play').onclick = () => (mode === 'edit' ? startPlay() : stopPlay());
$('resetbtn').onclick = () => {
  if (mode === 'play') newSession();
};
$('backbtn').onclick = () => {
  if (mode === 'play') {
    session?.destroy();
    session = null;
    mode = 'edit';
  }
  showShell();
};
$('nextbtn').onclick = () => {
  if (playCtx.source !== 'shell') return;
  const next = playCtx.index + 1;
  if (next >= playCtx.levels.length) return;
  playCtx.index = next;
  loadCommittedIntoWorking(playCtx.levels[next]);
  newSession();
};

/* on-screen drive controls */
const drivePressed = new Set<string>();
function applyDriveDir(): void {
  if (playKind !== 'drive' || !(session instanceof DriveSession)) return;
  const dir = drivePressed.has('1') ? 1 : drivePressed.has('-1') ? -1 : 0;
  session.setMove(dir);
}
for (const id of ['dv-left', 'dv-right']) {
  const b = $(id);
  const d = (b as HTMLElement).dataset.d!;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    drivePressed.add(d);
    applyDriveDir();
  });
  const release = (e: Event) => {
    e.preventDefault();
    drivePressed.delete(d);
    applyDriveDir();
  };
  b.addEventListener('pointerup', release);
  b.addEventListener('pointercancel', release);
  b.addEventListener('pointerleave', release);
}
$('dv-jump').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (session instanceof DriveSession) session.jump();
});

function drawPlay(dt: number): void {
  if (!session) return;
  session.update(dt);
  drawWorldBase(false);
  // Clip play rendering to the world rectangle so a hero or debris that flies
  // off the board (e.g. up over the top, like Angry Birds) is hidden while it's
  // out of bounds and reappears when it falls back in — never drawn over the
  // surrounding UI or letterbox. The clip is popped by the ctx.restore() below.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, level.world.w, level.world.h);
  ctx.clip();
  session.render(ctx);
  ctx.restore();
  if (playKind === 'slingshot' && session instanceof PlaySession) {
    ctx.fillStyle = 'rgba(20,28,40,.65)';
    ctx.fillRect(10, 12, 170, 30);
    ctx.fillStyle = '#d8e2ef';
    ctx.font = '16px ui-monospace,monospace';
    ctx.textAlign = 'left';
    ctx.fillText('villains: ' + session.targetsLeft, 20, 33);
  } else if (playKind === 'drop' && session instanceof DropSession) {
    ctx.fillStyle = 'rgba(20,28,40,.65)';
    ctx.fillRect(10, 12, 170, 30);
    ctx.fillStyle = '#d8e2ef';
    ctx.font = '16px ui-monospace,monospace';
    ctx.textAlign = 'left';
    ctx.fillText('attempts: ' + session.attempts, 20, 33);
  }
  ctx.restore();

  if (session.status !== lastStatus) {
    lastStatus = session.status;
    const banner = $('banner');
    if (session.status === 'won') {
      banner.textContent = playKind === 'slingshot' ? 'LEVEL CLEAR' : 'GOAL! 🏁';
      banner.classList.remove('fail');
      banner.style.display = 'block';
      if (playCtx.source === 'shell' && playCtx.index < playCtx.levels.length - 1) $('nextbtn').style.display = 'block';
    } else if (session.status === 'failed') {
      banner.textContent = playKind === 'drive' ? 'OUCH — ↺ retry' : 'PROTECT FAILED';
      banner.classList.add('fail');
      banner.style.display = 'block';
    }
  }
}

/* ------------------------------ game shell ---------------------------- */
function loadCommittedIntoWorking(l: Level): void {
  level = JSON.parse(JSON.stringify(l));
  idSeq = maxIdNum(level) + 1;
  selId = null;
  passthroughId = null;
  syncInspector();
  syncHero();
  syncBg();
}
function showForge(): void {
  $('shell').classList.remove('on');
  if (location.hash !== '#/forge') history.replaceState(null, '', '#/forge');
  setTimeout(resize, 60);
}
function showShell(): void {
  if (mode === 'play') stopPlay();
  $('shell').classList.add('on');
  if (location.hash !== '#/' && location.hash !== '') history.replaceState(null, '', '#/');
  renderShell();
}
$('sh-forge').onclick = () => showForge();
$('sh-hero').onclick = () => openEmoji('hero');

function playFromShell(levels: Level[], index: number): void {
  loadCommittedIntoWorking(levels[index]);
  $('shell').classList.remove('on');
  startPlay({ source: 'shell', levels, index });
}

/* ---- shell organization state (sort / archived / tag filter) ---- */
let shellSort: SortKey = 'created';
let showArchived = false;
let tagFilter: string[] = [];

function modeBadge(l: Level): string {
  return l.meta.mode === 'drive' ? '🏁 drive' : l.meta.mode === 'drop' ? '🪂 drop' : '🎯 fling';
}

/** The unified level list: committed (bundled, read-only) + local drafts, each
    with its management overlay (archived flag + tags) applied. */
function shellEntries(): LevelEntry[] {
  const out: LevelEntry[] = [];
  for (const c of committedLevels()) {
    const key = manageKey('committed', c.scene, c.name);
    const m = getManage(key);
    out.push({ source: 'committed', scene: c.scene || '(no scene)', name: c.name, level: c.level, createdAt: 0, archived: m.archived, tags: m.tags });
  }
  for (const d of listDrafts()) {
    const key = manageKey('draft', d.scene, d.name);
    const m = getManage(key);
    out.push({ source: 'draft', scene: d.scene || '(no scene)', name: d.name, level: d.level, createdAt: d.createdAt ?? d.savedAt, archived: m.archived, tags: m.tags });
  }
  return out;
}

function syncShellTools(entries: LevelEntry[]): void {
  $('sh-sort').textContent = SORT_LABELS[shellSort];
  const archBtn = $('sh-arch');
  archBtn.classList.toggle('on', showArchived);
  const archivedCount = entries.filter((e) => e.archived).length;
  archBtn.textContent = showArchived ? '📦 hide archived' : `📦 show archived${archivedCount ? ` (${archivedCount})` : ''}`;
  // keep the active tag filter to tags that still exist, then render the chips
  const tags = allTags(entries);
  tagFilter = tagFilter.filter((t) => tags.includes(t));
  const bar = $('shell-tagbar');
  bar.innerHTML = '';
  for (const t of tags) {
    const chip = document.createElement('button');
    chip.className = 'tagchip' + (tagFilter.includes(t) ? ' on' : '');
    chip.textContent = '#' + t;
    chip.addEventListener('click', () => {
      tagFilter = tagFilter.includes(t) ? tagFilter.filter((x) => x !== t) : [...tagFilter, t];
      renderShell();
    });
    bar.appendChild(chip);
  }
}

function buildShellCard(e: LevelEntry, levels: Level[], index: number): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card shell-card' + (e.archived ? ' archived' : '');

  const th = document.createElement('canvas');
  th.width = 300;
  th.height = 169;
  card.appendChild(th);

  const nm = document.createElement('div');
  nm.className = 'nm';
  nm.textContent = (e.archived ? '📦 ' : '') + e.name;
  card.appendChild(nm);

  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.textContent = modeBadge(e.level);
  card.appendChild(badge);

  if (e.source === 'draft') {
    const db = document.createElement('div');
    db.className = 'draftbadge';
    db.textContent = 'draft';
    card.appendChild(db);
  }

  const manage = document.createElement('button');
  manage.className = 'manage';
  manage.textContent = '⋯';
  manage.title = 'manage this level';
  manage.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openManage(e);
  });
  card.appendChild(manage);

  const edit = document.createElement('button');
  edit.className = 'edit';
  edit.textContent = '✎ edit';
  edit.addEventListener('click', (ev) => {
    ev.stopPropagation();
    loadCommittedIntoWorking(e.level);
    showForge();
  });
  card.appendChild(edit);

  if (e.tags.length) {
    const tagRow = document.createElement('div');
    tagRow.className = 'tags';
    for (const t of e.tags.slice(0, 4)) {
      const s = document.createElement('span');
      s.textContent = '#' + t;
      tagRow.appendChild(s);
    }
    card.appendChild(tagRow);
  }

  try {
    renderThumb(th, e.level);
  } catch {
    /* ignore */
  }
  card.addEventListener('click', () => playFromShell(levels, index));
  return card;
}

function renderShell(): void {
  $('sh-hero').textContent = prefHero;
  const entries = shellEntries();
  syncShellTools(entries);
  const list = $('shell-list');
  list.innerHTML = '';
  const visible = filterEntries(entries, { showArchived, tags: tagFilter });
  if (!visible.length) {
    list.innerHTML = entries.length
      ? '<div class="empty">Nothing matches these filters.<br />Clear a tag or toggle 📦 show archived.</div>'
      : '<div class="empty">No levels yet.<br />Tap <b>＋ New level</b> to forge your first, or commit levels under <code>levels/&lt;scene&gt;/</code>.</div>';
    return;
  }
  // group by scene, then order within each scene by the chosen sort key
  const scenes = new Map<string, LevelEntry[]>();
  for (const e of visible) {
    if (!scenes.has(e.scene)) scenes.set(e.scene, []);
    scenes.get(e.scene)!.push(e);
  }
  const sceneNames = [...scenes.keys()].sort((a, b) => a.localeCompare(b));
  for (const scene of sceneNames) {
    const group = sortEntries(scenes.get(scene)!, shellSort);
    const levels = group.map((e) => e.level);
    const wrap = document.createElement('div');
    wrap.className = 'scene';
    wrap.innerHTML = `<h3>${scene.toUpperCase()}</h3>`;
    const row = document.createElement('div');
    row.className = 'cards';
    group.forEach((e, i) => row.appendChild(buildShellCard(e, levels, i)));
    wrap.appendChild(row);
    list.appendChild(wrap);
  }
}

$('sh-new').onclick = () => openWizard();
$('sh-sort').onclick = () => {
  shellSort = SORT_KEYS[(SORT_KEYS.indexOf(shellSort) + 1) % SORT_KEYS.length];
  renderShell();
};
$('sh-arch').onclick = () => {
  showArchived = !showArchived;
  renderShell();
};

/* ---------------------- new-level wizard ------------------------------ */
let wizardHero = DEFAULT_HERO;
let wizardBg: BackgroundKind = 'grid';
let wizardShape: WorldShape = 'wide';

function syncWizardBg(): void {
  document.querySelectorAll<HTMLElement>('.bgw[data-nlbg]').forEach((b) => b.classList.toggle('on', b.dataset.nlbg === wizardBg));
}
function syncWizardShape(): void {
  $('nl-shape').textContent = wizardShape === 'tall' ? '⬍ tall 900×1600' : '⬌ wide 1600×900';
}
function openWizard(): void {
  wizardHero = prefHero || DEFAULT_HERO;
  wizardBg = 'grid';
  wizardShape = 'wide';
  $<HTMLInputElement>('nl-name').value = '';
  $<HTMLInputElement>('nl-scene').value = '';
  $('nl-hero').textContent = wizardHero;
  syncWizardBg();
  syncWizardShape();
  $('nlmodal').style.display = 'flex';
}
function createFromWizard(): void {
  const name = $<HTMLInputElement>('nl-name').value.trim();
  if (!name) {
    toast('give your level a name');
    return;
  }
  const scene = $<HTMLInputElement>('nl-scene').value.trim();
  const l = emptyLevel(wizardShape);
  l.meta.name = name;
  l.meta.scene = scene;
  l.meta.hero = wizardHero;
  l.meta.background = wizardBg;
  loadCommittedIntoWorking(l);
  prefHero = wizardHero;
  savePrefs();
  const saved = saveDraft(name, scene, l);
  $('nlmodal').style.display = 'none';
  showForge();
  toast(saved ? `new level: ${name} — start forging` : `new level: ${name} (session only — no persistent storage)`);
}
document.querySelectorAll<HTMLElement>('.bgw[data-nlbg]').forEach((b) =>
  b.addEventListener('click', () => {
    wizardBg = b.dataset.nlbg as BackgroundKind;
    syncWizardBg();
  }),
);
$('nl-shape').onclick = () => {
  wizardShape = wizardShape === 'wide' ? 'tall' : 'wide';
  syncWizardShape();
};
$('nl-hero').onclick = () => openEmoji('newlevel');
$('nl-cancel').onclick = () => ($('nlmodal').style.display = 'none');
$('nl-create').onclick = () => createFromWizard();

/* ---------------------- per-level manage modal ------------------------ */
let mgmtEntry: LevelEntry | null = null;
let mgmtKey = '';

function renderMgmtTags(): void {
  const box = $('mgmt-tags');
  box.innerHTML = '';
  const tags = getManage(mgmtKey).tags;
  if (!tags.length) {
    box.innerHTML = '<span class="empty">no tags yet</span>';
    return;
  }
  for (const t of tags) {
    const chip = document.createElement('span');
    chip.className = 'tag';
    chip.textContent = t;
    const x = document.createElement('b');
    x.textContent = '✕';
    x.title = 'remove tag';
    x.addEventListener('click', () => {
      setTags(
        mgmtKey,
        tags.filter((v) => v !== t),
      );
      renderMgmtTags();
    });
    chip.appendChild(x);
    box.appendChild(chip);
  }
}
function addMgmtTag(): void {
  const input = $<HTMLInputElement>('mgmt-taginput');
  const raw = input.value.trim();
  if (!raw) return;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  setTags(mgmtKey, [...getManage(mgmtKey).tags, ...parts]);
  input.value = '';
  renderMgmtTags();
}
function openManage(e: LevelEntry): void {
  mgmtEntry = e;
  mgmtKey = manageKey(e.source, e.scene, e.name);
  $('mgmt-title').textContent = `MANAGE — ${e.name}`;
  const kind = e.source === 'committed' ? 'committed level' : 'local draft';
  $('mgmt-sub').textContent = `${kind} · scene: ${e.scene} · ${modeBadge(e.level)}`;
  renderMgmtTags();
  $('mgmt-archive').textContent = getManage(mgmtKey).archived ? '📤 Unarchive' : '📦 Archive';
  const del = $<HTMLButtonElement>('mgmt-delete');
  // committed levels ship inside the app bundle and can't be removed from the
  // browser — archiving is how you hide them.
  del.disabled = e.source === 'committed';
  del.title = e.source === 'committed' ? "committed levels can't be deleted — archive to hide" : 'delete this draft permanently';
  $('mgmtmodal').style.display = 'flex';
}
$('mgmt-tagadd').onclick = addMgmtTag;
$<HTMLInputElement>('mgmt-taginput').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') addMgmtTag();
});
$('mgmt-archive').onclick = () => {
  if (!mgmtEntry) return;
  const next = !getManage(mgmtKey).archived;
  setArchived(mgmtKey, next);
  $('mgmt-archive').textContent = next ? '📤 Unarchive' : '📦 Archive';
  toast(next ? 'archived — hidden unless “show archived” is on' : 'unarchived');
};
$('mgmt-delete').onclick = () => {
  if (!mgmtEntry || mgmtEntry.source !== 'draft') return;
  if (!window.confirm(`Delete draft “${mgmtEntry.name}”? This can't be undone.`)) return;
  const name = mgmtEntry.name;
  deleteDraft(name);
  mgmtEntry = null;
  $('mgmtmodal').style.display = 'none';
  toast('deleted: ' + name);
  renderShell();
};
$('mgmt-edit').onclick = () => {
  if (!mgmtEntry) return;
  loadCommittedIntoWorking(mgmtEntry.level);
  $('mgmtmodal').style.display = 'none';
  showForge();
};
$('mgmt-close').onclick = () => {
  $('mgmtmodal').style.display = 'none';
  renderShell();
};

/* ------------------------------ router -------------------------------- */
function route(): void {
  const h = location.hash;
  const play = h.match(/^#\/play\/([^/]+)\/(.+)$/);
  if (play) {
    const scene = decodeURIComponent(play[1]);
    const name = decodeURIComponent(play[2]);
    const cards = committedLevels().filter((c) => (c.scene || '(no scene)') === scene);
    const idx = cards.findIndex((c) => c.name === name);
    if (idx >= 0) {
      $('shell').classList.remove('on');
      playFromShell(cards.map((c) => c.level), idx);
      return;
    }
  }
  if (h === '#/forge') {
    showForge();
    return;
  }
  showShell();
}
window.addEventListener('hashchange', route);

/* ---------------------------- main loop ------------------------------- */
let last = performance.now();
function frame(now: number): void {
  const dt = now - last;
  last = now;
  if (mode === 'edit') {
    drawEdit();
    if (gesture) syncReadout();
  } else {
    drawPlay(dt);
  }
  if (autosaveOn && autosaveDue && now - lastAutosaveT > 800) {
    autosaveDue = false;
    lastAutosaveT = now;
    autosaveNow();
  }
  requestAnimationFrame(frame);
}

/* --------------------------- service worker --------------------------- */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* offline support is best-effort */
    });
  });
}

/* ------------------------------- boot --------------------------------- */
applyTheme();
drawIco();
syncViewBtn();
resize();
syncHistoryBtns();
syncInspector();
syncHero();
syncSettings();
syncBg();
route();
requestAnimationFrame(frame);
