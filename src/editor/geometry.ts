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
