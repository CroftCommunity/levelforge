import { describe, it, expect } from 'vitest';
import {
  extents,
  magnetSnap,
  snapN,
  triVerts,
  pointInTri,
  GeomObject,
} from '../src/editor/geometry';

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

describe('snapN', () => {
  it('rounds to the 10-unit grid', () => {
    expect(snapN(0)).toBe(0);
    expect(snapN(14)).toBe(10);
    expect(snapN(15)).toBe(20);
    expect(snapN(-6)).toBe(-10);
  });
});

describe('extents', () => {
  it('gives half-size for axis-aligned boxes', () => {
    expect(extents(box({ w: 40, h: 80, angle: 0 }))).toEqual({ hw: 20, hh: 40 });
  });
  it('swaps axes at 90 degrees', () => {
    expect(extents(box({ w: 40, h: 80, angle: 90 }))).toEqual({ hw: 40, hh: 20 });
    expect(extents(box({ w: 40, h: 80, angle: -90 }))).toEqual({ hw: 40, hh: 20 });
    expect(extents(box({ w: 40, h: 80, angle: 270 }))).toEqual({ hw: 40, hh: 20 });
  });
  it('returns null for off-axis boxes', () => {
    expect(extents(box({ angle: 30 }))).toBeNull();
  });
  it('returns radius for circle and emoji', () => {
    expect(extents({ shape: 'circle', x: 0, y: 0, r: 15 })).toEqual({ hw: 15, hh: 15 });
    expect(extents({ shape: 'emoji', x: 0, y: 0, r: 15 })).toEqual({ hw: 15, hh: 15 });
  });
  it('never snaps triangles', () => {
    expect(extents({ shape: 'tri', x: 0, y: 0, w: 40, h: 40, angle: 0 })).toBeNull();
  });
});

describe('magnetSnap', () => {
  it('snaps a box centre to a neighbour centre within threshold', () => {
    const sel = box({ id: 'o1', x: 103, y: 200, w: 40, h: 40 });
    const other = box({ id: 'o2', x: 100, y: 500, w: 40, h: 40 });
    const res = magnetSnap(sel, [sel, other], { zoom: 1, floorY: 860 });
    expect(res.snappedX).toBe(true);
    expect(res.x).toBe(100);
  });

  it('snaps edge-to-edge so pieces sit flush', () => {
    // other spans x in [80,120]; sel (w40) should snap its centre to 140 (right edge flush)
    const other = box({ id: 'o2', x: 100, y: 300, w: 40, h: 40 });
    const sel = box({ id: 'o1', x: 138, y: 300, w: 40, h: 40 });
    const res = magnetSnap(sel, [sel, other], { zoom: 1, floorY: 860 });
    expect(res.snappedX).toBe(true);
    expect(res.x).toBe(140);
  });

  it('snaps a box bottom to the floor', () => {
    const sel = box({ id: 'o1', x: 500, y: 843, w: 40, h: 40 }); // hh=20 -> floor rest y = 840
    const res = magnetSnap(sel, [sel], { zoom: 1, floorY: 860 });
    expect(res.snappedY).toBe(true);
    expect(res.y).toBe(840);
  });

  it('does nothing beyond the threshold', () => {
    const sel = box({ id: 'o1', x: 400, y: 200 });
    const other = box({ id: 'o2', x: 100, y: 500 });
    const res = magnetSnap(sel, [sel, other], { zoom: 1, floorY: 860 });
    expect(res.snappedX).toBe(false);
    expect(res.snappedY).toBe(false);
    expect(res.x).toBe(400);
  });

  it('tightens threshold as zoom increases', () => {
    // threshold = 14/zoom + 4. At zoom 1 -> 18; at zoom 4 -> 7.5.
    const other = box({ id: 'o2', x: 100, y: 500 });
    const far = () => box({ id: 'o1', x: 112, y: 200 }); // 12 away from centre 100
    expect(magnetSnap(far(), [far(), other], { zoom: 1, floorY: 860 }).snappedX).toBe(true);
    expect(magnetSnap(far(), [far(), other], { zoom: 4, floorY: 860 }).snappedX).toBe(false);
  });

  it('leaves triangles unsnapped', () => {
    const sel: GeomObject = { id: 'o1', shape: 'tri', x: 103, y: 200, w: 40, h: 40, angle: 0 };
    const other = box({ id: 'o2', x: 100, y: 200 });
    const res = magnetSnap(sel, [sel, other], { zoom: 1, floorY: 860 });
    expect(res.snappedX).toBe(false);
    expect(res.x).toBe(103);
  });
});

describe('triVerts + pointInTri', () => {
  it('produces a centroid-centred apex-up wedge', () => {
    const v = triVerts({ w: 90, h: 70 });
    expect(v).toEqual([
      { x: -45, y: 70 / 3 },
      { x: 45, y: 70 / 3 },
      { x: 0, y: (-2 * 70) / 3 },
    ]);
  });
  it('detects inside vs outside', () => {
    const v = triVerts({ w: 90, h: 70 });
    expect(pointInTri(0, 0, v)).toBe(true);
    expect(pointInTri(0, -100, v)).toBe(false);
    expect(pointInTri(100, 0, v)).toBe(false);
  });
});
