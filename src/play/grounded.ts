/* =====================================================================
   play/grounded.ts — shared grounded-contact + coyote-time tracking.

   Drop and bounce both gate their jump on "is the hero standing on
   something?". The spec wants this decided from real contacts, not a velocity
   heuristic: on each collision pair involving the hero (resolved to compound
   parents, sensors excluded), if any contact support point lies below the hero
   centre, the hero is grounded. A short coyote window (COYOTE_MS) then lets a
   jump still fire just after rolling off an edge.

   Extracted here so drop.ts and bounce.ts share ONE implementation, per the
   build plan — do not duplicate it.
   ===================================================================== */

import Matter from 'matter-js';
import { COYOTE_MS } from './tuning';

/** Support points below the hero centre by more than this fraction of r count
    as "underfoot" (the plan's 0.35 r). */
const SUPPORT_FRACTION = 0.35;

function topOf(b: Matter.Body): Matter.Body {
  return b.parent && b.parent !== b ? b.parent : b;
}

/**
 * Does any pair in this collision batch put a solid contact under the hero?
 * Resolves compound parents and skips sensors (goal zones never "hold" you up).
 */
export function heroHasFooting(hero: Matter.Body, pairs: Matter.Pair[], r: number): boolean {
  const foot = hero.position.y + SUPPORT_FRACTION * r;
  for (const pair of pairs) {
    if (pair.isSensor) continue;
    const a = topOf(pair.bodyA);
    const b = topOf(pair.bodyB);
    let other: Matter.Body;
    if (a === hero) other = b;
    else if (b === hero) other = a;
    else continue;
    if (other.isSensor) continue;
    // Prefer real support points; fall back to the collision's support set.
    const supports = pair.activeContacts?.map((ct) => ct.vertex) ?? pair.collision?.supports ?? [];
    for (const s of supports) {
      if (s && s.y >= foot) return true;
    }
    // If matter gave us no support geometry, fall back to the normal direction:
    // a normal pointing up from `other` toward the hero means it's underneath.
    if (!supports.length && pair.collision) {
      const n = pair.collision.normal;
      const dir = a === hero ? 1 : -1; // normal points from A to B
      if (n && n.y * dir < -0.5) return true;
    }
  }
  return false;
}

/** Tracks the last time the hero had footing, and answers coyote-window queries. */
export class GroundTracker {
  private lastGround = -Infinity;

  /** Feed a collision batch (from collisionStart or collisionActive). */
  observe(hero: Matter.Body, pairs: Matter.Pair[], r: number, nowMs: number): void {
    if (heroHasFooting(hero, pairs, r)) this.lastGround = nowMs;
  }

  /** Force the grounded stamp (e.g. right after a respawn on the ground). */
  mark(nowMs: number): void {
    this.lastGround = nowMs;
  }

  /** Can the hero jump right now — grounded, or within the coyote window? */
  canJump(nowMs: number): boolean {
    return nowMs - this.lastGround < COYOTE_MS;
  }

  /** Consume the grounded state so a single contact yields a single jump. */
  reset(): void {
    this.lastGround = -Infinity;
  }
}
