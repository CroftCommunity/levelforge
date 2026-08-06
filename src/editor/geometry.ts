/* =====================================================================
   editor/geometry.ts — pure geometry + snapping math.

   Kept free of DOM/canvas/global state so it is unit-testable: the magnet
   and grid-snap logic is precision-critical (flush contact beats grid
   purity) and is covered directly in test/magnet.test.ts.
   ===================================================================== */

import { ShapeKind } from '../schema';

export const SNAP = 10; // grid unit
export const MAGNET = 14; // base magnet threshold (world units, scaled by zoom)

/** A rotation-agnostic "half box" (for axis-aligned magnet math). */
export interface Extents {
  hw: number;
  hh: number;
}

/** Minimal shape needed by the geometry helpers. */
export interface GeomObject {
  id?: string;
  shape: ShapeKind;
  x: number;
  y: number;
  w?: number;
  h?: number;
  r?: number;
  angle?: number;
  /** Blob stroke points (relative to centre) — used for its bounding box. */
  pts?: Array<[number, number]>;
  /** Blob brush radius, expands the stroke's bounding box. */
  brushR?: number;
  /** Weld-group key: pieces sharing one are allowed to overlap (they fuse). */
  group?: string;
}

/** Centroid-centred isoceles wedge, apex up. Drawing and physics share this. */
export function triVerts(o: { w: number; h: number }): Array<{ x: number; y: number }> {
  return [
    { x: -o.w / 2, y: o.h / 3 },
    { x: o.w / 2, y: o.h / 3 },
    { x: 0, y: (-2 * o.h) / 3 },
  ];
}

export function pointInTri(px: number, py: number, v: Array<{ x: number; y: number }>): boolean {
  const s = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    (px - b.x) * (a.y - b.y) - (a.x - b.x) * (py - b.y);
  const d1 = s(v[0], v[1]);
  const d2 = s(v[1], v[2]);
  const d3 = s(v[2], v[0]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Distance from point (px,py) to segment (ax,ay)-(bx,by). Blob hit-testing. */
export function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Axis-aligned half-extents for magnet snapping, or null when the shape can't
 * participate: triangles never snap, and boxes only snap when their angle is a
 * multiple of 90 degrees. Circles and emoji always snap.
 */
export function extents(o: GeomObject): Extents | null {
  if (o.shape === 'circle' || o.shape === 'emoji') return { hw: o.r ?? 0, hh: o.r ?? 0 };
  // triangles and blobs never magnet-snap
  if (o.shape === 'tri' || o.shape === 'blob') return null;
  const w = o.w ?? 0;
  const h = o.h ?? 0;
  const a = Math.round(o.angle ?? 0);
  if ((((a % 180) + 180) % 180) === 90) return { hw: h / 2, hh: w / 2 };
  if ((((a % 90) + 90) % 90) === 0) return { hw: w / 2, hh: h / 2 };
  return null;
}

export const snapN = (v: number): number => Math.round(v / SNAP) * SNAP;

/**
 * Clamp a point to the world rectangle [0,w] × [0,h]. Used to keep a dragged
 * handle's centre on the board so a piece (or the launcher) can never be
 * dropped off-canvas and lost. The centre — not the full extent — is clamped
 * on purpose, so pieces can still sit flush to an edge (a boundary wall) while
 * their grab point stays reachable.
 */
export function clampToWorld(x: number, y: number, w: number, h: number): { x: number; y: number } {
  return { x: Math.max(0, Math.min(w, x)), y: Math.max(0, Math.min(h, y)) };
}

export interface MagnetResult {
  x: number;
  y: number;
  /** Whether a magnet target captured this axis (skip grid snap when true). */
  snappedX: boolean;
  snappedY: boolean;
}

/**
 * Snap `sel`'s centre to nearby pieces' edges/centres and its bottom to the
 * floor. Pure: returns the snapped centre without mutating anything.
 *
 * Threshold is MAGNET/zoom + 4 world units. Only axis-aligned pieces (see
 * extents) participate; a non-participating selection returns unchanged.
 */
export function magnetSnap(
  sel: GeomObject,
  others: GeomObject[],
  opts: { zoom: number; floorY: number },
): MagnetResult {
  const e = extents(sel);
  if (!e) return { x: sel.x, y: sel.y, snappedX: false, snappedY: false };

  const candX: number[] = [];
  const candY: number[] = [opts.floorY - e.hh];
  for (const o of others) {
    if (o.id !== undefined && o.id === sel.id) continue;
    const oe = extents(o);
    if (!oe) continue;
    candX.push(o.x, o.x - oe.hw - e.hw, o.x + oe.hw + e.hw, o.x - oe.hw + e.hw, o.x + oe.hw - e.hw);
    candY.push(o.y, o.y - oe.hh - e.hh, o.y + oe.hh + e.hh, o.y - oe.hh + e.hh, o.y + oe.hh - e.hh);
  }

  const th = MAGNET / opts.zoom + 4;
  let bx: number | null = null;
  let bdx = th;
  for (const c of candX) {
    const d = Math.abs(sel.x - c);
    if (d < bdx) {
      bdx = d;
      bx = c;
    }
  }
  let by: number | null = null;
  let bdy = th;
  for (const c of candY) {
    const d = Math.abs(sel.y - c);
    if (d < bdy) {
      bdy = d;
      by = c;
    }
  }
  return {
    x: bx ?? sel.x,
    y: by ?? sel.y,
    snappedX: bx !== null,
    snappedY: by !== null,
  };
}

/* =====================================================================
   Solid pieces — overlap resolution for design mode.

   The magnet snaps edges flush; this keeps pieces from interpenetrating so
   a structure built in the frozen edit view doesn't explode apart the moment
   physics wakes up in Test. It nudges only the piece being placed/moved out
   of any solid neighbour, along the axis of least penetration, using each
   shape's axis-aligned bounding box. Flush contact (zero overlap) is left
   untouched so magnet-snapped seams survive. Pure and unit-tested.
   ===================================================================== */

/** Axis-aligned bounding box in world coordinates. */
export interface AABB {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Overlaps at or below this many world units count as flush contact, not a
 *  collision — so magnet-snapped seams and float noise never trigger a push. */
export const SOLID_EPS = 0.5;

/** World-space axis-aligned bounding box for any shape, honouring its angle. */
export function worldAABB(o: GeomObject): AABB {
  const x = o.x;
  const y = o.y;
  if (o.shape === 'circle' || o.shape === 'emoji') {
    const r = o.r ?? 0;
    return { minX: x - r, maxX: x + r, minY: y - r, maxY: y + r };
  }
  const a = (o.angle ?? 0) / (180 / Math.PI);
  const c = Math.cos(a);
  const s = Math.sin(a);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const add = (lx: number, ly: number): void => {
    const wx = x + lx * c - ly * s;
    const wy = y + lx * s + ly * c;
    if (wx < minX) minX = wx;
    if (wx > maxX) maxX = wx;
    if (wy < minY) minY = wy;
    if (wy > maxY) maxY = wy;
  };
  if (o.shape === 'tri') {
    for (const v of triVerts({ w: o.w ?? 0, h: o.h ?? 0 })) add(v.x, v.y);
    return { minX, maxX, minY, maxY };
  }
  if (o.shape === 'blob') {
    const br = o.brushR ?? 0;
    const pts = o.pts ?? [];
    if (!pts.length) return { minX: x - br, maxX: x + br, minY: y - br, maxY: y + br };
    for (const [dx, dy] of pts) add(dx, dy);
    return { minX: minX - br, maxX: maxX + br, minY: minY - br, maxY: maxY + br };
  }
  // box
  const hw = (o.w ?? 0) / 2;
  const hh = (o.h ?? 0) / 2;
  add(-hw, -hh);
  add(hw, -hh);
  add(hw, hh);
  add(-hw, hh);
  return { minX, maxX, minY, maxY };
}

export interface SolidResult {
  x: number;
  y: number;
  /** Whether the piece had to be pushed out of a neighbour. */
  moved: boolean;
}

/**
 * The ground is solid for every piece that isn't its own fixture: return the
 * centre y that puts `o`'s lowest point flush on `floorY`, never below it. Uses
 * the piece's true (rotation-aware) bounding box, so a tilted plank rests on
 * whatever corner reaches lowest. Leaves a piece already above the floor where
 * it is. Independent of neighbour overlap — the floor holds even while a piece
 * passes through other pieces in ghost mode. Anchored pieces skip this (they're
 * exempt from the floor entirely). Pure.
 */
export function clampAboveFloor(o: GeomObject, floorY: number): number {
  const box = worldAABB(o);
  const overshoot = box.maxY - floorY;
  return overshoot > SOLID_EPS ? o.y - overshoot : o.y;
}

/**
 * Push `sel`'s centre out of any overlapping solid neighbour, returning the
 * corrected centre (clamped to the world). Only `sel` moves; `others` are
 * treated as fixed. Pieces in the same non-empty weld group as `sel` are
 * skipped — a shared group means the overlap is intentional. Resolution runs a
 * few settle passes so a piece wedged between neighbours comes to rest without
 * interpenetration. When `opts.floorY` is given, the ground is solid as well:
 * the piece's bounding box may not end below the floor line. Pure: nothing is
 * mutated.
 */
export function separate(
  sel: GeomObject,
  others: GeomObject[],
  opts: { worldW: number; worldH: number; floorY?: number },
): SolidResult {
  const boxes: AABB[] = [];
  for (const o of others) {
    if (o.id !== undefined && o.id === sel.id) continue;
    if (sel.group && o.group && sel.group === o.group) continue;
    boxes.push(worldAABB(o));
  }
  let x = sel.x;
  let y = sel.y;
  if (!boxes.length && opts.floorY === undefined) return { x, y, moved: false };

  const self = worldAABB(sel);
  const hw = (self.maxX - self.minX) / 2;
  const hh = (self.maxY - self.minY) / 2;
  // A tri's bounding box isn't centred on its centroid, so track the offset.
  const offX = (self.maxX + self.minX) / 2 - sel.x;
  const offY = (self.maxY + self.minY) / 2 - sel.y;

  let moved = false;
  const MAX_PASSES = 8;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let anyMoved = false;
    for (const b of boxes) {
      const cx = x + offX;
      const cy = y + offY;
      const dx = cx - (b.minX + b.maxX) / 2;
      const dy = cy - (b.minY + b.maxY) / 2;
      const ox = hw + (b.maxX - b.minX) / 2 - Math.abs(dx);
      const oy = hh + (b.maxY - b.minY) / 2 - Math.abs(dy);
      if (ox <= SOLID_EPS || oy <= SOLID_EPS) continue; // separated or flush
      if (ox < oy) x += dx < 0 ? -ox : ox;
      else y += dy < 0 ? -oy : oy;
      anyMoved = true;
      moved = true;
    }
    // the ground is solid too (when a floor is given): a piece can't come to
    // rest buried below the floor line — physics would eject it in Test.
    if (opts.floorY !== undefined) {
      const sink = y + offY + hh - opts.floorY;
      if (sink > SOLID_EPS) {
        y -= sink;
        anyMoved = true;
        moved = true;
      }
    }
    if (!anyMoved) break;
  }
  const c = clampToWorld(x, y, opts.worldW, opts.worldH);
  return { x: c.x, y: c.y, moved };
}
