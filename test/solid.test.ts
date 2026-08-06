import { describe, it, expect } from 'vitest';
import { worldAABB, separate, SOLID_EPS, GeomObject } from '../src/editor/geometry';

const box = (over: Partial<GeomObject> = {}): GeomObject => ({
  id: 'o1',
  shape: 'box',
  x: 0,
  y: 0,
  w: 40,
  h: 40,
  angle: 0,
  ...over,
});

const world = { worldW: 1600, worldH: 900 };

describe('worldAABB', () => {
  it('boxes the radius for circle and emoji', () => {
    expect(worldAABB({ shape: 'circle', x: 100, y: 50, r: 20 })).toEqual({ minX: 80, maxX: 120, minY: 30, maxY: 70 });
    expect(worldAABB({ shape: 'emoji', x: 0, y: 0, r: 15, emoji: '🎃' } as GeomObject)).toEqual({ minX: -15, maxX: 15, minY: -15, maxY: 15 });
  });

  it('boxes an axis-aligned box to its half-extents', () => {
    expect(worldAABB(box({ x: 0, y: 0, w: 40, h: 80 }))).toEqual({ minX: -20, maxX: 20, minY: -40, maxY: 40 });
  });

  it('grows the box when a box is rotated 45 degrees', () => {
    const b = worldAABB(box({ w: 40, h: 40, angle: 45 }));
    const half = 20 * Math.SQRT2;
    expect(b.maxX).toBeCloseTo(half, 5);
    expect(b.minX).toBeCloseTo(-half, 5);
    expect(b.maxY).toBeCloseTo(half, 5);
  });

  it('captures a triangle apex and base', () => {
    // apex up: top at -2h/3, base at +h/3, spanning ±w/2
    const b = worldAABB({ shape: 'tri', x: 0, y: 0, w: 60, h: 90, angle: 0 });
    expect(b.minX).toBeCloseTo(-30, 5);
    expect(b.maxX).toBeCloseTo(30, 5);
    expect(b.minY).toBeCloseTo(-60, 5); // -2*90/3
    expect(b.maxY).toBeCloseTo(30, 5); // 90/3
  });

  it('expands a blob stroke by its brush radius', () => {
    const b = worldAABB({ shape: 'blob', x: 100, y: 100, brushR: 10, pts: [[0, 0], [20, 0]], angle: 0 } as GeomObject);
    expect(b).toEqual({ minX: 90, maxX: 130, minY: 90, maxY: 110 });
  });
});

describe('separate', () => {
  it('leaves a piece alone when nothing overlaps', () => {
    const sel = box({ id: 'a', x: 0, y: 0 });
    const other = box({ id: 'b', x: 200, y: 0 });
    const r = separate(sel, [sel, other], world);
    expect(r.moved).toBe(false);
    expect(r).toMatchObject({ x: 0, y: 0 });
  });

  it('leaves flush-touching pieces untouched (magnet seams survive)', () => {
    const sel = box({ id: 'a', x: 0, y: 0, w: 40, h: 40 });
    const other = box({ id: 'b', x: 40, y: 0, w: 40, h: 40 }); // edges touch at x=20
    const r = separate(sel, [sel, other], world);
    expect(r.moved).toBe(false);
    expect(r.x).toBe(0);
  });

  it('pushes a piece out along the axis of least penetration (horizontal)', () => {
    const sel = box({ id: 'a', x: 10, y: 0, w: 40, h: 40 });
    const other = box({ id: 'b', x: 0, y: 0, w: 40, h: 40 }); // overlap 30 in x, 40 in y
    const r = separate(sel, [sel, other], world);
    expect(r.moved).toBe(true);
    // least penetration is x (30 < 40): pushed right to a flush seam at x=40
    expect(r.x).toBeCloseTo(40, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('pushes vertically when that is the shallower overlap', () => {
    const sel = box({ id: 'a', x: 0, y: 5, w: 80, h: 40 });
    const other = box({ id: 'b', x: 0, y: 0, w: 80, h: 40 }); // x overlap 80, y overlap 35
    const r = separate(sel, [sel, other], world);
    expect(r.moved).toBe(true);
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(40, 5); // flush below
  });

  it('resolves against two neighbours at once', () => {
    const sel = box({ id: 'a', x: 5, y: 0, w: 40, h: 40 });
    const left = box({ id: 'l', x: -20, y: 0, w: 40, h: 40 });
    const right = box({ id: 'r', x: 60, y: 0, w: 40, h: 40 }); // gap between inner edges is 40, exactly sel's width
    const r = separate(sel, [sel, left, right], world);
    // the only overlap-free centre between them is x=20 (flush both sides)
    expect(r.x).toBeCloseTo(20, 5);
    const a = worldAABB({ ...sel, x: r.x, y: r.y });
    // no interpenetration beyond the flush epsilon with either neighbour
    expect(a.minX).toBeGreaterThanOrEqual(worldAABB(left).maxX - SOLID_EPS);
    expect(a.maxX).toBeLessThanOrEqual(worldAABB(right).minX + SOLID_EPS);
  });

  it('ignores neighbours welded into the same group', () => {
    const sel = box({ id: 'a', x: 10, y: 0, group: 'g1' });
    const mate = box({ id: 'b', x: 0, y: 0, group: 'g1' }); // overlapping but welded
    const r = separate(sel, [sel, mate], world);
    expect(r.moved).toBe(false);
    expect(r.x).toBe(10);
  });

  it('still separates pieces in different groups', () => {
    const sel = box({ id: 'a', x: 10, y: 0, group: 'g1' });
    const other = box({ id: 'b', x: 0, y: 0, group: 'g2' });
    const r = separate(sel, [sel, other], world);
    expect(r.moved).toBe(true);
  });

  it('separates circles by their bounding boxes', () => {
    const sel: GeomObject = { id: 'a', shape: 'circle', x: 10, y: 0, r: 20 };
    const other: GeomObject = { id: 'b', shape: 'circle', x: 0, y: 0, r: 20 };
    const r = separate(sel, [sel, other], world);
    expect(r.moved).toBe(true);
    expect(r.x).toBeCloseTo(40, 5); // flush at the bounding-box seam
  });

  it('keeps the pushed centre inside the world', () => {
    const sel = box({ id: 'a', x: 5, y: 0, w: 40, h: 40 });
    const other = box({ id: 'b', x: 0, y: 0, w: 40, h: 40 });
    const r = separate(sel, [sel, other], { worldW: 30, worldH: 900 });
    expect(r.x).toBeLessThanOrEqual(30);
    expect(r.x).toBeGreaterThanOrEqual(0);
  });
});
