import { describe, it, expect } from 'vitest';
import { fragmentPlacements } from '../src/play/fracture';
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
