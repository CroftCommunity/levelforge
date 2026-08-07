import { describe, it, expect } from 'vitest';
import {
  emptyLevel,
  loadLevel,
  parseLevel,
  validateLevel,
  migrateToCurrent,
  serializeLevel,
  maxIdNum,
  floorYFor,
  WIDE,
  TALL,
  SchemaError,
  CURRENT_SCHEMA_VERSION,
  BRUSH_DEFAULT,
  Level,
  enforceFloor,
  SLING_POLE_BOTTOM,
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
function baseLevel(
  objects: unknown[] = [],
  meta: Record<string, unknown> = {},
): Record<string, unknown> {
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
      baseObject({
        id: 'o5',
        shape: 'blob',
        w: undefined,
        h: undefined,
        brushR: 20,
        pts: [
          [0, 0],
          [10, 5],
          [20, -5],
        ],
      }),
    ]);
    const out = loadLevel(l);
    expect(out.objects).toHaveLength(5);
    expect(out.objects[4].pts).toEqual([
      [0, 0],
      [10, 5],
      [20, -5],
    ]);
    expect(out.objects[4].brushR).toBe(20);
  });

  it('fills the default brush radius for a blob without one', () => {
    const out = loadLevel(
      baseLevel([baseObject({ shape: 'blob', w: undefined, h: undefined, pts: [[0, 0]] })]),
    );
    expect(out.objects[0].brushR).toBe(BRUSH_DEFAULT);
  });

  it('rejects an empty blob pts array', () => {
    expect(() =>
      loadLevel(baseLevel([baseObject({ shape: 'blob', w: undefined, h: undefined, pts: [] })])),
    ).toThrow(/pts/);
  });
  it('accepts a dense pencil stroke up to 200 points', () => {
    const pts = Array.from({ length: 200 }, (_, i) => [i, 0]);
    const out = loadLevel(
      baseLevel([baseObject({ shape: 'blob', w: undefined, h: undefined, brushR: 3, pts })]),
    );
    expect(out.objects[0].pts).toHaveLength(200);
  });
  it('rejects a blob with too many points', () => {
    const pts = Array.from({ length: 201 }, (_, i) => [i, 0]);
    expect(() =>
      loadLevel(baseLevel([baseObject({ shape: 'blob', w: undefined, h: undefined, pts })])),
    ).toThrow(/too many/);
  });
  it('rejects malformed blob points', () => {
    expect(() =>
      loadLevel(baseLevel([baseObject({ shape: 'blob', w: undefined, h: undefined, pts: [[0]] })])),
    ).toThrow(/\[number, number\]/);
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
  it('leaves meta.bounce unset by default', () => {
    const out = loadLevel(baseLevel([], {}));
    expect(out.meta.bounce).toBeUndefined();
  });
  it('keeps a valid drive-mode bounce value', () => {
    const out = loadLevel(baseLevel([], { mode: 'drive', bounce: 0.4 }));
    expect(out.meta.bounce).toBe(0.4);
  });
  it('clamps an out-of-range bounce into [0,1]', () => {
    expect(loadLevel(baseLevel([], { bounce: 5 })).meta.bounce).toBe(1);
    expect(loadLevel(baseLevel([], { bounce: -2 })).meta.bounce).toBe(0);
  });
  it('ignores a non-numeric bounce', () => {
    expect(loadLevel(baseLevel([], { bounce: 'high' })).meta.bounce).toBeUndefined();
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
    const out = loadLevel(
      baseLevel([], { background: 'custom', backgroundImage: 'data:image/png;base64,AA' }),
    );
    expect(out.meta.background).toBe('custom');
    expect(out.meta.backgroundImage).toContain('data:image');
  });
});

describe('validation — v0.8-forward fields', () => {
  it('accepts group strings', () => {
    const out = loadLevel(
      baseLevel([baseObject({ group: 'shelf' }), baseObject({ id: 'o2', group: 'shelf' })]),
    );
    expect(out.objects[0].group).toBe('shelf');
  });
  it('accepts role only on targets', () => {
    const out = loadLevel(
      baseLevel([
        baseObject({
          id: 'o1',
          shape: 'circle',
          w: undefined,
          h: undefined,
          r: 20,
          material: 'target',
          role: 'protect',
        }),
      ]),
    );
    expect(out.objects[0].role).toBe('protect');
  });
  it('rejects role on non-target material', () => {
    expect(() => loadLevel(baseLevel([baseObject({ role: 'protect' })]))).toThrow(SchemaError);
  });
  it('accepts sprite and hit', () => {
    const out = loadLevel(
      baseLevel([
        baseObject({
          shape: 'emoji',
          w: undefined,
          h: undefined,
          r: 20,
          emoji: '💣',
          sprite: 'boom.png',
          hit: 'explode',
        }),
      ]),
    );
    expect(out.objects[0].sprite).toBe('boom.png');
    expect(out.objects[0].hit).toBe('explode');
  });
  it('accepts a custom color on any shape and preserves it', () => {
    const out = loadLevel(
      baseLevel([
        baseObject({ color: '#4caf50' }),
        baseObject({
          id: 'o2',
          shape: 'blob',
          w: undefined,
          h: undefined,
          pts: [[0, 0]],
          color: '#FF8A3D',
        }),
      ]),
    );
    expect(out.objects[0].color).toBe('#4caf50');
    expect(out.objects[1].color).toBe('#FF8A3D');
  });
  it('rejects a malformed color', () => {
    expect(() => loadLevel(baseLevel([baseObject({ color: 'green' })]))).toThrow(/#rrggbb/);
    expect(() => loadLevel(baseLevel([baseObject({ color: '#12ab' })]))).toThrow(/#rrggbb/);
  });
  it('accepts text on a box and round-trips it', () => {
    const l = loadLevel(baseLevel([baseObject({ text: 'BONK', color: '#123456' })]));
    expect(l.objects[0].text).toBe('BONK');
    expect(parseLevel(serializeLevel(l))).toEqual(l);
  });
  it('rejects text on a non-box shape', () => {
    expect(() =>
      loadLevel(
        baseLevel([
          baseObject({ shape: 'circle', w: undefined, h: undefined, r: 20, text: 'nope' }),
        ]),
      ),
    ).toThrow(/box/);
  });
  it('rejects empty text', () => {
    expect(() => loadLevel(baseLevel([baseObject({ text: '' })]))).toThrow(/non-empty/);
  });
  it('accepts alpha in (0,1] and preserves it', () => {
    const l = loadLevel(
      baseLevel([
        baseObject({ alpha: 0.35 }),
        baseObject({
          id: 'o2',
          shape: 'blob',
          w: undefined,
          h: undefined,
          pts: [[0, 0]],
          alpha: 1,
        }),
      ]),
    );
    expect(l.objects[0].alpha).toBe(0.35);
    expect(l.objects[1].alpha).toBe(1);
    expect(parseLevel(serializeLevel(l))).toEqual(l);
  });
  it('rejects an out-of-range alpha', () => {
    expect(() => loadLevel(baseLevel([baseObject({ alpha: 0 })]))).toThrow(/alpha/);
    expect(() => loadLevel(baseLevel([baseObject({ alpha: 1.4 })]))).toThrow(/alpha/);
  });
  it('accepts fill on a blob and round-trips it', () => {
    const l = loadLevel(
      baseLevel([
        baseObject({
          shape: 'blob',
          w: undefined,
          h: undefined,
          pts: [
            [0, 0],
            [40, 0],
            [40, 40],
          ],
          fill: true,
        }),
      ]),
    );
    expect(l.objects[0].fill).toBe(true);
    expect(parseLevel(serializeLevel(l))).toEqual(l);
  });
  it('rejects fill on a non-blob shape', () => {
    expect(() => loadLevel(baseLevel([baseObject({ fill: true })]))).toThrow(/blob/);
  });
});

describe('validation — rejections', () => {
  it('rejects duplicate ids', () => {
    expect(() =>
      loadLevel(baseLevel([baseObject({ id: 'o1' }), baseObject({ id: 'o1' })])),
    ).toThrow(/Duplicate/);
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
    expect(() =>
      loadLevel(baseLevel([baseObject({ shape: 'emoji', w: undefined, h: undefined, r: 20 })])),
    ).toThrow(/emoji/);
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
      objects: [
        { id: 'o1', shape: 'box', x: 100, y: 100, w: 40, h: 40, angle: 0, material: 'wood' },
      ],
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

describe('validation — v0.8 mode/goal', () => {
  it('defaults mode to slingshot and goal to null', () => {
    const out = loadLevel(baseLevel([]));
    expect(out.meta.mode).toBe('slingshot');
    expect(out.meta.goal).toBeNull();
  });
  it('accepts drive mode with a goal', () => {
    const out = loadLevel(baseLevel([], { mode: 'drive', goal: { x: 100, y: 200, r: 40 } }));
    expect(out.meta.mode).toBe('drive');
    expect(out.meta.goal).toEqual({ x: 100, y: 200, r: 40 });
  });
  it('coerces an unknown mode to slingshot', () => {
    expect(loadLevel(baseLevel([], { mode: 'fly' })).meta.mode).toBe('slingshot');
  });
  it('rejects a goal with non-positive radius', () => {
    expect(() => loadLevel(baseLevel([], { goal: { x: 1, y: 1, r: 0 } }))).toThrow(/goal\.r/);
  });
  it('migrates a 0.7 level to 0.8, filling mode', () => {
    const l = baseLevel([]);
    (l as any).schemaVersion = '0.7';
    const out = validateLevel(migrateToCurrent(l));
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(out.meta.mode).toBe('slingshot');
  });
  it('accepts drop mode', () => {
    expect(loadLevel(baseLevel([], { mode: 'drop' })).meta.mode).toBe('drop');
  });
});

describe('world shape (the level refactor)', () => {
  it('emptyLevel defaults to the wide preset', () => {
    const l = emptyLevel();
    expect(l.world).toEqual({ w: WIDE.w, h: WIDE.h, floorY: floorYFor(WIDE.h) });
  });
  it('emptyLevel("tall") uses the tall preset with a top spawn', () => {
    const l = emptyLevel('tall');
    expect(l.world).toEqual({ w: TALL.w, h: TALL.h, floorY: floorYFor(TALL.h) });
    expect(l.world.floorY).toBe(1560);
    expect(l.slingshot.y).toBeLessThan(l.world.h / 2);
    expect(() => validateLevel(l)).not.toThrow();
  });
  it('accepts and preserves a tall world', () => {
    const out = loadLevel({ ...baseLevel([]), world: { w: 900, h: 1600, floorY: 1560 } });
    expect(out.world).toEqual({ w: 900, h: 1600, floorY: 1560 });
  });
});

describe('role: goal (drop/drive goal zones)', () => {
  it('accepts goal on a non-target material', () => {
    const out = loadLevel(baseLevel([baseObject({ material: 'stone', role: 'goal' })]));
    expect(out.objects[0].role).toBe('goal');
  });
  it('accepts goal on a target too', () => {
    const out = loadLevel(
      baseLevel([
        baseObject({
          id: 'o1',
          shape: 'circle',
          w: undefined,
          h: undefined,
          r: 20,
          material: 'target',
          emoji: undefined,
          role: 'goal',
        }),
      ]),
    );
    expect(out.objects[0].role).toBe('goal');
  });
  it('still rejects destroy/protect on non-target material', () => {
    expect(() =>
      loadLevel(baseLevel([baseObject({ material: 'stone', role: 'protect' })])),
    ).toThrow(/target/);
  });
  it('rejects an unknown role', () => {
    expect(() => loadLevel(baseLevel([baseObject({ role: 'win' })]))).toThrow(/role/);
  });
  it('round-trips the drop fixture unchanged apart from filled defaults', () => {
    const fixture = {
      schemaVersion: '0.8',
      meta: {
        name: 'first-descent',
        scene: 'demo',
        gravity: 1,
        note: '',
        hero: '🙂',
        mode: 'drop',
        background: 'night',
        backgroundImage: null,
      },
      world: { w: 900, h: 1600, floorY: 1560 },
      slingshot: { x: 140, y: 110 },
      objects: [
        {
          id: 'o1',
          shape: 'box',
          x: 260,
          y: 300,
          w: 420,
          h: 22,
          angle: 12,
          material: 'wood',
          anchored: true,
          path: null,
          note: '',
        },
        {
          id: 'o9',
          shape: 'box',
          x: 450,
          y: 1548,
          w: 240,
          h: 24,
          angle: 0,
          material: 'stone',
          anchored: true,
          path: null,
          note: 'catch tray',
          role: 'goal',
        },
      ],
    };
    const out = loadLevel(fixture);
    expect(out.meta.mode).toBe('drop');
    expect(out.objects[1].role).toBe('goal');
    // idempotent
    expect(loadLevel(JSON.parse(JSON.stringify(out)))).toEqual(out);
  });
});

describe('floor healing on load (enforceFloor)', () => {
  it('lifts a buried non-anchored box to rest on the floor line', () => {
    // 40×40 box centred on the floor line: bottom edge 20 below it.
    const out = loadLevel(baseLevel([baseObject({ y: 860 })]));
    expect(out.objects[0].y).toBe(840); // bottom flush at floorY 860
  });
  it('leaves an anchored piece where it was placed (sunken decor is legal)', () => {
    const out = loadLevel(baseLevel([baseObject({ y: 900, anchored: true })]));
    expect(out.objects[0].y).toBe(900);
  });
  it('leaves a piece already above the floor untouched', () => {
    const out = loadLevel(baseLevel([baseObject({ y: 500 })]));
    expect(out.objects[0].y).toBe(500);
  });
  it('uses the rotation-aware bounding box for tilted pieces', () => {
    // 100×20 plank at 90°: its half-extent along y is 50, not 10.
    const out = loadLevel(baseLevel([baseObject({ w: 100, h: 20, angle: 90, y: 860 })]));
    expect(out.objects[0].y).toBeCloseTo(810, 5);
  });
  it('is idempotent — healing a healed level changes nothing', () => {
    const once = loadLevel(baseLevel([baseObject({ y: 860 })]));
    expect(loadLevel(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });
  it('plants a slingshot-mode launcher pole on the floor', () => {
    const lvl = baseLevel([]);
    (lvl.slingshot as { x: number; y: number }).y = 850; // pole base would be 80 under
    const out = loadLevel(lvl);
    expect(out.slingshot.y).toBe(860 - SLING_POLE_BOTTOM);
  });
  it('leaves the drop-mode spawn pad alone', () => {
    const out = loadLevel(baseLevel([], { mode: 'drop' }));
    expect(out.slingshot.y).toBe(770);
  });
  it('enforceFloor is exported for callers that bypass loadLevel (undo/redo)', () => {
    const l = loadLevel(baseLevel([baseObject({ y: 500 })])) as Level;
    l.objects[0].y = 1000;
    enforceFloor(l);
    expect(l.objects[0].y).toBe(840);
  });
});

describe('maxIdNum', () => {
  it('finds the highest numeric id suffix', () => {
    const l = loadLevel(
      baseLevel([baseObject({ id: 'o3' }), baseObject({ id: 'o17' }), baseObject({ id: 'o2' })]),
    ) as Level;
    expect(maxIdNum(l)).toBe(17);
  });
});
