/* =====================================================================
   play/behaviors.ts — per-emoji hit behaviors (M4).

   The schema stores only a key (object.hit); the registry lives in code.
   A behavior is resolved from object.hit, else inferred from the emoji
   glyph. Currently: "explode" (💣/🧨) — on break, shove nearby bodies and
   detonate breakable ones within a lethal radius (chain reactions emerge).
   ===================================================================== */

import { LevelObject } from '../schema';

export type HitBehavior = 'explode';

/** Default emoji -> behavior mapping (overridden by an explicit object.hit). */
const EMOJI_HIT: Record<string, HitBehavior> = {
  '💣': 'explode',
  '🧨': 'explode',
};

export function behaviorFor(o: LevelObject): HitBehavior | null {
  if (o.hit === 'explode') return 'explode';
  if (o.hit) return null; // unknown key -> no behavior
  if (o.shape === 'emoji' && o.emoji && EMOJI_HIT[o.emoji]) return EMOJI_HIT[o.emoji];
  return null;
}

/** Explosion tuning. */
export const EXPLOSION = {
  /** Bodies within this radius get shoved. */
  radius: 220,
  /** Breakable bodies within this radius are detonated directly. */
  lethalRadius: 120,
  /** Impulse strength (added to velocity, scaled by falloff and 1/mass). */
  impulse: 46,
};
