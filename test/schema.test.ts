import { describe, it, expect } from 'vitest';
import {
  emptyLevel,
  loadLevel,
  parseLevel,
  validateLevel,
  migrateToCurrent,
  serializeLevel,
  maxIdNum,
  SchemaError,
  CURRENT_SCHEMA_VERSION,
  Level,
} from '../src/schema';

function baseObject(over: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    shape: 'box',
    x: 100,
    y: 100,
    w: 40,
    h: 40,
    angle: 0,
    material: 'wood',
    anchored: false,
    path: null,
    note: '',
    ...over,
  };
}
function baseLevel(objects: unknown[] = []): Record<string, unknown> {
  return {
    schemaVersion: '0.4',
    meta: { name: 'x', scene: '', gravity: 1, note: '' },
    world: { w: 1600, h: 900, floorY: 860 },
    slingshot: { x: 230, y: 770 },
    objects,
  };
}

describe('emptyLevel', () => {
  it('is valid and current-version', () => {
    const l = emptyLevel();
    expect(l.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(() => validateLevel(l)).not.toThrow();
  });
});

describe('validation — happy paths', () => {
  it('accepts each shape with correct geometry', () => {
    const l = baseLevel([
      baseObject({ id: 'o1', shape: 'box', w: 30, h: 80 }),
      baseObject({ id: 'o2', shape: 'tri', w: 90, h: 70 }),
      baseObject({ id: 'o3', shape: 'circle', w: undefined, h: undefined, r: 20 }),
      baseObject({ id: 'o4', shape: 'emoji', w: undefined, h: undefined, r: 20, emoji: '🎃' }),
    ]);
    const out = loadLevel(l);
    expect(out.objects).toHaveLength(4);
    expect(out.objects[2].r).toBe(20);
    expect(out.objects[3].emoji).toBe('🎃');
  });

  it('round-trips through serialize/parse', () => {
    const l = loadLevel(baseLevel([baseObject()]));
    const again = parseLevel(serializeLevel(l));
    expect(again).toEqual(l);
  });

  it('keeps a valid path and drops unknown keys', () => {
    const out = loadLevel(baseLevel([baseObject({ path: { x: 300, y: 100, speed: 90 }, bogus: 1 })]));
    expect(out.objects[0].path).toEqual({ x: 300, y: 100, speed: 90 });
    expect('bogus' in out.objects[0]).toBe(false);
  });
});

describe('validation — v0.4 additions', () => {
  it('accepts weld strings', () => {
    const out = loadLevel(baseLevel([baseObject({ weld: 'groupA' }), baseObject({ id: 'o2', weld: 'groupA' })]));
    expect(out.objects[0].weld).toBe('groupA');
  });
  it('accepts role only on targets', () => {
    const out = loadLevel(baseLevel([baseObject({ id: 'o1', shape: 'circle', w: undefined, h: undefined, r: 20, material: 'target', role: 'protect' })]));
    expect(out.objects[0].role).toBe('protect');
  });
  it('rejects role on non-target material', () => {
    expect(() => loadLevel(baseLevel([baseObject({ role: 'protect' })]))).toThrow(SchemaError);
  });
  it('rejects unknown role value', () => {
    expect(() =>
      loadLevel(baseLevel([baseObject({ shape: 'circle', w: undefined, h: undefined, r: 20, material: 'target', role: 'guard' })])),
    ).toThrow(SchemaError);
  });
});

describe('validation — rejections', () => {
  it('rejects duplicate ids', () => {
    expect(() => loadLevel(baseLevel([baseObject({ id: 'o1' }), baseObject({ id: 'o1' })]))).toThrow(/Duplicate/);
  });
  it('rejects bad id format', () => {
    expect(() => loadLevel(baseLevel([baseObject({ id: 'x1' })]))).toThrow(/o<int>/);
  });
  it('rejects unknown material', () => {
    expect(() => loadLevel(baseLevel([baseObject({ material: 'plutonium' })]))).toThrow(/material/);
  });
  it('rejects unknown shape', () => {
    expect(() => loadLevel(baseLevel([baseObject({ shape: 'hexagon' })]))).toThrow(/shape/);
  });
  it('rejects non-positive box dimensions', () => {
    expect(() => loadLevel(baseLevel([baseObject({ w: 0 })]))).toThrow(/positive w/);
  });
  it('rejects circle without radius', () => {
    expect(() => loadLevel(baseLevel([baseObject({ shape: 'circle', w: undefined, h: undefined })]))).toThrow(/positive r/);
  });
  it('rejects emoji without glyph', () => {
    expect(() => loadLevel(baseLevel([baseObject({ shape: 'emoji', w: undefined, h: undefined, r: 20 })]))).toThrow(/emoji/);
  });
  it('rejects non-finite positions', () => {
    expect(() => loadLevel(baseLevel([baseObject({ x: Infinity })]))).toThrow(/finite/);
  });
  it('rejects a path with non-positive speed', () => {
    expect(() => loadLevel(baseLevel([baseObject({ path: { x: 1, y: 1, speed: 0 } })]))).toThrow(/speed/);
  });
  it('rejects floorY out of range', () => {
    const l = baseLevel([]);
    (l.world as any).floorY = 2000;
    expect(() => loadLevel(l)).toThrow(/floorY/);
  });
  it('rejects missing schemaVersion', () => {
    const l = baseLevel([]);
    delete (l as any).schemaVersion;
    expect(() => loadLevel(l)).toThrow(/schemaVersion/);
  });
  it('parseLevel distinguishes JSON errors', () => {
    expect(() => parseLevel('{not json')).toThrow(/parse/);
  });
});

describe('migration', () => {
  it('migrates 0.2 to current, filling additive defaults', () => {
    const old = {
      schemaVersion: '0.2',
      meta: { name: 'old', scene: '', gravity: 1 },
      world: { w: 1600, h: 900, floorY: 860 },
      slingshot: { x: 230, y: 770 },
      objects: [{ id: 'o1', shape: 'box', x: 100, y: 100, w: 40, h: 40, angle: 0, material: 'wood' }],
    };
    const migrated = migrateToCurrent(old);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const out = validateLevel(migrated);
    expect(out.objects[0].note).toBe('');
    expect(out.objects[0].path).toBeNull();
    expect(out.objects[0].anchored).toBe(false);
    expect(out.meta.note).toBe('');
  });

  it('migrates 0.3 to 0.4 with only a version bump', () => {
    const l = baseLevel([baseObject()]);
    (l as any).schemaVersion = '0.3';
    const migrated = migrateToCurrent(l);
    expect(migrated.schemaVersion).toBe('0.4');
  });

  it('does not mutate the input object', () => {
    const l = baseLevel([baseObject()]);
    (l as any).schemaVersion = '0.2';
    const before = JSON.stringify(l);
    migrateToCurrent(l);
    expect(JSON.stringify(l)).toBe(before);
  });

  it('throws on a non-object', () => {
    expect(() => migrateToCurrent(42)).toThrow(SchemaError);
  });
});

describe('maxIdNum', () => {
  it('finds the highest numeric id suffix', () => {
    const l = loadLevel(baseLevel([baseObject({ id: 'o3' }), baseObject({ id: 'o17' }), baseObject({ id: 'o2' })])) as Level;
    expect(maxIdNum(l)).toBe(17);
  });
});
