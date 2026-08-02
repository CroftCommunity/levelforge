/* =====================================================================
   schema.ts — the LevelForge level format: the single source of truth.

   The product is the schema, not the editor. A human edits it by touch;
   Claude reads and writes it as JSON. Everything here serves that round
   trip, so validation is STRICT (types, ranges, unique ids, known enums)
   with human-readable errors, and migration is FORWARD-ONLY and additive:
   never change the meaning of an existing field — add fields instead, and
   bump the version.

   World space is fixed at 1600 x 900, origin top-left, y down. Positions
   are object centres. Angles are degrees, clockwise positive.
   ===================================================================== */

import { MaterialKey, isMaterialKey } from './materials';

export const CURRENT_SCHEMA_VERSION = '0.4';

/** Fixed world size. Levels carry their own copy but authoring assumes this. */
export const WORLD = { w: 1600, h: 900 } as const;
export const DEFAULT_FLOOR_Y = 860;

export type ShapeKind = 'box' | 'circle' | 'tri' | 'emoji';
/** Target-only. destroy (default) must be broken to win; protect must survive. */
export type Role = 'destroy' | 'protect';

export interface PathDef {
  x: number;
  y: number;
  /** World-units per second along the ping-pong path. */
  speed: number;
}

export interface LevelObject {
  /** "o" + integer, unique within the level. */
  id: string;
  shape: ShapeKind;
  /** Centre position. */
  x: number;
  y: number;
  /** Bounding size for box and tri. */
  w?: number;
  h?: number;
  /** Radius for circle and emoji. */
  r?: number;
  /** Degrees, clockwise positive. */
  angle: number;
  material: MaterialKey;
  /** Static body when true (also true implicitly when path is set). */
  anchored: boolean;
  /** Kinematic ping-pong between (x,y) and (path.x,path.y), or null. */
  path: PathDef | null;
  /** Per-object intent, free text. Rides inside the schema. */
  note: string;
  /** Glyph for emoji shape. */
  emoji?: string;
  /** v0.4: objects sharing a weld id fuse into one compound body in Test. */
  weld?: string;
  /** v0.4: target role. Omitted means "destroy". */
  role?: Role;
}

export interface LevelMeta {
  name: string;
  /** scene = folder = ordered set of levels. */
  scene: string;
  /** Multiplier on the engine's default gravity. */
  gravity: number;
  /** Level-wide intent, free text. */
  note: string;
}

export interface WorldDef {
  w: number;
  h: number;
  floorY: number;
}

export interface Slingshot {
  x: number;
  y: number;
}

export interface Level {
  schemaVersion: string;
  meta: LevelMeta;
  world: WorldDef;
  slingshot: Slingshot;
  objects: LevelObject[];
}

/** Thrown by validateLevel with a human-readable, surfaceable message. */
export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaError';
  }
}

/* --------------------------------------------------------------------- */
/* Construction helpers                                                    */
/* --------------------------------------------------------------------- */

export function emptyLevel(): Level {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: { name: 'untitled', scene: '', gravity: 1, note: '' },
    world: { w: WORLD.w, h: WORLD.h, floorY: DEFAULT_FLOOR_Y },
    slingshot: { x: 230, y: DEFAULT_FLOOR_Y - 90 },
    objects: [],
  };
}

/** Highest numeric id suffix in the level, for seeding the id counter. */
export function maxIdNum(level: Level): number {
  let mx = 0;
  for (const o of level.objects) {
    const n = parseInt(String(o.id).slice(1), 10);
    if (Number.isFinite(n) && n > mx) mx = n;
  }
  return mx;
}

/* --------------------------------------------------------------------- */
/* Migration — forward only, additive, defensive.                         */
/*                                                                         */
/* 0.2 and 0.3 exist in the wild from the prototype. We do not know the    */
/* exact historic 0.2 shape, so each step fills missing fields with        */
/* defaults rather than assuming presence; nothing is ever removed.        */
/* --------------------------------------------------------------------- */

type Loose = Record<string, any>;

function migrate_0_2_to_0_3(l: Loose): Loose {
  // 0.3 introduced tri/emoji shapes and per-object + level notes. Fill the
  // additive fields defensively; leave geometry untouched.
  l.meta = l.meta ?? {};
  if (typeof l.meta.note !== 'string') l.meta.note = '';
  if (Array.isArray(l.objects)) {
    for (const o of l.objects) {
      if (o && typeof o === 'object') {
        if (typeof o.note !== 'string') o.note = '';
        if (!('path' in o)) o.path = null;
        if (!('anchored' in o)) o.anchored = false;
      }
    }
  }
  l.schemaVersion = '0.3';
  return l;
}

function migrate_0_3_to_0_4(l: Loose): Loose {
  // 0.4 added optional weld groups and target role. Both are optional and
  // absence is meaningful ("no weld" / "destroy"), so there is nothing to
  // backfill — only the version bumps.
  l.schemaVersion = '0.4';
  return l;
}

const MIGRATIONS: Record<string, (l: Loose) => Loose> = {
  '0.2': migrate_0_2_to_0_3,
  '0.3': migrate_0_3_to_0_4,
};

/**
 * Bring a loosely-typed, parsed level object up to the current schema
 * version by applying successive migrations. Does not validate — call
 * validateLevel afterwards. Returns a shallow-mutated copy of the input.
 */
export function migrateToCurrent(input: unknown): Loose {
  if (input == null || typeof input !== 'object') {
    throw new SchemaError('Level must be a JSON object.');
  }
  let l: Loose = structuredCloneSafe(input as Loose);
  const start = l.schemaVersion;
  if (typeof start !== 'string') {
    throw new SchemaError('Missing "schemaVersion" — is this a LevelForge level?');
  }
  let guard = 0;
  while (l.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS[l.schemaVersion];
    if (!step) {
      // Unknown or newer-than-current version: stop migrating and let
      // validation decide whether the shape is loadable as-is.
      break;
    }
    l = step(l);
    if (++guard > 16) throw new SchemaError('Migration did not converge.');
  }
  return l;
}

function structuredCloneSafe<T>(v: T): T {
  // structuredClone exists in modern browsers and Node 17+, but fall back to
  // JSON so tests and older runtimes behave identically.
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v));
  }
}

/* --------------------------------------------------------------------- */
/* Validation — strict.                                                    */
/* --------------------------------------------------------------------- */

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function req(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new SchemaError(msg);
}

const ID_RE = /^o\d+$/;
const SHAPES: ShapeKind[] = ['box', 'circle', 'tri', 'emoji'];

function validateObject(o: unknown, index: number, seen: Set<string>): LevelObject {
  const where = `objects[${index}]`;
  req(o != null && typeof o === 'object', `${where} must be an object.`);
  const obj = o as Loose;

  req(typeof obj.id === 'string' && ID_RE.test(obj.id), `${where}.id must match "o<int>" (e.g. "o1").`);
  req(!seen.has(obj.id), `Duplicate object id "${obj.id}".`);
  seen.add(obj.id);

  req(SHAPES.includes(obj.shape), `${where}.shape must be one of ${SHAPES.join(', ')}.`);
  req(isFiniteNum(obj.x) && isFiniteNum(obj.y), `${where} needs finite x and y.`);
  req(isFiniteNum(obj.angle), `${where}.angle must be a finite number.`);
  req(isMaterialKey(obj.material), `${where}.material "${obj.material}" is not a known material.`);
  req(typeof obj.anchored === 'boolean', `${where}.anchored must be a boolean.`);
  req(typeof obj.note === 'string', `${where}.note must be a string.`);

  const shape = obj.shape as ShapeKind;
  if (shape === 'box' || shape === 'tri') {
    req(isFiniteNum(obj.w) && obj.w > 0, `${where} (${shape}) needs positive w.`);
    req(isFiniteNum(obj.h) && obj.h > 0, `${where} (${shape}) needs positive h.`);
  } else {
    req(isFiniteNum(obj.r) && obj.r > 0, `${where} (${shape}) needs positive r.`);
  }
  if (shape === 'emoji') {
    req(typeof obj.emoji === 'string' && [...obj.emoji].length >= 1, `${where} (emoji) needs a non-empty "emoji" glyph.`);
  }

  // path: null or {x,y,speed>0}
  if (obj.path != null) {
    req(typeof obj.path === 'object', `${where}.path must be null or an object.`);
    req(isFiniteNum(obj.path.x) && isFiniteNum(obj.path.y), `${where}.path needs finite x and y.`);
    req(isFiniteNum(obj.path.speed) && obj.path.speed > 0, `${where}.path.speed must be a positive number.`);
  } else {
    obj.path = null;
  }

  // v0.4: weld
  if (obj.weld != null) {
    req(typeof obj.weld === 'string' && obj.weld.length > 0, `${where}.weld must be a non-empty string.`);
  }
  // v0.4: role (targets only)
  if (obj.role != null) {
    req(obj.role === 'destroy' || obj.role === 'protect', `${where}.role must be "destroy" or "protect".`);
    req(obj.material === 'target', `${where}.role is only valid on target material.`);
  }

  // Reconstruct a clean, typed object (drops unknown keys quietly, keeps schema tidy).
  const out: LevelObject = {
    id: obj.id,
    shape,
    x: obj.x,
    y: obj.y,
    angle: obj.angle,
    material: obj.material as MaterialKey,
    anchored: obj.anchored,
    path: obj.path,
    note: obj.note,
  };
  if (shape === 'box' || shape === 'tri') {
    out.w = obj.w;
    out.h = obj.h;
  } else {
    out.r = obj.r;
  }
  if (shape === 'emoji') out.emoji = obj.emoji;
  if (obj.weld != null) out.weld = obj.weld;
  if (obj.role != null) out.role = obj.role;
  return out;
}

/** Strictly validate a (already migrated) level, returning a clean typed copy. */
export function validateLevel(input: unknown): Level {
  req(input != null && typeof input === 'object', 'Level must be a JSON object.');
  const l = input as Loose;

  req(typeof l.schemaVersion === 'string', 'Missing "schemaVersion".');

  const meta = l.meta ?? {};
  req(typeof meta === 'object', 'meta must be an object.');
  const cleanMeta: LevelMeta = {
    name: typeof meta.name === 'string' ? meta.name : 'untitled',
    scene: typeof meta.scene === 'string' ? meta.scene : '',
    gravity: isFiniteNum(meta.gravity) ? meta.gravity : 1,
    note: typeof meta.note === 'string' ? meta.note : '',
  };

  const world = l.world ?? {};
  req(typeof world === 'object', 'world must be an object.');
  const w = isFiniteNum(world.w) ? world.w : WORLD.w;
  const h = isFiniteNum(world.h) ? world.h : WORLD.h;
  req(w > 0 && h > 0, 'world.w and world.h must be positive.');
  const floorY = isFiniteNum(world.floorY) ? world.floorY : DEFAULT_FLOOR_Y;
  req(floorY >= 0 && floorY <= h, 'world.floorY must be within [0, world.h].');

  const sling = l.slingshot ?? {};
  req(typeof sling === 'object', 'slingshot must be an object.');
  req(isFiniteNum(sling.x) && isFiniteNum(sling.y), 'slingshot needs finite x and y.');

  req(Array.isArray(l.objects), 'objects must be an array.');
  const seen = new Set<string>();
  const objects = (l.objects as unknown[]).map((o, i) => validateObject(o, i, seen));

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: cleanMeta,
    world: { w, h, floorY },
    slingshot: { x: sling.x, y: sling.y },
    objects,
  };
}

/**
 * The main entry point for untrusted input (paste-and-load, committed level
 * files, drafts). Migrates then strictly validates. Throws SchemaError with a
 * human-readable message on any problem.
 */
export function loadLevel(input: unknown): Level {
  return validateLevel(migrateToCurrent(input));
}

/** Parse a JSON string and load it. Distinguishes JSON errors from schema errors. */
export function parseLevel(text: string): Level {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SchemaError('Could not parse that JSON.');
  }
  return loadLevel(parsed);
}

/** Pretty-printed JSON, the canonical export form for the schema modal. */
export function serializeLevel(level: Level): string {
  return JSON.stringify(level, null, 2);
}
