/* =====================================================================
   play/break-model.ts — the breakage math, isolated and testable.

   On collisionStart we compute the pair's relative speed and, for each
   breakable body, an impact figure. A static partner (floor, wall, anchored
   piece) transfers speed directly; a moving partner scales by its (capped)
   mass. The piece breaks when impact exceeds its material's breakAt.
   These constants are play-tested — treat them as tuning knobs.
   ===================================================================== */

export const STATIC_IMPACT_FACTOR = 0.55;
export const DYNAMIC_IMPACT_FACTOR = 0.3;
export const MASS_CAP = 10;

/** Relative speeds below this carry no impact at all. Resting stacks produce
    a stream of low-speed contact jitter as the solver settles them; without a
    dead zone, a heavy (mass-capped) box sitting on a beam turns a ~3-unit
    settle jolt into a break-threshold impact and static structures crumble
    on their own. Real hits (a hero launch, a toppling piece) arrive well
    above this. */
export const MIN_BREAK_SPEED = 4;

/**
 * Impact delivered to a body struck at `speed` (relative pair speed) by a
 * partner of `otherMass`. Static partners ignore mass. Speeds under
 * MIN_BREAK_SPEED are settling noise and deliver zero.
 */
export function impactOf(speed: number, otherMass: number, otherIsStatic: boolean): number {
  if (speed < MIN_BREAK_SPEED) return 0;
  if (otherIsStatic) return speed * STATIC_IMPACT_FACTOR;
  return speed * Math.min(otherMass, MASS_CAP) * DYNAMIC_IMPACT_FACTOR;
}

/** Whether a body with the given breakAt (null = unbreakable) breaks at impact. */
export function breaksAt(impact: number, breakAt: number | null): boolean {
  if (breakAt == null) return false;
  return impact > breakAt;
}
