/* =====================================================================
   play/behaviors.ts — per-emoji hit effects (M4+).

   The schema stores only a key (object.hit); the registry lives in code.
   An effect is resolved from object.hit, else inferred from the emoji glyph.
   Every effect fires the moment the piece is destroyed in Test — a burst of
   particles (owned by play/world.ts) plus, for "explode", a shove-and-chain
   detonation. The set: pop, explode, shatter (break apart), splash, confetti.
   ===================================================================== */

import { LevelObject } from '../schema';

export type HitBehavior = 'pop' | 'explode' | 'shatter' | 'splash' | 'confetti';

/** All effect keys, in menu order. */
export const HIT_BEHAVIORS: HitBehavior[] = ['pop', 'explode', 'shatter', 'splash', 'confetti'];

/** How an effect draws and behaves. Consumed by play/world.ts (particle burst)
    and by the editor's effect picker (icon/label/blurb). */
export interface EffectSpec {
  key: HitBehavior;
  /** Menu / chip glyph. */
  icon: string;
  /** Short menu label. */
  label: string;
  /** One-line explanation shown in the picker and the help page. */
  blurb: string;
  /** Number of particles thrown. */
  count: number;
  /** Base outward speed (world units/tick). */
  speed: number;
  /** Per-particle gravity multiplier (0 = floaty, 1 = falls fast). */
  grav: number;
  /** Particle radius range. */
  rMin: number;
  rMax: number;
  /** Particle lifetime (ms). */
  life: number;
  /** Fixed colours; if empty the piece's material colour is used. */
  colors: string[];
  /** Draw a quick expanding ring at the burst origin. */
  flash: boolean;
  /** Particle draw style. */
  shape: 'dot' | 'shard' | 'strip';
  /** Shove nearby dynamic bodies away from the burst (explode). */
  shove: boolean;
  /** Detonate breakable neighbours within lethal range (explode chains). */
  detonate: boolean;
}

const RAINBOW = ['#ff5a5a', '#ffd24a', '#7bc86c', '#5aa2e6', '#b98cff', '#ff8fd0'];

/** The effect table. Order matches HIT_BEHAVIORS. */
export const EFFECTS: Record<HitBehavior, EffectSpec> = {
  pop: {
    key: 'pop',
    icon: '🫧',
    label: 'pop',
    blurb: 'vanishes in a quick bubble-pop puff of light specks.',
    count: 16,
    speed: 4.2,
    grav: 0.04,
    rMin: 2,
    rMax: 5,
    life: 620,
    colors: ['#ffffff', '#ffe9a8', '#ffd0e0', '#bfe6ff'],
    flash: true,
    shape: 'dot',
    shove: false,
    detonate: false,
  },
  explode: {
    key: 'explode',
    icon: '💥',
    label: 'explode',
    blurb: 'a blast that shoves nearby pieces and detonates breakable neighbours — chain reactions emerge. 💣 / 🧨 use this by default.',
    count: 24,
    speed: 7.5,
    grav: 0.14,
    rMin: 2,
    rMax: 6,
    life: 900,
    colors: ['#ffffff', '#ffd24a', '#ff8a3d', '#ff5a3d'],
    flash: true,
    shape: 'dot',
    shove: true,
    detonate: true,
  },
  shatter: {
    key: 'shatter',
    icon: '🧩',
    label: 'break apart',
    blurb: 'breaks apart into tumbling shards (in its own material colour) that fall and fade.',
    count: 18,
    speed: 5.5,
    grav: 0.42,
    rMin: 3,
    rMax: 8,
    life: 1400,
    colors: [],
    flash: false,
    shape: 'shard',
    shove: false,
    detonate: false,
  },
  splash: {
    key: 'splash',
    icon: '💧',
    label: 'splash',
    blurb: 'bursts into a splash of droplets that arc up and rain down.',
    count: 22,
    speed: 5.2,
    grav: 0.5,
    rMin: 2,
    rMax: 6,
    life: 1000,
    colors: ['#5aa2e6', '#9fd6ea', '#cfeeff', '#ffffff'],
    flash: false,
    shape: 'dot',
    shove: false,
    detonate: false,
  },
  confetti: {
    key: 'confetti',
    icon: '🎉',
    label: 'confetti',
    blurb: 'erupts into a shower of colourful confetti strips that flutter down.',
    count: 28,
    speed: 6.5,
    grav: 0.28,
    rMin: 3,
    rMax: 7,
    life: 1500,
    colors: RAINBOW,
    flash: false,
    shape: 'strip',
    shove: false,
    detonate: false,
  },
};

/** Default emoji -> effect mapping (overridden by an explicit object.hit). */
const EMOJI_HIT: Record<string, HitBehavior> = {
  '💣': 'explode',
  '🧨': 'explode',
};

function isHitBehavior(v: string): v is HitBehavior {
  return Object.prototype.hasOwnProperty.call(EFFECTS, v);
}

export function behaviorFor(o: LevelObject): HitBehavior | null {
  if (o.hit) return isHitBehavior(o.hit) ? o.hit : null; // unknown key -> no effect
  if (o.shape === 'emoji' && o.emoji && EMOJI_HIT[o.emoji]) return EMOJI_HIT[o.emoji];
  return null;
}

/** Explosion tuning (shove + chain detonation for the "explode" effect). */
export const EXPLOSION = {
  /** Bodies within this radius get shoved. */
  radius: 220,
  /** Breakable bodies within this radius are detonated directly. */
  lethalRadius: 120,
  /** Impulse strength (added to velocity, scaled by falloff and 1/mass). */
  impulse: 46,
};

/** Impact threshold given to an effect-carrying emoji that its material would
    otherwise never break at (e.g. metal). Lets the effect fire on a solid hit
    without changing the physics of ordinary, effect-free pieces. */
export const EFFECT_BREAK_AT = 6;
