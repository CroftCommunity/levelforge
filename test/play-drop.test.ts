import { describe, it, expect } from 'vitest';
import { loadLevel } from '../src/schema';
import { DropSession } from '../src/play/drop';

/** Build a tiny tall drop level: hero spawns up top, one wide anchored plank
    below it of the given material/role. Matter runs headless in node. */
function dropLevel(plank: Record<string, unknown>) {
  return loadLevel({
    schemaVersion: '0.8',
    meta: { name: 't', scene: '', gravity: 1, note: '', hero: '🙂', mode: 'drop', background: 'grid', backgroundImage: null },
    world: { w: 600, h: 1000, floorY: 960 },
    slingshot: { x: 300, y: 80 },
    objects: [
      { id: 'o1', shape: 'box', x: 300, y: 400, w: 500, h: 30, angle: 0, material: 'wood', anchored: true, path: null, note: '', ...plank },
    ],
  });
}

function step(s: DropSession, frames: number): void {
  for (let i = 0; i < frames; i++) s.update(16);
}

describe('DropSession — headless physics', () => {
  it('clears the level when the hero reaches a goal sensor', () => {
    const s = new DropSession(dropLevel({ material: 'stone', role: 'goal' }));
    expect(s.status).toBe('playing');
    step(s, 240); // ~4s: gravity carries the hero down onto the goal tray
    expect(s.status).toBe('won');
    s.destroy();
  });

  it('restarts (attempt++) on villain contact, and does not "win"', () => {
    const s = new DropSession(dropLevel({ shape: 'box', material: 'target', role: undefined }));
    step(s, 240);
    expect(s.status).toBe('playing'); // hazards never end the run
    expect(s.attempts).toBeGreaterThanOrEqual(1);
    s.destroy();
  });

  it('does not clear a hazard-only level (no goal to reach)', () => {
    const s = new DropSession(dropLevel({ material: 'wood', role: undefined }));
    step(s, 120);
    expect(s.status).toBe('playing');
    s.destroy();
  });

  it('a tap while grounded hops the hero upward', () => {
    const s = new DropSession(dropLevel({ material: 'wood', role: undefined }));
    step(s, 200); // settle on the plank
    // @ts-expect-error reach into the private hero for the assertion
    const restingY = s.hero.position.y;
    s.tap();
    s.update(16);
    // @ts-expect-error private
    expect(s.hero.velocity.y).toBeLessThan(0); // moving up right after the hop
    step(s, 10);
    // @ts-expect-error private
    expect(s.hero.position.y).toBeLessThan(restingY); // rose above the rest position
    s.destroy();
  });
});
