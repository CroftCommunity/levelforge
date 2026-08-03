import { describe, it, expect } from 'vitest';
import { fragmentPlacements, splinterPlacements } from '../src/play/fracture';
import { BlobPoint } from '../src/schema';

describe('fragmentPlacements', () => {
  const pts: BlobPoint[] = [
    [-40, 0],
    [-20, 0],
    [0, 0],
    [20, 0],
    [40, 0],
  ];

  it('places fragments at the world transform of each sampled point', () => {
    const out = fragmentPlacements(pts, 20, { x: 100, y: 200 }, 0, 24);
    expect(out).toHaveLength(5);
    expect(out[0]).toMatchObject({ x: 60, y: 200 });
    expect(out[4]).toMatchObject({ x: 140, y: 200 });
    expect(out[0].r).toBeGreaterThanOrEqual(6);
  });

  it('rotates points by the body angle', () => {
    const out = fragmentPlacements([[10, 0]], 20, { x: 0, y: 0 }, Math.PI / 2, 24);
    expect(out[0].x).toBeCloseTo(0);
    expect(out[0].y).toBeCloseTo(10);
  });

  it('caps and decimates to at most `max` fragments', () => {
    const many: BlobPoint[] = Array.from({ length: 70 }, (_, i) => [i, 0]);
    const out = fragmentPlacements(many, 26, { x: 0, y: 0 }, 0, 24);
    expect(out.length).toBeLessThanOrEqual(24);
    expect(out.length).toBeGreaterThan(0);
  });

  it('returns nothing for an empty blob', () => {
    expect(fragmentPlacements([], 20, { x: 0, y: 0 }, 0, 24)).toEqual([]);
  });
});

describe('splinterPlacements', () => {
  it('spreads splinters across a box footprint at its world position', () => {
    const out = splinterPlacements('box', { w: 80, h: 40 }, { x: 200, y: 300 }, 0, 14);
    expect(out.length).toBeGreaterThan(1);
    // every splinter lands within the box's world bounds (+ its own radius)
    for (const f of out) {
      expect(f.x).toBeGreaterThanOrEqual(200 - 40 - f.r);
      expect(f.x).toBeLessThanOrEqual(200 + 40 + f.r);
      expect(f.y).toBeGreaterThanOrEqual(300 - 20 - f.r);
      expect(f.y).toBeLessThanOrEqual(300 + 20 + f.r);
      expect(f.r).toBeGreaterThanOrEqual(4);
    }
  });

  it('never exceeds the fragment cap', () => {
    const out = splinterPlacements('box', { w: 400, h: 400 }, { x: 0, y: 0 }, 0, 14);
    expect(out.length).toBeLessThanOrEqual(14);
    expect(out.length).toBeGreaterThan(0);
  });

  it('clips circle splinters to the disk', () => {
    const out = splinterPlacements('circle', { r: 50 }, { x: 0, y: 0 }, 0, 24);
    expect(out.length).toBeGreaterThan(0);
    for (const f of out) expect(Math.hypot(f.x, f.y)).toBeLessThanOrEqual(50);
  });

  it('rotates the footprint by the body angle', () => {
    // a wide, flat box rotated 90° becomes tall — a splinter far on +x maps to +y
    const flat = splinterPlacements('box', { w: 120, h: 8 }, { x: 0, y: 0 }, 0, 14);
    const spun = splinterPlacements('box', { w: 120, h: 8 }, { x: 0, y: 0 }, Math.PI / 2, 14);
    const flatSpanX = Math.max(...flat.map((f) => Math.abs(f.x)));
    const spunSpanY = Math.max(...spun.map((f) => Math.abs(f.y)));
    expect(flatSpanX).toBeGreaterThan(20);
    expect(spunSpanY).toBeGreaterThan(20);
  });

  it('always yields at least one splinter for a tiny piece', () => {
    const out = splinterPlacements('circle', { r: 2 }, { x: 5, y: 6 }, 0, 14);
    expect(out.length).toBeGreaterThanOrEqual(1);
  });
});
