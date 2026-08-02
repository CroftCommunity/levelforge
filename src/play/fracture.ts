/* =====================================================================
   play/fracture.ts — pure geometry for blob shatter (M4).

   Given a broken blob's points (relative to its centre), its world transform
   at the moment of breaking, and a fragment cap, compute where each debris
   circle spawns. Kept free of Matter/DOM so the rotation + decimation math is
   unit-testable; world.ts adds the physics bodies and velocities.
   ===================================================================== */

import { BlobPoint } from '../schema';

export interface FragmentPlacement {
  x: number;
  y: number;
  r: number;
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
