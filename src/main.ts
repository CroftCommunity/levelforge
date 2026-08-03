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
} from './schema';
import { MATERIALS, MaterialKey } from './materials';
import { SNAP, snapN, triVerts, pointInTri, distToSeg, magnetSnap, GeomObject } from './editor/geometry';
import { drawSlingshotCtx, drawMaterialCtx, renderThumb, DEG } from './editor/render';
import { drawBackdrop, agentBrief } from './editor/backdrops';
import {
  autosaveWorking,
  loadWorking,
  saveDraft,
  listDrafts,
  deleteDraft,
  hasPersistentStore,
  downloadLevel,
} from './store';
import { committedLevels, CommittedLevel } from './levels-manifest';
import { PlaySession } from './play/world';
import { DriveSession } from './play/drive';
import { DropSession } from './play/drop';
import { searchEmoji } from './editor/emoji-data';
import { behaviorFor, EFFECTS, HIT_BEHAVIORS } from './play/behaviors';

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
  hero: string;
  recents: string[];
}
const PREFS_KEY = 'lf:prefs';
function loadPrefs(): Prefs {
  const fallback: Prefs = { afterPlace: 'adjust', hero: DEFAULT_HERO, recents: ['🎃', '💣', '⭐', '🦆', '👿'] };
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw);
    return {
      afterPlace: p.afterPlace === 'stamp' ? 'stamp' : 'adjust',
      hero: typeof p.hero === 'string' && p.hero ? p.hero : DEFAULT_HERO,
      recents: Array.isArray(p.recents) && p.recents.length ? p.recents.slice(0, 10) : fallback.recents,
    };
  } catch {
    return fallback;
  }
}
function savePrefs(): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ afterPlace: settings.afterPlace, hero: prefHero, recents: emojiRecents }));
  } catch {
    /* ignore */
  }
}

const prefs = loadPrefs();
const settings = { afterPlace: prefs.afterPlace };
let prefHero = prefs.hero;
let emojiRecents = [...prefs.recents];
let curEmoji = '🎃';
let emojiFor: 'stamp' | 'hero' = 'stamp';

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

let level: Level = loadWorking() ?? withHero(emptyLevel());
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
function scheduleAutosave(): void {
  autosaveDue = true;
}

/* ------------------------------ undo / redo --------------------------- */
const undoStack: string[] = [];
const redoStack: string[] = [];
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
}
function resetView(): void {
  view.zoom = 1;
  clampView();
}
window.addEventListener('resize', () => setTimeout(resize, 80));

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
  ctx.fillStyle = '#0a0f16';
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
    drawMaterialCtx(ctx, o, false);
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
  | { kind: 'vpan'; last: { sx: number; sy: number } }
  | { kind: 'pinch'; d0: number; a0: number; o: LevelObject }
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

function applyMagnet(sel: LevelObject): { sx: boolean; sy: boolean } {
  const res = magnetSnap(sel as GeomObject, level.objects as GeomObject[], { zoom: view.zoom, floorY: level.world.floorY });
  sel.x = res.x;
  sel.y = res.y;
  return { sx: res.snappedX, sy: res.snappedY };
}

function placeArmed(p: { x: number; y: number }, sp: { sx: number; sy: number }): void {
  snap();
  const pr = armed!;
  const o: LevelObject = { id: nid(), shape: pr.shape, x: p.x, y: p.y, angle: 0, material: curMat, anchored: false, path: null, note: '' };
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
  level.objects.push(o);
  selId = o.id;
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
      gesture = { kind: 'vpan', last: sp };
    }
    return;
  }

  if (pointers.size === 2 && selected() && gesture && (gesture.kind === 'move' || gesture.kind === 'pinch')) {
    const [a, b] = [...pointers.values()];
    gesture = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), a0: Math.atan2(b.y - a.y, b.x - a.x), o: JSON.parse(JSON.stringify(selected())) };
    return;
  }
  if (pointers.size > 1) return;

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
  } else if (gesture.kind === 'move' && sel) {
    if (!gesture.lifted) {
      const ds = Math.hypot(sp.sx - gesture.s0.sx, sp.sy - gesture.s0.sy);
      if (ds > 10 && e.pointerType !== 'mouse') {
        gesture.dy -= 80 / view.zoom;
        gesture.lifted = true;
      } else if (ds > 10) gesture.lifted = true;
    }
    sel.x = p.x + gesture.dx;
    sel.y = p.y + gesture.dy;
    applyMagnet(sel);
  } else if (gesture.kind === 'path' && sel && sel.path) {
    sel.path.x = p.x;
    sel.path.y = p.y;
  } else if (gesture.kind === 'sling') {
    level.slingshot.x = p.x;
    level.slingshot.y = Math.min(p.y, level.world.floorY - 60);
  } else if (gesture.kind === 'goal' && level.meta.goal) {
    level.meta.goal.x = p.x;
    level.meta.goal.y = p.y;
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
    }
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
    s.x += dx * SNAP;
    s.y += dy * SNAP;
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

function openEmoji(mode2: 'stamp' | 'hero'): void {
  emojiFor = mode2;
  $('etitle').textContent =
    mode2 === 'hero'
      ? 'PICK YOUR HERO — the emoji you fling at the villains.'
      : 'EMOJI STAMP — a round physics body in the current material. Stamp villains with target material.';
  $<HTMLInputElement>('einput').value = '';
  $<HTMLInputElement>('esearch').value = '';
  $('eresults').innerHTML = '';
  renderEmojiPicker();
  $('emodal').style.display = 'flex';
}
function pickEmoji(em: string): void {
  emojiRecents = [em, ...emojiRecents.filter((x) => x !== em)].slice(0, 10);
  if (emojiFor === 'hero') {
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
function syncSettings(): void {
  $('set-after').textContent = settings.afterPlace === 'adjust' ? '→ ✋ adjust new piece' : 'keep stamping';
  $('set-mode').textContent = modeLabel(level.meta.mode);
  const tall = level.world.h > level.world.w;
  $('set-shape').textContent = `${tall ? '⬍ tall' : '⬌ wide'} ${level.world.w}×${level.world.h}`;
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
  const sel = selected();
  $('selwrap').style.display = sel ? 'block' : 'none';
  const shown = sel ? sel.material : curMat;
  document.querySelectorAll<HTMLElement>('.swwrap[data-m]').forEach((c) => c.classList.toggle('on', c.dataset.m === shown));
  syncNudge();
  if (!sel) return;
  $('tg-anchor').classList.toggle('on', !!sel.anchored);
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
  // offset a touch so the copy is visible, then clamp inside the world
  const off = SNAP * 2;
  dup.x = Math.max(0, Math.min(s.x + off, level.world.w));
  dup.y = Math.max(0, Math.min(s.y + off, level.world.h));
  // a copy is an independent piece — it keeps material, role, anchor, path,
  // note, sprite and its ✨ hit effect, but not the weld relationship (which
  // would fuse it to the original as one rigid body).
  delete dup.group;
  level.objects.push(dup);
  if (selId) prevSelId = selId;
  selId = dup.id;
  syncInspector();
  toast('copied — same attributes; drag it into place');
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
  $('modal').style.display = 'flex';
};
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
    toast('saved draft: ' + name);
    renderLib();
  } else toast('save failed (custom backdrops can exceed storage limits)');
};

function loadIntoEditor(l: Level, label: string): void {
  snap();
  level = JSON.parse(JSON.stringify(l));
  idSeq = maxIdNum(level) + 1;
  selId = null;
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
type PlayCtx = { source: 'forge' } | { source: 'shell'; cards: CommittedLevel[]; index: number };
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
  if (next >= playCtx.cards.length) return;
  playCtx.index = next;
  loadCommittedIntoWorking(playCtx.cards[next].level);
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
  session.render(ctx);
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
      if (playCtx.source === 'shell' && playCtx.index < playCtx.cards.length - 1) $('nextbtn').style.display = 'block';
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

function playCommitted(cards: CommittedLevel[], index: number): void {
  loadCommittedIntoWorking(cards[index].level);
  $('shell').classList.remove('on');
  startPlay({ source: 'shell', cards, index });
}

function renderShell(): void {
  $('sh-hero').textContent = prefHero;
  const list = $('shell-list');
  list.innerHTML = '';
  const all = committedLevels();
  if (!all.length) {
    list.innerHTML = '<div class="empty">No committed levels yet.<br />Open the Forge, build one, and commit it under <code>levels/&lt;scene&gt;/</code>.</div>';
    return;
  }
  const scenes = new Map<string, CommittedLevel[]>();
  for (const c of all) {
    const key = c.scene || '(no scene)';
    if (!scenes.has(key)) scenes.set(key, []);
    scenes.get(key)!.push(c);
  }
  for (const [scene, cards] of scenes) {
    const wrap = document.createElement('div');
    wrap.className = 'scene';
    wrap.innerHTML = `<h3>${scene.toUpperCase()}</h3>`;
    const row = document.createElement('div');
    row.className = 'cards';
    cards.forEach((c, i) => {
      const card = document.createElement('div');
      card.className = 'card shell-card';
      const th = document.createElement('canvas');
      th.width = 300;
      th.height = 169;
      card.appendChild(th);
      const nm = document.createElement('div');
      nm.className = 'nm';
      nm.textContent = c.name;
      card.appendChild(nm);
      const badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = c.level.meta.mode === 'drive' ? '🏁 drive' : c.level.meta.mode === 'drop' ? '🪂 drop' : '🎯 fling';
      card.appendChild(badge);
      const edit = document.createElement('button');
      edit.className = 'edit';
      edit.textContent = '✎ edit';
      edit.addEventListener('click', (ev) => {
        ev.stopPropagation();
        loadCommittedIntoWorking(c.level);
        showForge();
      });
      card.appendChild(edit);
      try {
        renderThumb(th, c.level);
      } catch {
        /* ignore */
      }
      card.addEventListener('click', () => playCommitted(cards, i));
      row.appendChild(card);
    });
    wrap.appendChild(row);
    list.appendChild(wrap);
  }
}

/* ------------------------------ router -------------------------------- */
function route(): void {
  const h = location.hash;
  const play = h.match(/^#\/play\/([^/]+)\/(.+)$/);
  if (play) {
    const scene = decodeURIComponent(play[1]);
    const name = decodeURIComponent(play[2]);
    const all = committedLevels();
    const cards = all.filter((c) => (c.scene || '(no scene)') === scene);
    const idx = cards.findIndex((c) => c.name === name);
    if (idx >= 0) {
      $('shell').classList.remove('on');
      playCommitted(cards, idx);
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
  if (autosaveDue && now - lastAutosaveT > 800) {
    autosaveDue = false;
    lastAutosaveT = now;
    autosaveWorking(level);
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
