/* =====================================================================
   main.ts — the LevelForge editor application.

   Ports the play-tested prototype (reference/levelforge.html) into the
   typed, modular structure: schema/materials/geometry/render/store are the
   reusable cores; this file is the DOM + canvas + gesture glue that the
   prototype proved vanilla JS is enough for. Sections mirror the prototype:
   view, undo/redo, drawing, gestures, tray, inspector, modals, library,
   and Test-mode integration.
   ===================================================================== */

import {
  Level,
  LevelObject,
  ShapeKind,
  emptyLevel,
  maxIdNum,
  serializeLevel,
  parseLevel,
  DEFAULT_FLOOR_Y,
  WORLD,
} from './schema';
import { MATERIALS, MaterialKey } from './materials';
import {
  snapN,
  triVerts,
  pointInTri,
  magnetSnap,
  GeomObject,
} from './editor/geometry';
import { drawBoardCtx, drawSlingshotCtx, drawMaterialCtx, renderThumb, DEG } from './editor/render';
import {
  autosaveWorking,
  loadWorking,
  saveDraft,
  listDrafts,
  deleteDraft,
  hasPersistentStore,
  downloadLevel,
} from './store';
import { committedLevels } from './levels-manifest';
import { PlaySession } from './play/world';

const MAXZOOM = 4;

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
];
const EMOJI_PICKS = ['🎃', '💣', '⭐', '🦆', '🐟', '🌵', '🎁', '💎', '🪵', '🧱', '🍉', '🤖'];
let curEmoji = '🎃';

let idSeq = 1;
const nid = (): string => 'o' + idSeq++;
let curMat: MaterialKey = 'wood';

function demoObjects(): LevelObject[] {
  const F = DEFAULT_FLOOR_Y;
  return [
    { id: nid(), shape: 'box', x: 1100, y: F - 40, w: 30, h: 80, angle: 0, material: 'wood', anchored: false, path: null, note: '' },
    { id: nid(), shape: 'box', x: 1240, y: F - 40, w: 30, h: 80, angle: 0, material: 'wood', anchored: false, path: null, note: '' },
    { id: nid(), shape: 'box', x: 1170, y: F - 95, w: 220, h: 26, angle: 0, material: 'wood', anchored: false, path: null, note: '' },
    { id: nid(), shape: 'tri', x: 1000, y: F - 35, w: 90, h: 70, angle: 0, material: 'stone', anchored: true, path: null, note: 'deflector ramp' },
    { id: nid(), shape: 'circle', x: 1170, y: F - 38, r: 24, angle: 0, material: 'target', anchored: false, path: null, note: '' },
    { id: nid(), shape: 'emoji', x: 1170, y: F - 150, r: 26, angle: 0, material: 'wood', emoji: '🎃', anchored: false, path: null, note: '' },
    { id: nid(), shape: 'box', x: 640, y: F - 260, w: 180, h: 22, angle: 0, material: 'metal', anchored: true, path: { x: 900, y: F - 260, speed: 90 }, note: 'moving platform, Red Ball style' },
  ];
}

let level: Level = loadWorking() ?? emptyLevel();
idSeq = maxIdNum(level) + 1;

/* ------------------------------ DOM refs ------------------------------ */
const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

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
  const W = WORLD.w * view.scale;
  const H = WORLD.h * view.scale;
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
  view.fit = Math.min(cw / WORLD.w, chh / WORLD.h);
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
function drawWorldBase(): void {
  ctx.clearRect(0, 0, cw, chh);
  ctx.fillStyle = '#0a0f16';
  ctx.fillRect(0, 0, cw, chh);
  ctx.save();
  ctx.translate(view.ox, view.oy);
  ctx.scale(view.scale, view.scale);
  drawBoardCtx(ctx, level.world.floorY);
}

function drawEdit(): void {
  drawWorldBase();
  drawSlingshotCtx(ctx, level.slingshot.x, level.slingshot.y, true);
  if (level.objects.length === 0) {
    ctx.fillStyle = 'rgba(125,142,163,.8)';
    ctx.font = '30px ui-monospace,monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      armed ? 'tap the board to stamp' : 'arm a shape, then tap the board',
      WORLD.w / 2,
      WORLD.h * 0.42,
    );
  }
  for (const o of level.objects) {
    if (o.path) {
      ctx.strokeStyle = 'rgba(120,170,230,.6)';
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
  const sel = selected();
  if (sel) {
    ctx.save();
    ctx.translate(sel.x, sel.y);
    ctx.rotate((sel.angle || 0) / DEG);
    ctx.strokeStyle = '#ff8a3d';
    ctx.lineWidth = 2.5 / view.zoom;
    ctx.setLineDash([6, 5]);
    if (sel.shape === 'box') ctx.strokeRect(-sel.w! / 2 - 6, -sel.h! / 2 - 6, sel.w! + 12, sel.h! + 12);
    else if (sel.shape === 'tri') {
      const v = triVerts({ w: sel.w!, h: sel.h! });
      ctx.beginPath();
      ctx.moveTo(v[0].x, v[0].y);
      ctx.lineTo(v[1].x, v[1].y);
      ctx.lineTo(v[2].x, v[2].y);
      ctx.closePath();
      ctx.stroke();
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
let armed: ShapePreset | null = null;
let armedRot = false;
let handMode: 'adjust' | 'view' = 'adjust';
const selected = (): LevelObject | null => level.objects.find((o) => o.id === selId) || null;

type Gesture =
  | { kind: 'vzoom'; d0: number; m0: { sx: number; sy: number }; z0: number; ox0: number; oy0: number }
  | { kind: 'vpan'; last: { sx: number; sy: number } }
  | { kind: 'pinch'; d0: number; a0: number; o: LevelObject }
  | { kind: 'move'; dx: number; dy: number; s0: { sx: number; sy: number }; lifted: boolean }
  | { kind: 'path' }
  | { kind: 'sling' };

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
    } else {
      if (lx * lx + ly * ly <= (o.r! + pad) * (o.r! + pad)) return o;
    }
  }
  return null;
}
const near = (p: { x: number; y: number }, x: number, y: number, r: number): boolean =>
  (p.x - x) ** 2 + (p.y - y) ** 2 <= r * r;

/** Apply magnet snapping to a live object, returning which axes were captured. */
function applyMagnet(sel: LevelObject): { sx: boolean; sy: boolean } {
  const res = magnetSnap(sel as GeomObject, level.objects as GeomObject[], {
    zoom: view.zoom,
    floorY: level.world.floorY,
  });
  sel.x = res.x;
  sel.y = res.y;
  return { sx: res.snappedX, sy: res.snappedY };
}

function placeArmed(p: { x: number; y: number }): void {
  snap();
  const pr = armed!;
  const o: LevelObject = {
    id: nid(),
    shape: pr.shape,
    x: p.x,
    y: p.y,
    angle: 0,
    material: curMat,
    anchored: false,
    path: null,
    note: '',
  };
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
  syncInspector();
}

cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  const p = s2w(e.clientX, e.clientY);
  const sp = scr(e);
  pointers.set(e.pointerId, p);
  spointers.set(e.pointerId, sp);

  if (mode === 'play') {
    session?.pointerDown(p);
    return;
  }

  if (handMode === 'view' && !armed) {
    if (spointers.size === 2) {
      const [a, b] = [...spointers.values()];
      gesture = {
        kind: 'vzoom',
        d0: Math.hypot(a.sx - b.sx, a.sy - b.sy),
        m0: { sx: (a.sx + b.sx) / 2, sy: (a.sy + b.sy) / 2 },
        z0: view.zoom,
        ox0: view.ox,
        oy0: view.oy,
      };
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
    gesture = {
      kind: 'pinch',
      d0: Math.hypot(a.x - b.x, a.y - b.y),
      a0: Math.atan2(b.y - a.y, b.x - a.x),
      o: { ...selected()! },
    };
    return;
  }
  if (pointers.size > 1) return;

  const sel = selected();
  if (sel && sel.path && near(p, sel.path.x, sel.path.y, 30 / view.zoom + 6)) {
    snap();
    gesture = { kind: 'path' };
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
    selId = hit.id;
    syncInspector();
    snap();
    gesture = { kind: 'move', dx: hit.x - p.x, dy: hit.y - p.y, s0: sp, lifted: false };
    return;
  }
  if (armed) {
    placeArmed(p);
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
    session?.pointerMove(p);
    return;
  }
  if (!gesture) return;
  const sel = selected();

  if (gesture.kind === 'vpan') {
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
    } else {
      sel.r = Math.max(14, gesture.o.r! * k);
    }
    sel.angle = Math.round(gesture.o.angle + (ang - gesture.a0) * DEG);
  } else if (gesture.kind === 'move' && sel) {
    if (!gesture.lifted) {
      const ds = Math.hypot(sp.sx - gesture.s0.sx, sp.sy - gesture.s0.sy);
      if (ds > 10 && e.pointerType !== 'mouse') {
        gesture.dy -= 80 / view.zoom; // lift above the fingertip
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
  }
});

function endPointer(e: PointerEvent): void {
  pointers.delete(e.pointerId);
  spointers.delete(e.pointerId);
  if (mode === 'play') {
    if (pointers.size === 0) session?.pointerUp();
    return;
  }
  if (pointers.size > 0) return;
  const sel = selected();
  if (gesture) {
    if (gesture.kind === 'move' && sel) {
      const m = applyMagnet(sel);
      if (!m.sx) sel.x = snapN(sel.x);
      if (!m.sy) sel.y = snapN(sel.y);
    }
    if (gesture.kind === 'pinch' && sel) {
      if (sel.shape === 'box' || sel.shape === 'tri') {
        sel.w = snapN(sel.w!);
        sel.h = snapN(sel.h!);
      } else sel.r = snapN(sel.r!);
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
    scheduleAutosave();
  }
  gesture = null;
  syncInspector();
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);

/* ------------------- tray: ✋ / 🔍 + shape presets -------------------- */
const tray = $('tray');
const trayEls: Array<{ el: HTMLElement; pr: ShapePreset }> = [];

const handrow = document.createElement('div');
handrow.id = 'handrow';
const adjEl = document.createElement('div');
adjEl.className = 'preset on';
adjEl.innerHTML = '<span class="ico">✋</span>adjust';
adjEl.addEventListener('click', () => {
  handMode = 'adjust';
  setArmed(null);
});
const viewEl = document.createElement('div');
viewEl.className = 'preset';
viewEl.innerHTML = '<span class="ico">🔍</span>view';
viewEl.addEventListener('click', () => {
  handMode = 'view';
  setArmed(null);
});
handrow.appendChild(adjEl);
handrow.appendChild(viewEl);
tray.appendChild(handrow);

function syncHand(): void {
  adjEl.classList.toggle('on', !armed && handMode === 'adjust');
  viewEl.classList.remove('on');
  viewEl.classList.toggle('viewon', !armed && handMode === 'view');
}

for (const pr of SHAPES) {
  const el = document.createElement('div');
  el.className = 'preset';
  el.innerHTML = `<span class="ico"></span>${pr.name}`;
  el.addEventListener('click', () => {
    if (mode === 'play') return;
    if (armed === pr && pr.rotatable) {
      armedRot = !armedRot;
      drawIco();
      return;
    }
    if (armed === pr && pr.shape === 'emoji') {
      openEmoji();
      return;
    }
    if (armed === pr) {
      setArmed(null);
      return;
    }
    armedRot = false;
    if (pr.shape === 'emoji' && !curEmoji) openEmoji();
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
    } else {
      ico.innerHTML = `<span class="shp" style="width:20px;height:20px;border-radius:50%;background:${col}"></span>`;
    }
  }
}
function setArmed(pr: ShapePreset | null): void {
  armed = pr;
  if (!armed) armedRot = false;
  trayEls.forEach((x) => x.el.classList.toggle('on', x.pr === armed));
  if (armed) selId = null;
  syncHand();
  drawIco();
  syncInspector();
}
drawIco();
syncHand();

/* --------------------------- emoji picker ----------------------------- */
const epicks = $('epicks');
for (const em of EMOJI_PICKS) {
  const b = document.createElement('button');
  b.textContent = em;
  b.addEventListener('click', () => {
    curEmoji = em;
    drawIco();
    $('emodal').style.display = 'none';
  });
  epicks.appendChild(b);
}
function openEmoji(): void {
  $<HTMLInputElement>('einput').value = '';
  $('emodal').style.display = 'flex';
}
$('e-set').onclick = () => {
  const v = $<HTMLInputElement>('einput').value.trim();
  if (v) curEmoji = [...v][0] ? v : curEmoji;
  drawIco();
  $('emodal').style.display = 'none';
};
$('e-close').onclick = () => ($('emodal').style.display = 'none');

/* ----------------------------- inspector ------------------------------ */
function syncInspector(): void {
  const sel = selected();
  $('selwrap').style.display = sel ? 'block' : 'none';
  $('hint').style.display = sel ? 'none' : 'block';
  const shown = sel ? sel.material : curMat;
  document
    .querySelectorAll<HTMLElement>('.swwrap[data-m]')
    .forEach((c) => c.classList.toggle('on', c.dataset.m === shown));
  if (!sel) return;
  $('tg-anchor').classList.toggle('on', !!sel.anchored);
  $('tg-move').classList.toggle('on', !!sel.path);
  $('tg-note').classList.toggle('on', !!sel.note);
  const protect = $('tg-protect');
  protect.style.display = sel.material === 'target' ? 'flex' : 'none';
  protect.classList.toggle('on', sel.role === 'protect');
  syncReadout();
}
function syncReadout(): void {
  const sel = selected();
  if (!sel) return;
  const size =
    sel.shape === 'box' || sel.shape === 'tri'
      ? `${Math.round(sel.w!)}×${Math.round(sel.h!)}`
      : `r${Math.round(sel.r!)}`;
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
      // role only applies to targets; drop it when leaving target material
      if (s.material !== 'target') delete s.role;
    }
    syncInspector();
  }),
);
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
  s.path = s.path ? null : { x: Math.min(s.x + 200, WORLD.w - 40), y: s.y, speed: 90 };
  syncInspector();
};
$('tg-protect').onclick = () => {
  const s = selected();
  if (!s || s.material !== 'target') return;
  snap();
  s.role = s.role === 'protect' ? 'destroy' : 'protect';
  syncInspector();
};
$('del').onclick = () => {
  if (!selId) return;
  snap();
  level.objects = level.objects.filter((o) => o.id !== selId);
  selId = null;
  syncInspector();
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
      for (let i = ev.resultIndex; i < ev.results.length; i++)
        if (ev.results[i].isFinal) add += ev.results[i][0].transcript + ' ';
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
    $('modal').style.display = 'none';
    toast('level loaded');
  } catch (err) {
    $('err').textContent = (err as Error).message || 'could not load that JSON';
  }
};
$('m-clear').onclick = () => {
  snap();
  level = emptyLevel();
  idSeq = 1;
  selId = null;
  syncInspector();
  $<HTMLTextAreaElement>('json').value = serializeLevel(level);
  toast('cleared — undo brings it back');
};
$('m-demo').onclick = () => {
  snap();
  level = emptyLevel();
  level.meta.name = 'starter-tower';
  level.objects = demoObjects();
  selId = null;
  syncInspector();
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
$('b-lib').onclick = async () => {
  $<HTMLInputElement>('sv-name').value = level.meta.name !== 'untitled' ? level.meta.name : '';
  $<HTMLInputElement>('sv-scene').value = level.meta.scene || '';
  $('lmodal').style.display = 'flex';
  renderLib();
  if (!hasPersistentStore())
    toast('no persistent storage here — saves last for this session only');
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
  } else toast('save failed');
};

function loadIntoEditor(l: Level, label: string): void {
  snap();
  level = JSON.parse(JSON.stringify(l));
  idSeq = maxIdNum(level) + 1;
  selId = null;
  syncInspector();
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

  // Committed levels first (read-only), then local drafts (deletable, newest first).
  for (const c of committedLevels()) ensure(c.scene).cards.push({ name: c.name, level: c.level, committed: true });
  for (const d of listDrafts()) ensure(d.scene).cards.push({ name: d.name, level: d.level, committed: false });

  if (scenes.size === 0) {
    list.innerHTML =
      '<div style="color:var(--dim);font-size:12px">nothing here yet — name the current level above and Save, or commit levels under /levels/.</div>';
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
        /* ignore thumbnail failures */
      }
      card.addEventListener('click', () => loadIntoEditor(rec.level, rec.name));
      cards.appendChild(card);
    }
    wrap.appendChild(cards);
    list.appendChild(wrap);
  }
}

/* --------------------------- Test mode -------------------------------- */
let mode: 'edit' | 'play' = 'edit';
let session: PlaySession | null = null;
let lastStatus: 'playing' | 'won' | 'failed' = 'playing';

function startPlay(): void {
  mode = 'play';
  selId = null;
  setArmed(null);
  resetView();
  syncInspector();
  $('b-play').textContent = '■';
  $('playhint').style.display = 'block';
  $('resetbtn').style.display = 'block';
  const banner = $('banner');
  banner.style.display = 'none';
  banner.classList.remove('fail');
  $('tray').style.display = 'none';
  $('inspector').style.display = 'none';
  setTimeout(resize, 80);

  lastStatus = 'playing';
  session = new PlaySession(level);
}
function stopPlay(): void {
  mode = 'edit';
  session?.destroy();
  session = null;
  $('b-play').textContent = '▶';
  $('playhint').style.display = 'none';
  $('resetbtn').style.display = 'none';
  const banner = $('banner');
  banner.style.display = 'none';
  banner.classList.remove('fail');
  $('tray').style.display = 'flex';
  $('inspector').style.display = 'flex';
  setTimeout(resize, 80);
}
$('b-play').onclick = () => (mode === 'edit' ? startPlay() : stopPlay());
$('resetbtn').onclick = () => {
  if (mode !== 'play') return;
  session?.destroy();
  const banner = $('banner');
  banner.style.display = 'none';
  banner.classList.remove('fail');
  lastStatus = 'playing';
  session = new PlaySession(level);
};

function drawPlay(dt: number): void {
  if (!session) return;
  session.update(dt);
  drawWorldBase();
  session.render(ctx);
  ctx.fillStyle = '#7d8ea3';
  ctx.font = '16px ui-monospace,monospace';
  ctx.textAlign = 'left';
  ctx.fillText('targets: ' + session.targetsLeft, 20, 34);
  ctx.restore();

  if (session.status !== lastStatus) {
    lastStatus = session.status;
    const banner = $('banner');
    if (session.status === 'won') {
      banner.textContent = 'LEVEL CLEAR';
      banner.classList.remove('fail');
      banner.style.display = 'block';
    } else if (session.status === 'failed') {
      banner.textContent = 'PROTECT FAILED';
      banner.classList.add('fail');
      banner.style.display = 'block';
    }
  }
}

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
resize();
syncHistoryBtns();
syncInspector();
requestAnimationFrame(frame);
