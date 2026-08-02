/* =====================================================================
   schema.ts — the Emoji Wars level format: the single source of truth.

   The product is the schema, not the editor. A human edits it by touch;
   Claude reads and writes it as JSON. Validation is STRICT (types, ranges,
   unique ids, known enums) with human-readable errors. Migration is
   FORWARD-ONLY and forgiving: it accepts every prior version (0.2 onward)
   and fills defaults; never break the paste-and-load loop.

   Current schema: v0.7 (matches reference/levelforge.html forge v0.11).
   The optional group/role/sprite/hit/backgroundSrc fields are v0.8-forward:
   accepted and preserved so levels authored against v0.8 round-trip, and so
   the already-shipped weld/protect behavior keeps working.

   World is fixed at 1600 x 900, origin top-left, y down. Positions are
   object centres. Angles are degrees, clockwise positive.
   ===================================================================== */

import { MaterialKey, isMaterialKey } from './materials';

export const CURRENT_SCHEMA_VERSION = '0.8';

export const WORLD = { w: 1600, h: 900 } as const;
export const DEFAULT_FLOOR_Y = 860;
export const DEFAULT_HERO = '🙂';
/** Default blob brush radius, matching the reference BRUSH constant. */
export const BRUSH_DEFAULT = 26;

export type ShapeKind = 'box' | 'circle' | 'tri' | 'emoji' | 'blob';
export type Role = 'destroy' | 'protect';
export type BackgroundKind = 'grid' | 'grass' | 'cave' | 'desert' | 'night' | 'sky' | 'custom';
/** v0.8: the game mode a level plays in. slingshot (default) or drive (Red Ball). */
export type ModeKind = 'slingshot' | 'drive';
export const MODES: ModeKind[] = ['slingshot', 'drive'];

export const BACKGROUNDS: BackgroundKind[] = ['grid', 'grass', 'cave', 'desert', 'night', 'sky', 'custom'];
/** Procedural (non-custom) backgrounds — those that need no image. */
export const PROCEDURAL_BACKGROUNDS: BackgroundKind[] = ['grid', 'grass', 'cave', 'desert', 'night', 'sky'];

export interface PathDef {
  x: number;
  y: number;
  /** World-units per second along the ping-pong path. */
  speed: number;
}

export type BlobPoint = [number, number];

export interface LevelObject {
  /** "o" + integer, unique within the level. */
  id: string;
  shape: ShapeKind;
  x: number;
  y: number;
  /** box & tri. */
  w?: number;
  h?: number;
  /** circle & emoji. */
  r?: number;
  /** Degrees, clockwise positive. */
  angle: number;
  material: MaterialKey;
  anchored: boolean;
  path: PathDef | null;
  note: string;
  /** emoji shape glyph. */
  emoji?: string;
  /** blob: points relative to centre, and brush radius. */
  pts?: BlobPoint[];
  brushR?: number;
  /** v0.8-forward: weld-group key (objects sharing it fuse in Test). */
  group?: string;
  /** v0.8-forward: target role. Omitted means "destroy". */
  role?: Role;
  /** v0.8-forward: custom emoji sprite filename. */
  sprite?: string;
  /** v0.8-forward: per-emoji hit behavior key. */
  hit?: string;
}

export interface LevelMeta {
  name: string;
  scene: string;
  gravity: number;
  note: string;
  hero: string;
  background: BackgroundKind;
  /** Prototype inline dataURL for a custom backdrop, or null. */
  backgroundImage: string | null;
  /** v0.8: backdrop image filename in the level folder. */
  backgroundSrc?: string | null;
  /** v0.8: game mode. */
  mode: ModeKind;
  /** v0.8: drive-mode goal zone, or null. */
  goal: GoalDef | null;
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

/** v0.8: drive-mode goal zone — reach it to clear the level. */
export interface GoalDef {
  x: number;
  y: number;
  r: number;
}

export interface Level {
  schemaVersion: string;
  meta: LevelMeta;
  world: WorldDef;
  slingshot: Slingshot;
  objects: LevelObject[];
}

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
    meta: {
      name: 'untitled',
      scene: '',
      gravity: 1,
      note: '',
      hero: DEFAULT_HERO,
      background: 'grid',
      backgroundImage: null,
      mode: 'slingshot',
      goal: null,
    },
    world: { w: WORLD.w, h: WORLD.h, floorY: DEFAULT_FLOOR_Y },
    slingshot: { x: 230, y: DEFAULT_FLOOR_Y - 90 },
    objects: [],
  };
}

export function maxIdNum(level: Level): number {
  let mx = 0;
  for (const o of level.objects) {
    const n = parseInt(String(o.id).slice(1), 10);
    if (Number.isFinite(n) && n > mx) mx = n;
  }
  return mx;
}

/* --------------------------------------------------------------------- */
/* Migration — forward only, forgiving.                                    */
/*                                                                         */
/* Structural steps we know (0.2->0.3->0.4) run first; then a final        */
/* normalize pass fills every current-version default and renames the      */
/* legacy `weld` key to `group`. Any unknown/newer version falls through   */
/* to normalize, so the paste-and-load loop never breaks.                  */
/* --------------------------------------------------------------------- */

type Loose = Record<string, any>;

function migrate_0_2_to_0_3(l: Loose): Loose {
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
  l.schemaVersion = '0.4';
  return l;
}

const MIGRATIONS: Record<string, (l: Loose) => Loose> = {
  '0.2': migrate_0_2_to_0_3,
  '0.3': migrate_0_3_to_0_4,
};

/** Fill all current-version defaults and normalize legacy shapes. */
function normalizeToCurrent(l: Loose): Loose {
  l.meta = l.meta ?? {};
  if (typeof l.meta.hero !== 'string' || !l.meta.hero) l.meta.hero = DEFAULT_HERO;
  if (typeof l.meta.background !== 'string') l.meta.background = 'grid';
  if (l.meta.backgroundImage === undefined) l.meta.backgroundImage = null;
  // custom background without an image is meaningless — fall back to grid
  if (l.meta.background === 'custom' && !l.meta.backgroundImage && !l.meta.backgroundSrc) {
    l.meta.background = 'grid';
  }
  if (l.meta.mode !== 'drive') l.meta.mode = 'slingshot';
  if (l.meta.goal === undefined) l.meta.goal = null;
  if (Array.isArray(l.objects)) {
    for (const o of l.objects) {
      if (!o || typeof o !== 'object') continue;
      if (typeof o.note !== 'string') o.note = '';
      if (!('path' in o)) o.path = null;
      if (!('anchored' in o)) o.anchored = false;
      if (!('angle' in o)) o.angle = 0;
      // legacy weld -> group (v0.4 -> v0.8 naming)
      if (o.weld != null && o.group == null) o.group = o.weld;
      delete o.weld;
      if (o.shape === 'blob' && o.brushR == null) o.brushR = BRUSH_DEFAULT;
    }
  }
  l.schemaVersion = CURRENT_SCHEMA_VERSION;
  return l;
}

export function migrateToCurrent(input: unknown): Loose {
  if (input == null || typeof input !== 'object') {
    throw new SchemaError('Level must be a JSON object.');
  }
  let l: Loose = structuredCloneSafe(input as Loose);
  if (typeof l.schemaVersion !== 'string') {
    throw new SchemaError('Missing "schemaVersion" — is this an Emoji Wars level?');
  }
  let guard = 0;
  while (l.schemaVersion !== CURRENT_SCHEMA_VERSION && MIGRATIONS[l.schemaVersion]) {
    l = MIGRATIONS[l.schemaVersion](l);
    if (++guard > 16) throw new SchemaError('Migration did not converge.');
  }
  return normalizeToCurrent(l);
}

function structuredCloneSafe<T>(v: T): T {
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
const SHAPES: ShapeKind[] = ['box', 'circle', 'tri', 'emoji', 'blob'];
const MAX_BLOB_PTS = 70;

function validateBlobPts(v: unknown, where: string): BlobPoint[] {
  req(Array.isArray(v) && v.length >= 1, `${where} (blob) needs a non-empty "pts" array.`);
  req(v.length <= MAX_BLOB_PTS, `${where} (blob) has too many points (max ${MAX_BLOB_PTS}).`);
  return (v as unknown[]).map((p, i) => {
    req(Array.isArray(p) && p.length === 2 && isFiniteNum(p[0]) && isFiniteNum(p[1]), `${where}.pts[${i}] must be [number, number].`);
    return [p[0] as number, p[1] as number];
  });
}

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
  const out: LevelObject = {
    id: obj.id,
    shape,
    x: obj.x,
    y: obj.y,
    angle: obj.angle,
    material: obj.material as MaterialKey,
    anchored: obj.anchored,
    path: null,
    note: obj.note,
  };

  if (shape === 'box' || shape === 'tri') {
    req(isFiniteNum(obj.w) && obj.w > 0, `${where} (${shape}) needs positive w.`);
    req(isFiniteNum(obj.h) && obj.h > 0, `${where} (${shape}) needs positive h.`);
    out.w = obj.w;
    out.h = obj.h;
  } else if (shape === 'blob') {
    out.pts = validateBlobPts(obj.pts, where);
    const br = obj.brushR ?? BRUSH_DEFAULT;
    req(isFiniteNum(br) && br > 0, `${where} (blob) brushR must be positive.`);
    out.brushR = br;
  } else {
    req(isFiniteNum(obj.r) && obj.r > 0, `${where} (${shape}) needs positive r.`);
    out.r = obj.r;
  }
  if (shape === 'emoji') {
    req(typeof obj.emoji === 'string' && [...obj.emoji].length >= 1, `${where} (emoji) needs a non-empty "emoji" glyph.`);
    out.emoji = obj.emoji;
  }

  if (obj.path != null) {
    req(typeof obj.path === 'object', `${where}.path must be null or an object.`);
    req(isFiniteNum(obj.path.x) && isFiniteNum(obj.path.y), `${where}.path needs finite x and y.`);
    req(isFiniteNum(obj.path.speed) && obj.path.speed > 0, `${where}.path.speed must be a positive number.`);
    out.path = { x: obj.path.x, y: obj.path.y, speed: obj.path.speed };
  }

  // v0.8-forward optional fields
  if (obj.group != null) {
    req(typeof obj.group === 'string' && obj.group.length > 0, `${where}.group must be a non-empty string.`);
    out.group = obj.group;
  }
  if (obj.role != null) {
    req(obj.role === 'destroy' || obj.role === 'protect', `${where}.role must be "destroy" or "protect".`);
    req(obj.material === 'target', `${where}.role is only valid on target material.`);
    out.role = obj.role;
  }
  if (obj.sprite != null) {
    req(typeof obj.sprite === 'string' && obj.sprite.length > 0, `${where}.sprite must be a non-empty string.`);
    out.sprite = obj.sprite;
  }
  if (obj.hit != null) {
    req(typeof obj.hit === 'string' && obj.hit.length > 0, `${where}.hit must be a non-empty string.`);
    out.hit = obj.hit;
  }
  return out;
}

export function validateLevel(input: unknown): Level {
  req(input != null && typeof input === 'object', 'Level must be a JSON object.');
  const l = input as Loose;
  req(typeof l.schemaVersion === 'string', 'Missing "schemaVersion".');

  const meta = l.meta ?? {};
  req(typeof meta === 'object', 'meta must be an object.');
  const background = BACKGROUNDS.includes(meta.background) ? (meta.background as BackgroundKind) : 'grid';
  const mode: ModeKind = meta.mode === 'drive' ? 'drive' : 'slingshot';
  let goal: GoalDef | null = null;
  if (meta.goal != null) {
    req(typeof meta.goal === 'object', 'meta.goal must be null or an object.');
    req(isFiniteNum(meta.goal.x) && isFiniteNum(meta.goal.y), 'meta.goal needs finite x and y.');
    req(isFiniteNum(meta.goal.r) && meta.goal.r > 0, 'meta.goal.r must be positive.');
    goal = { x: meta.goal.x, y: meta.goal.y, r: meta.goal.r };
  }
  const cleanMeta: LevelMeta = {
    name: typeof meta.name === 'string' ? meta.name : 'untitled',
    scene: typeof meta.scene === 'string' ? meta.scene : '',
    gravity: isFiniteNum(meta.gravity) ? meta.gravity : 1,
    note: typeof meta.note === 'string' ? meta.note : '',
    hero: typeof meta.hero === 'string' && meta.hero ? meta.hero : DEFAULT_HERO,
    background,
    backgroundImage: typeof meta.backgroundImage === 'string' ? meta.backgroundImage : null,
    mode,
    goal,
  };
  if (typeof meta.backgroundSrc === 'string' && meta.backgroundSrc) cleanMeta.backgroundSrc = meta.backgroundSrc;

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

/** Main entry for untrusted input: migrate then strictly validate. */
export function loadLevel(input: unknown): Level {
  return validateLevel(migrateToCurrent(input));
}

export function parseLevel(text: string): Level {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SchemaError('Could not parse that JSON.');
  }
  return loadLevel(parsed);
}

export function serializeLevel(level: Level): string {
  return JSON.stringify(level, null, 2);
}
