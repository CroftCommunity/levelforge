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
  BRUSH_DEFAULT,
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
function baseLevel(objects: unknown[] = [], meta: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: { name: 'x', scene: '', gravity: 1, note: '', ...meta },
    world: { w: 1600, h: 900, floorY: 860 },
    slingshot: { x: 230, y: 770 },
    objects,
  };
}

describe('emptyLevel', () => {
  it('is valid and current-version with hero + background', () => {
    const l = emptyLevel();
    expect(l.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(l.meta.hero).toBe('🙂');
    expect(l.meta.background).toBe('grid');
    expect(() => validateLevel(l)).not.toThrow();
  });
});

describe('validation — shapes', () => {
  it('accepts each shape with correct geometry', () => {
    const l = baseLevel([
      baseObject({ id: 'o1', shape: 'box', w: 30, h: 80 }),
      baseObject({ id: 'o2', shape: 'tri', w: 90, h: 70 }),
      baseObject({ id: 'o3', shape: 'circle', w: undefined, h: undefined, r: 20 }),
      baseObject({ id: 'o4', shape: 'emoji', w: undefined, h: undefined, r: 20, emoji: '🎃' }),
      baseObject({ id: 'o5', shape: 'blob', w: undefined, h: undefined, brushR: 20, pts: [[0, 0], [10, 5], [20, -5]] }),
    ]);
    const out = loadLevel(l);
    expect(out.objects).toHaveLength(5);
    expect(out.objects[4].pts).toEqual([[0, 0], [10, 5], [20, -5]]);
    expect(out.objects[4].brushR).toBe(20);
  });

  it('fills the default brush radius for a blob without one', () => {
    const out = loadLevel(baseLevel([baseObject({ shape: 'blob', w: undefined, h: undefined, pts: [[0, 0]] })]));
    expect(out.objects[0].brushR).toBe(BRUSH_DEFAULT);
  });

  it('rejects an empty blob pts array', () => {
    expect(() => loadLevel(baseLevel([baseObject({ shape: 'blob', w: undefined, h: undefined, pts: [] })]))).toThrow(/pts/);
  });
  it('rejects a blob with too many points', () => {
    const pts = Array.from({ length: 71 }, (_, i) => [i, 0]);
    expect(() => loadLevel(baseLevel([baseObject({ shape: 'blob', w: undefined, h: undefined, pts })]))).toThrow(/too many/);
  });
  it('rejects malformed blob points', () => {
    expect(() => loadLevel(baseLevel([baseObject({ shape: 'blob', w: undefined, h: undefined, pts: [[0]] })]))).toThrow(/\[number, number\]/);
  });

  it('round-trips through serialize/parse', () => {
    const l = loadLevel(baseLevel([baseObject()]));
    expect(parseLevel(serializeLevel(l))).toEqual(l);
  });
});

describe('validation — meta', () => {
  it('defaults hero, background, backgroundImage', () => {
    const out = loadLevel(baseLevel([]));
    expect(out.meta.hero).toBe('🙂');
    expect(out.meta.background).toBe('grid');
    expect(out.meta.backgroundImage).toBeNull();
  });
  it('keeps a valid background and per-level hero', () => {
    const out = loadLevel(baseLevel([], { hero: '⚽', background: 'cave' }));
    expect(out.meta.hero).toBe('⚽');
    expect(out.meta.background).toBe('cave');
  });
  it('coerces an unknown background to grid', () => {
    const out = loadLevel(baseLevel([], { background: 'lava' }));
    expect(out.meta.background).toBe('grid');
  });
  it('downgrades custom-without-image to grid', () => {
    const out = loadLevel(baseLevel([], { background: 'custom' }));
    expect(out.meta.background).toBe('grid');
  });
  it('keeps custom when an image is present', () => {
    const out = loadLevel(baseLevel([], { background: 'custom', backgroundImage: 'data:image/png;base64,AA' }));
    expect(out.meta.background).toBe('custom');
    expect(out.meta.backgroundImage).toContain('data:image');
  });
});

describe('validation — v0.8-forward fields', () => {
  it('accepts group strings', () => {
    const out = loadLevel(baseLevel([baseObject({ group: 'shelf' }), baseObject({ id: 'o2', group: 'shelf' })]));
    expect(out.objects[0].group).toBe('shelf');
  });
  it('accepts role only on targets', () => {
    const out = loadLevel(baseLevel([baseObject({ id: 'o1', shape: 'circle', w: undefined, h: undefined, r: 20, material: 'target', role: 'protect' })]));
    expect(out.objects[0].role).toBe('protect');
  });
  it('rejects role on non-target material', () => {
    expect(() => loadLevel(baseLevel([baseObject({ role: 'protect' })]))).toThrow(SchemaError);
  });
  it('accepts sprite and hit', () => {
    const out = loadLevel(baseLevel([baseObject({ shape: 'emoji', w: undefined, h: undefined, r: 20, emoji: '💣', sprite: 'boom.png', hit: 'explode' })]));
    expect(out.objects[0].sprite).toBe('boom.png');
    expect(out.objects[0].hit).toBe('explode');
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
  it('rejects emoji without glyph', () => {
    expect(() => loadLevel(baseLevel([baseObject({ shape: 'emoji', w: undefined, h: undefined, r: 20 })]))).toThrow(/emoji/);
  });
  it('rejects floorY out of range', () => {
    const l = baseLevel([]);
    (l.world as any).floorY = 2000;
    expect(() => loadLevel(l)).toThrow(/floorY/);
  });
  it('parseLevel distinguishes JSON errors', () => {
    expect(() => parseLevel('{not json')).toThrow(/parse/);
  });
});

describe('migration', () => {
  it('migrates a 0.2 level, filling v0.7 defaults', () => {
    const old = {
      schemaVersion: '0.2',
      meta: { name: 'old', scene: '', gravity: 1 },
      world: { w: 1600, h: 900, floorY: 860 },
      slingshot: { x: 230, y: 770 },
      objects: [{ id: 'o1', shape: 'box', x: 100, y: 100, w: 40, h: 40, angle: 0, material: 'wood' }],
    };
    const out = validateLevel(migrateToCurrent(old));
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(out.meta.hero).toBe('🙂');
    expect(out.meta.background).toBe('grid');
    expect(out.objects[0].note).toBe('');
    expect(out.objects[0].path).toBeNull();
  });

  it('renames legacy weld to group', () => {
    const l = baseLevel([baseObject({ weld: 'grp' })]);
    (l as any).schemaVersion = '0.4';
    const out = validateLevel(migrateToCurrent(l));
    expect(out.objects[0].group).toBe('grp');
    expect('weld' in out.objects[0]).toBe(false);
  });

  it('brings any known version up to current', () => {
    for (const v of ['0.2', '0.3', '0.4', '0.7']) {
      const l = baseLevel([baseObject()]);
      (l as any).schemaVersion = v;
      expect(migrateToCurrent(l).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    }
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
