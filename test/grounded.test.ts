import { describe, it, expect } from 'vitest';
import { GroundTracker, heroHasFooting } from '../src/play/grounded';
import { COYOTE_MS } from '../src/play/tuning';

/** Minimal Matter.Body/Pair stand-ins — grounded.ts only touches position,
    parent, isSensor, and the contact/support geometry. */
function body(x: number, y: number, over: Record<string, unknown> = {}): any {
  return { position: { x, y }, parent: undefined, isSensor: false, ...over };
}
function pair(a: any, b: any, supports: Array<{ x: number; y: number }>, over: Record<string, unknown> = {}): any {
  return {
    isSensor: false,
    bodyA: a,
    bodyB: b,
    activeContacts: supports.map((v) => ({ vertex: v })),
    collision: { supports, normal: { x: 0, y: 1 } },
    ...over,
  };
}

const R = 22;

describe('heroHasFooting', () => {
  it('is grounded when a support point is under the hero', () => {
    const hero = body(100, 100);
    const floor = body(100, 130);
    // support point clearly below the hero centre
    expect(heroHasFooting(hero, [pair(hero, floor, [{ x: 100, y: 121 }])], R)).toBe(true);
  });

  it('is not grounded when the only contact is overhead', () => {
    const hero = body(100, 100);
    const ceiling = body(100, 70);
    expect(heroHasFooting(hero, [pair(hero, ceiling, [{ x: 100, y: 79 }])], R)).toBe(false);
  });

  it('ignores sensor pairs and sensor bodies (goal zones do not hold you up)', () => {
    const hero = body(100, 100);
    const goal = body(100, 130, { isSensor: true });
    expect(heroHasFooting(hero, [pair(hero, goal, [{ x: 100, y: 121 }], { isSensor: true })], R)).toBe(false);
    expect(heroHasFooting(hero, [pair(hero, goal, [{ x: 100, y: 121 }])], R)).toBe(false);
  });

  it('ignores pairs the hero is not part of', () => {
    const hero = body(100, 100);
    const a = body(300, 300);
    const b = body(300, 330);
    expect(heroHasFooting(hero, [pair(a, b, [{ x: 300, y: 321 }])], R)).toBe(false);
  });
});

describe('GroundTracker coyote window', () => {
  it('cannot jump before ever touching ground', () => {
    const g = new GroundTracker();
    expect(g.canJump(0)).toBe(false);
  });

  it('allows a jump within the coyote window after leaving the ground', () => {
    const g = new GroundTracker();
    g.mark(1000);
    expect(g.canJump(1000 + COYOTE_MS - 1)).toBe(true); // just inside → coyote hop fires
    expect(g.canJump(1000 + COYOTE_MS + 1)).toBe(false); // past the window → no hop
  });

  it('reset blocks a second (mid-air) jump until grounded again', () => {
    const g = new GroundTracker();
    g.mark(1000);
    expect(g.canJump(1000)).toBe(true);
    g.reset();
    expect(g.canJump(1000)).toBe(false);
  });

  it('observe stamps grounded from a real underfoot contact', () => {
    const g = new GroundTracker();
    const hero = body(100, 100);
    const floor = body(100, 130);
    g.observe(hero, [pair(hero, floor, [{ x: 100, y: 121 }])], R, 500);
    expect(g.canJump(500)).toBe(true);
  });
});
