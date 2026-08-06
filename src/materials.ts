/* =====================================================================
   materials.ts — the material table.

   Materials carry ALL physics (density, friction, restitution, breakAt).
   Shape is pure geometry; material is the independent axis. Values are the
   play-tested prototype numbers from reference/levelforge.html — treat them
   as tuning knobs, but keep them here as the single source of truth.
   ===================================================================== */

export interface Material {
  /** Base fill colour used by the procedural per-material renderer. */
  color: string;
  density: number;
  friction: number;
  restitution: number;
  /** Impact threshold above which the body breaks, or null for "never". */
  breakAt: number | null;
}

export const MATERIALS = {
  wood: { color: '#b5824c', density: 0.001, friction: 0.4, restitution: 0.2, breakAt: 12 },
  stone: { color: '#8e939c', density: 0.0025, friction: 0.6, restitution: 0.1, breakAt: 20 },
  metal: { color: '#a9b6c4', density: 0.004, friction: 0.3, restitution: 0.05, breakAt: null },
  ice: { color: '#9fd6ea', density: 0.0009, friction: 0.05, restitution: 0.1, breakAt: 6.5 },
  rubber: { color: '#d94f5c', density: 0.0012, friction: 0.9, restitution: 0.92, breakAt: null },
  target: { color: '#7bc86c', density: 0.0008, friction: 0.5, restitution: 0.3, breakAt: 3.2 },
} satisfies Record<string, Material>;

export type MaterialKey = keyof typeof MATERIALS;

/** Ordered list of material keys — drives the inspector swatch row. */
export const MATERIAL_KEYS = Object.keys(MATERIALS) as MaterialKey[];

export function isMaterialKey(v: unknown): v is MaterialKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(MATERIALS, v);
}
