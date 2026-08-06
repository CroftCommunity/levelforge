import { describe, it, expect } from 'vitest';
import { loadLevel } from '../src/schema';
import { DriveSession } from '../src/play/drive';

/** A wide floor level for the drive hero. The hero spawns 120px above floorY
    (see DriveSession) and gravity drops it onto the static ground. Matter runs
    headless in node. The goal sits far away so the run stays 'playing'. */
function driveLevel(bounce?: number) {
  return loadLevel({
    schemaVersion: '0.8',
    meta: {
      name: 't', scene: '', gravity: 1, note: '', hero: '🙂', mode: 'drive',
      background: 'grid', backgroundImage: null,
      goal: { x: 40, y: 200, r: 20 },
      ...(bounce === undefined ? {} : { bounce }),
    },
    world: { w: 800, h: 600, floorY: 520 },
    slingshot: { x: 400, y: 80 },
    objects: [],
  });
}

/** Peak upward rebound speed the hero reaches over `frames` after being dropped
    onto the floor (0 if it never moves up). */
function maxRebound(bounce: number | undefined, frames: number): number {
  const s = new DriveSession(driveLevel(bounce));
  let peak = 0;
  for (let i = 0; i < frames; i++) {
    s.update(16);
    // @ts-expect-error reach into the private hero for the assertion
    peak = Math.min(peak, s.hero.velocity.y);
  }
  s.destroy();
  return -peak;
}

function step(s: DriveSession, frames: number): void {
  for (let i = 0; i < frames; i++) s.update(16);
}

describe('DriveSession — headless physics', () => {
  it('the hero is a rubber ball: it rebounds off the floor', () => {
    const s = new DriveSession(driveLevel());
    let bounced = false;
    // Drop, land, and watch for a clear upward rebound (a dead ball would only
    // ever produce vy ≈ 0 after impact, never a real bounce back up).
    for (let i = 0; i < 120; i++) {
      s.update(16);
      // @ts-expect-error reach into the private hero for the assertion
      if (s.hero.velocity.y < -1.5) bounced = true;
    }
    expect(bounced).toBe(true);
    s.destroy();
  });

  it('meta.bounce tunes the rebound: a dead-ball setting barely bounces', () => {
    const dead = maxRebound(0, 120); // restitution 0 → almost no rebound
    const lively = maxRebound(0.92, 120); // rubber default → a real bounce
    expect(dead).toBeLessThan(2);
    expect(lively).toBeGreaterThan(dead + 3);
  });

  it('a jump fires when the hero is resting on the ground', () => {
    const s = new DriveSession(driveLevel());
    step(s, 400); // let the bounces damp out and settle on the floor
    // @ts-expect-error private
    const restingY = s.hero.position.y;
    s.jump();
    s.update(16);
    // @ts-expect-error private
    expect(s.hero.velocity.y).toBeLessThan(0); // moving up right after the jump
    step(s, 8);
    // @ts-expect-error private
    expect(s.hero.position.y).toBeLessThan(restingY); // rose above the rest position
    s.destroy();
  });
});
