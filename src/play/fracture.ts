/* =====================================================================
   play/fracture.ts — pure geometry for blob shatter (M4).

   Given a broken blob's points (relative to its centre), its world transform
   at the moment of breaking, and a fragment cap, compute where each debris
   circle spawns. Kept free of Matter/DOM so the rotation + decimation math is
   unit-testable; world.ts adds the physics bodies and velocities.
   ===================================================================== */

import { BlobPoint } from '../schema';
import { MaterialKey } from '../materials';
import { triVerts, pointInTri } from '../editor/geometry';

export interface FragmentPlacement {
  x: number;
  y: number;
  r: number;
}

/** How a material's break debris is drawn: tapered 'shard' or rounded 'chunk'. */
export type DebrisKind = 'shard' | 'chunk';

/**
 * Which solid materials leave debris when a (non-blob) piece breaks, and its
 * look. Wood/ice splinter into shards; stone crumbles into rubble chunks. Metal
 * and rubber never break, and target villains carry their own hit effects, so
 * none of them appear here.
 */
const DEBRIS_KIND: Partial<Record<MaterialKey, DebrisKind>> = {
  wood: 'shard',
  stone: 'chunk',
  ice: 'shard',
};

/** Debris kind for a material, or null if it leaves none. */
export function debrisKindFor(material: MaterialKey): DebrisKind | null {
  return DEBRIS_KIND[material] ?? null;
}

export function fragmentPlacements(
  pts: BlobPoint[],
  brushR: number,
  at: { x: number; y: number },
  angle: number,
  max: number,
): FragmentPlacement[] {
  const out: FragmentPlacement[] = [];
  if (!pts.length) return out;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const r = Math.max(6, brushR * 0.55);
  const step = Math.max(1, Math.ceil(pts.length / max));
  for (let i = 0; i < pts.length; i += step) {
    const [px, py] = pts[i];
    out.push({ x: at.x + (px * cos - py * sin), y: at.y + (px * sin + py * cos), r });
  }
  return out;
}

/** Roughly the world size of one splinter chunk before area-based capping. */
const SPLINTER_CELL = 18;

/**
 * Sample chunky splinter spawn points across a solid shape's footprint, applied
 * at the body's world transform (mirrors `fragmentPlacements`, but for the solid
 * box/circle/tri shapes that carry no blob points). A grid is laid over the
 * shape's local bounding box, decimated to at most `max` cells, and clipped to
 * the actual shape (disk for circles, the triangle for tris). Pure geometry —
 * world.ts turns each placement into a physics body with scatter velocity.
 */
export function splinterPlacements(
  shape: 'box' | 'circle' | 'tri',
  dims: { w?: number; h?: number; r?: number },
  at: { x: number; y: number },
  angle: number,
  max: number,
): FragmentPlacement[] {
  const out: FragmentPlacement[] = [];
  const rad = dims.r ?? 0;
  const w = dims.w ?? 0;
  const h = dims.h ?? 0;
  // Local bounding box (triVerts centres the triangle's centroid at the origin,
  // so its box is asymmetric in y).
  let minX: number, maxX: number, minY: number, maxY: number;
  if (shape === 'circle') {
    minX = -rad;
    maxX = rad;
    minY = -rad;
    maxY = rad;
  } else if (shape === 'tri') {
    minX = -w / 2;
    maxX = w / 2;
    minY = (-2 * h) / 3;
    maxY = h / 3;
  } else {
    minX = -w / 2;
    maxX = w / 2;
    minY = -h / 2;
    maxY = h / 2;
  }
  const bw = maxX - minX;
  const bh = maxY - minY;
  if (bw <= 0 || bh <= 0) return out;

  let cols = Math.max(1, Math.round(bw / SPLINTER_CELL));
  let rows = Math.max(1, Math.round(bh / SPLINTER_CELL));
  while (cols * rows > max) {
    if (cols >= rows && cols > 1) cols--;
    else if (rows > 1) rows--;
    else break;
  }
  const cw = bw / cols;
  const ch = bh / rows;
  const r = Math.max(4, Math.min(cw, ch) * 0.5);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const tv = shape === 'tri' ? triVerts({ w, h }) : null;

  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      const lx = minX + cw * (ix + 0.5);
      const ly = minY + ch * (iy + 0.5);
      if (shape === 'circle' && Math.hypot(lx, ly) > rad) continue;
      if (tv && !pointInTri(lx, ly, tv)) continue;
      out.push({ x: at.x + (lx * cos - ly * sin), y: at.y + (lx * sin + ly * cos), r });
    }
  }
  // A tiny or heavily-clipped shape can miss every cell centre — still splinter once.
  if (!out.length) out.push({ x: at.x, y: at.y, r: Math.max(4, Math.min(bw, bh) * 0.4) });
  return out;
}
