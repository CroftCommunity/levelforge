/* =====================================================================
   play/world.ts — Test mode: the Matter.js world built from a level.

   Physics exists only here (edit mode is a frozen god view). This module
   owns the engine, steps it, applies the break model, melts ice, drives
   pathed movers, runs the hero slingshot, and tracks win/fail (destroy vs
   protect target roles). Blobs build as compound circle bodies; grouped
   pieces weld into one compound. Draws its own content in world space; the
   caller supplies the view transform and backdrop.
   ===================================================================== */

import Matter from 'matter-js';
import { Level, LevelObject, BlobPoint, BRUSH_DEFAULT } from '../schema';
import { MATERIALS, MaterialKey } from '../materials';
import { drawMaterialCtx, drawSlingshotCtx, DEG } from '../editor/render';
import { impactOf, breaksAt } from './break-model';
import { makeMatterBody } from './bodies';
import { behaviorFor, EXPLOSION, EFFECTS, EffectSpec, HitBehavior, EFFECT_BREAK_AT } from './behaviors';
import { fragmentPlacements, splinterPlacements, debrisKindFor, DebrisKind } from './fracture';

const { Engine, Bodies, Body, Composite, Events, Sleeping } = Matter;

const FRAGMENT_LIFE_MS = 2200;
const FRAGMENT_FADE_MS = 700;
const MAX_FRAGMENTS = 24;
/** Per-piece splinter cap so a welded wall doesn't birth hundreds of shards. */
const SPLINTER_MAX = 14;
/** Debris share one non-colliding group: they hit the world and hero, but pass
    through one another — so a break scatters cleanly instead of a jittering pile. */
const DEBRIS_GROUP = Body.nextGroup(true);

const SETTLE_MS = 500;
const MELT_K = 0.9985;
const MELT_MIN = 0.3;
const BALL_R = 22;
const BALL_DENSITY = 0.0016;
const LAUNCH_FACTOR = 0.16;
const PULL_CAP = 200;
const RELOAD_MS = 3800;

export type PlayStatus = 'playing' | 'won' | 'failed';

interface BodyPlugin {
  lvlIds: string[];
  breakAt: number | null;
  isIce: boolean;
  melt: number;
  /** Hit effect fired when this piece is destroyed (pop/explode/…), or null. */
  effect: HitBehavior | null;
  /** The piece's material colour, used for material-tinted effects (shatter). */
  color: string;
  /** Present for a solo blob, so it can shatter into fragments on break. */
  blob?: { pts: BlobPoint[]; brushR: number; material: MaterialKey };
}

/** A single particle thrown by a hit effect. */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  grav: number;
  color: string;
  shape: 'dot' | 'shard' | 'strip' | 'glyph';
  /** The character drawn for a 'glyph' particle (reaction emoji). */
  glyph?: string;
  angle: number;
  spin: number;
  life: number;
  bornT: number;
}

/** A burst drawn at a hit origin: a quick expanding 'ring' outline, or a
    'boom' — a filled fireball plus a shockwave racing out to the blast radius. */
interface Flash {
  x: number;
  y: number;
  color: string;
  bornT: number;
  kind: 'ring' | 'boom';
  rMax: number;
  life: number;
}
const FLASH_MS = 260;
const BOOM_MS = 460;

/** A defeated villain's send-off: the corpse pops up, tumbles, and shrinks away. */
interface Corpse {
  o: LevelObject;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  bornT: number;
}
const DEFEAT_MS = 1000;
const DEFEAT_GLYPHS = ['💫', '⭐', '✨'];

interface Fragment {
  b: Matter.Body;
  material: MaterialKey;
  r: number;
  bornT: number;
  /** How to draw the debris: a tapered 'shard' (wood/ice) or a rounded 'chunk' (stone/blob). */
  kind: DebrisKind;
}

interface Mover {
  b: Matter.Body;
  o: LevelObject;
  len: number;
}

type CollisionHandler = (ev: Matter.IEventCollision<Matter.Engine>) => void;

export class PlaySession {
  private level: Level;
  private engine: Matter.Engine;
  private bodies: Matter.Body[] = [];
  private partOf = new Map<string, Matter.Body>();
  private ownerOf = new Map<string, Matter.Body>();
  private movers: Mover[] = [];
  private broken = new Set<string>();
  private ball: Matter.Body | null = null;
  private ballState: 'loaded' | 'flying' = 'loaded';
  private pull: { x: number; y: number } | null = null;
  private destroyLeft = 0;
  private playT = 0;
  private fragments: Fragment[] = [];
  private particles: Particle[] = [];
  private flashes: Flash[] = [];
  private corpses: Corpse[] = [];
  /** Camera-shake magnitude (world units), kicked by explosions, decays fast. */
  private shakeMag = 0;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private collisionHandler: CollisionHandler | null = null;
  /** A static-geometry mirror used to roll out the aim trajectory. */
  private previewEngine!: Matter.Engine;
  status: PlayStatus = 'playing';

  constructor(level: Level) {
    this.level = level;
    this.engine = Engine.create({ enableSleeping: true });
    this.engine.gravity.y = level.meta.gravity ?? 1;

    const { w: W, h: H, floorY } = level.world;
    Composite.add(this.engine.world, [
      Bodies.rectangle(W / 2, floorY + (H - floorY) / 2 + 40, W + 400, H - floorY + 80, { isStatic: true }),
      Bodies.rectangle(-40, H / 2, 80, H * 3, { isStatic: true }),
      Bodies.rectangle(W + 40, H / 2, 80, H * 3, { isStatic: true }),
    ]);

    this.buildBodies();
    this.buildPreview();
    this.wireCollisions();
    this.loadBall();
  }

  private buildBodies(): void {
    // Group by weld group; blobs are always solo (already compound), and
    // ungrouped pieces are singleton groups.
    const groups = new Map<string, LevelObject[]>();
    let solo = 0;
    for (const o of this.level.objects) {
      const key = o.group && o.shape !== 'blob' ? `weld:${o.group}` : `solo:${solo++}`;
      const arr = groups.get(key);
      if (arr) arr.push(o);
      else groups.set(key, [o]);
    }

    for (const [, members] of groups) {
      let top: Matter.Body;
      if (members.length === 1) {
        top = makeMatterBody(members[0]);
        this.partOf.set(members[0].id, top);
      } else {
        const parts = members.map((o) => {
          const b = makeMatterBody(o);
          Body.setStatic(b, false);
          return b;
        });
        const anyStatic = members.some((o) => o.anchored || o.path);
        top = Body.create({ parts, isStatic: anyStatic });
        members.forEach((o, i) => this.partOf.set(o.id, parts[i]));
      }
      top.plugin = this.pluginFor(members);
      this.registerTop(top, members);
    }
  }

  private pluginFor(members: LevelObject[]): BodyPlugin {
    const numeric = members.map((o) => MATERIALS[o.material].breakAt).filter((v): v is number => v != null);
    let breakAt = numeric.length ? Math.min(...numeric) : null;
    // First member carrying a hit effect owns the group's effect.
    let effect: HitBehavior | null = null;
    for (const o of members) {
      const b = behaviorFor(o);
      if (b) {
        effect = b;
        break;
      }
    }
    // An effect-carrying piece whose material would never break still needs to
    // break so its effect can fire on a solid hit (e.g. a metal 💥 emoji).
    if (breakAt == null && effect) breakAt = EFFECT_BREAK_AT;
    const plugin: BodyPlugin = {
      lvlIds: members.map((o) => o.id),
      breakAt,
      isIce: members.length === 1 && members[0].material === 'ice',
      melt: 1,
      effect,
      color: MATERIALS[members[0].material].color,
    };
    const solo = members.length === 1 ? members[0] : null;
    if (solo && solo.shape === 'blob' && solo.pts && solo.pts.length) {
      plugin.blob = { pts: solo.pts, brushR: solo.brushR ?? BRUSH_DEFAULT, material: solo.material };
    }
    return plugin;
  }

  private registerTop(top: Matter.Body, members: LevelObject[]): void {
    this.bodies.push(top);
    Composite.add(this.engine.world, top);
    for (const o of members) {
      this.ownerOf.set(o.id, top);
      if (o.path) this.movers.push({ b: top, o, len: Math.hypot(o.path.x - o.x, o.path.y - o.y) });
      if (o.material === 'target' && (o.role ?? 'destroy') === 'destroy') this.destroyLeft++;
    }
  }

  private wireCollisions(): void {
    this.collisionHandler = (ev) => {
      if (this.playT < SETTLE_MS) return; // settle grace
      for (const pair of ev.pairs) {
        const a = pair.bodyA;
        const b = pair.bodyB;
        const speed = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
        this.tryBreak(a, b, speed);
        this.tryBreak(b, a, speed);
      }
    };
    Events.on(this.engine, 'collisionStart', this.collisionHandler);
  }

  private topFor(b: Matter.Body): Matter.Body {
    return b.parent && b.parent !== b ? b.parent : b;
  }

  private tryBreak(hit: Matter.Body, other: Matter.Body, speed: number): void {
    const top = this.topFor(hit);
    const p = top.plugin as BodyPlugin | undefined;
    if (!p || p.breakAt == null) return;
    if (p.lvlIds.every((id) => this.broken.has(id))) return;
    const impact = impactOf(speed, this.topFor(other).mass, other.isStatic);
    if (breaksAt(impact, p.breakAt)) this.breakBody(top);
  }

  private breakBody(top: Matter.Body, opts?: { silent?: boolean }): void {
    const p = top.plugin as BodyPlugin;
    if (p.lvlIds.every((id) => this.broken.has(id))) return;
    const at = { x: top.position.x, y: top.position.y };
    const angle = top.angle;
    const vel = { x: top.velocity.x, y: top.velocity.y };
    // Capture each solid, debris-leaving member's own transform before removal so
    // it can shatter in place (welded parts sit at their own offsets, not the
    // centre). `silent` suppresses debris for a melt-out — ice should puddle away,
    // not spray slivers.
    const idSet = new Set(p.lvlIds);
    const shards: Array<{ o: LevelObject; at: { x: number; y: number }; angle: number }> = [];
    const defeats: Array<{ o: LevelObject; at: { x: number; y: number }; angle: number }> = [];
    if (!opts?.silent) {
      for (const o of this.level.objects) {
        if (!idSet.has(o.id)) continue;
        const part = this.partOf.get(o.id);
        if (!part) continue;
        if (o.shape !== 'blob' && debrisKindFor(o.material)) {
          shards.push({ o, at: { x: part.position.x, y: part.position.y }, angle: part.angle });
        }
        // Villains get a visible send-off instead of debris — except a bomb,
        // which vaporises inside its own blast.
        if (o.material === 'target' && behaviorFor(o) !== 'explode') {
          defeats.push({ o, at: { x: part.position.x, y: part.position.y }, angle: part.angle });
        }
      }
    }
    for (const id of p.lvlIds) this.broken.add(id);
    Composite.remove(this.engine.world, top);
    for (const o of this.level.objects) {
      if (!p.lvlIds.includes(o.id) || o.material !== 'target') continue;
      if ((o.role ?? 'destroy') === 'protect') this.status = 'failed';
      else this.destroyLeft--;
    }
    if (this.status !== 'failed' && this.destroyLeft <= 0) this.status = 'won';
    // Ice shrinks as it melts; size its debris to the piece's current scale.
    for (const s of shards) this.shatterSolid(s.o, s.at, s.angle, vel, p.melt);
    for (const d of defeats) this.spawnDefeat(d.o, d.at, d.angle, vel);
    if (p.blob) this.fractureBlob(p.blob, at, angle, vel);
    if (p.effect) this.playEffect(EFFECTS[p.effect], at, p.color, vel);
  }

  /** Give a defeated villain a visible send-off: the corpse pops up, tumbles,
      and shrinks away amid a puff of specks and floating reaction glyphs. */
  private spawnDefeat(o: LevelObject, at: { x: number; y: number }, angle: number, vel: { x: number; y: number }): void {
    const dir = (vel.x || 1) >= 0 ? 1 : -1;
    this.corpses.push({
      o,
      x: at.x,
      y: at.y,
      // carried by the impact, plus a cartoon pop upward and away
      vx: vel.x * 0.45 + dir * (1.2 + Math.random() * 1.8),
      vy: Math.min(0, vel.y * 0.3) - (8.5 + Math.random() * 3.5),
      angle,
      spin: dir * (0.14 + Math.random() * 0.16),
      bornT: this.playT,
    });
    this.flashes.push({ x: at.x, y: at.y, color: '#ffffff', bornT: this.playT, kind: 'ring', rMax: 84, life: FLASH_MS });
    const specks = ['#ffffff', '#ffe9a8', '#ffd0e0'];
    for (let i = 0; i < 12; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 4 * (0.4 + Math.random() * 0.9);
      this.particles.push({
        x: at.x,
        y: at.y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 1.5,
        r: 2 + Math.random() * 3,
        grav: 0.05,
        color: specks[i % specks.length],
        shape: 'dot',
        angle: 0,
        spin: 0,
        life: 600 * (0.7 + Math.random() * 0.5),
        bornT: this.playT,
      });
    }
    for (let i = 0; i < 5; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = 2.5 + Math.random() * 2.5;
      this.particles.push({
        x: at.x,
        y: at.y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        r: 7 + Math.random() * 5,
        grav: 0.02,
        color: '#ffffff',
        shape: 'glyph',
        glyph: DEFEAT_GLYPHS[(Math.random() * DEFEAT_GLYPHS.length) | 0],
        angle: (Math.random() - 0.5) * 0.6,
        spin: (Math.random() - 0.5) * 0.1,
        life: 1100 * (0.8 + Math.random() * 0.4),
        bornT: this.playT,
      });
    }
  }

  /** Throw a burst of particles for a hit effect, and (for explode) shove and
      chain-detonate neighbours. Purely cosmetic aside from the shove/detonate. */
  private playEffect(spec: EffectSpec, at: { x: number; y: number }, matColor: string, vel: { x: number; y: number }): void {
    if (spec.flash) {
      // explosions earn a full fireball + shockwave; other effects a quick ring
      this.flashes.push({
        x: at.x,
        y: at.y,
        color: spec.colors[0] ?? matColor,
        bornT: this.playT,
        kind: spec.shove ? 'boom' : 'ring',
        rMax: spec.shove ? 150 : 80,
        life: spec.shove ? BOOM_MS : FLASH_MS,
      });
    }
    const palette = spec.colors.length ? spec.colors : [matColor];
    for (let i = 0; i < spec.count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = spec.speed * (0.4 + Math.random() * 0.9);
      this.particles.push({
        x: at.x,
        y: at.y,
        // inherit a little of the piece's momentum so bursts feel connected
        vx: Math.cos(ang) * sp + vel.x * 0.25,
        vy: Math.sin(ang) * sp + vel.y * 0.25 - sp * 0.3,
        r: spec.rMin + Math.random() * (spec.rMax - spec.rMin),
        grav: spec.grav,
        color: palette[(Math.random() * palette.length) | 0],
        shape: spec.shape,
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.5,
        life: spec.life * (0.7 + Math.random() * 0.5),
        bornT: this.playT,
      });
    }
    if (spec.shove) {
      // lingering smoke curls that drift up as the fireball fades
      const smokes = ['#8d959e', '#a7afb8', '#6f767e'];
      for (let i = 0; i < 10; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = 1 + Math.random() * 2.5;
        this.particles.push({
          x: at.x + (Math.random() - 0.5) * 40,
          y: at.y + (Math.random() - 0.5) * 40,
          vx: Math.cos(ang) * sp,
          vy: -0.5 - Math.random() * 1.5,
          r: 8 + Math.random() * 10,
          grav: -0.015,
          color: smokes[i % smokes.length],
          shape: 'dot',
          angle: 0,
          spin: 0,
          life: 1500 * (0.7 + Math.random() * 0.6),
          bornT: this.playT,
        });
      }
      this.explodeAt(at.x, at.y);
    }
  }

  /** Shatter a broken blob into scattering fragment bodies. */
  private fractureBlob(blob: { pts: BlobPoint[]; brushR: number; material: MaterialKey }, at: { x: number; y: number }, angle: number, vel: { x: number; y: number }): void {
    const m = MATERIALS[blob.material];
    for (const f of fragmentPlacements(blob.pts, blob.brushR, at, angle, MAX_FRAGMENTS)) {
      const b = Bodies.circle(f.x, f.y, f.r, {
        density: m.density,
        friction: m.friction,
        restitution: Math.min(0.5, m.restitution + 0.15),
        collisionFilter: { group: DEBRIS_GROUP },
      });
      // scatter outward from the centre, plus the parent's momentum and jitter
      const dx = f.x - at.x;
      const dy = f.y - at.y;
      const d = Math.hypot(dx, dy) || 1;
      const spread = 3 + Math.random() * 3;
      Body.setVelocity(b, {
        x: vel.x * 0.5 + (dx / d) * spread + (Math.random() - 0.5) * 3,
        y: vel.y * 0.5 + (dy / d) * spread - Math.random() * 3,
      });
      Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.4);
      Composite.add(this.engine.world, b);
      this.fragments.push({ b, material: blob.material, r: f.r, bornT: this.playT, kind: 'chunk' });
    }
  }

  /** Shatter a broken solid piece (wood/stone/ice) into scattering, tumbling
      debris — shards for wood/ice, rubble chunks for stone. `scale` shrinks the
      footprint to a melted piece's current size. */
  private shatterSolid(o: LevelObject, at: { x: number; y: number }, angle: number, vel: { x: number; y: number }, scale = 1): void {
    const kind = debrisKindFor(o.material);
    if (!kind) return;
    const m = MATERIALS[o.material];
    const shape = o.shape as 'box' | 'circle' | 'tri';
    const dims = {
      w: o.w != null ? o.w * scale : undefined,
      h: o.h != null ? o.h * scale : undefined,
      r: o.r != null ? o.r * scale : undefined,
    };
    for (const f of splinterPlacements(shape, dims, at, angle, SPLINTER_MAX)) {
      const b = Bodies.circle(f.x, f.y, f.r, {
        density: m.density,
        friction: m.friction,
        restitution: Math.min(0.4, m.restitution + 0.1),
        collisionFilter: { group: DEBRIS_GROUP },
      });
      // scatter outward from the piece centre, keeping some of its momentum
      const dx = f.x - at.x;
      const dy = f.y - at.y;
      const d = Math.hypot(dx, dy) || 1;
      const spread = 2 + Math.random() * 2.5;
      Body.setVelocity(b, {
        x: vel.x * 0.6 + (dx / d) * spread + (Math.random() - 0.5) * 2.5,
        y: vel.y * 0.6 + (dy / d) * spread - Math.random() * 2.5,
      });
      Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.6);
      Composite.add(this.engine.world, b);
      this.fragments.push({ b, material: o.material, r: f.r, bornT: this.playT, kind });
    }
  }

  /** Shove nearby bodies and detonate breakable ones within lethal range. */
  private explodeAt(x: number, y: number): void {
    this.shakeMag = Math.min(22, this.shakeMag + 12);
    const detonate: Matter.Body[] = [];
    for (const b of this.bodies) {
      const p = b.plugin as BodyPlugin;
      if (p.lvlIds.every((id) => this.broken.has(id))) continue;
      if (b.isStatic) continue;
      const dx = b.position.x - x;
      const dy = b.position.y - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > EXPLOSION.radius) continue;
      const falloff = 1 - d / EXPLOSION.radius;
      const mag = (EXPLOSION.impulse * falloff) / Math.max(0.2, b.mass);
      Matter.Body.setVelocity(b, { x: b.velocity.x + (dx / d) * mag, y: b.velocity.y + (dy / d) * mag - mag * 0.3 });
      Matter.Sleeping.set(b, false);
      if (d <= EXPLOSION.lethalRadius && p.breakAt != null) detonate.push(b);
    }
    // Chain: detonating these may trigger further explosions (guarded by broken set).
    for (const b of detonate) this.breakBody(b);
  }

  /** Build a static-only mirror (floor, walls, anchored/pathed pieces) so the
      aim preview can roll out a real, collision-aware trajectory. Dynamic
      pieces are omitted — predicting through a shifting pile isn't meaningful. */
  private buildPreview(): void {
    const e = Engine.create({ enableSleeping: false });
    e.gravity.y = this.engine.gravity.y;
    const { w: W, h: H, floorY } = this.level.world;
    Composite.add(e.world, [
      Bodies.rectangle(W / 2, floorY + (H - floorY) / 2 + 40, W + 400, H - floorY + 80, { isStatic: true }),
      Bodies.rectangle(-40, H / 2, 80, H * 3, { isStatic: true }),
      Bodies.rectangle(W + 40, H / 2, 80, H * 3, { isStatic: true }),
    ]);
    for (const o of this.level.objects) {
      if (o.anchored || o.path) Composite.add(e.world, makeMatterBody(o));
    }
    this.previewEngine = e;
  }

  /** Roll a probe from (px,py) at (vx,vy) through the static mirror. */
  private predict(px: number, py: number, vx: number, vy: number): Array<{ x: number; y: number }> {
    const probe = Bodies.circle(px, py, BALL_R, { density: BALL_DENSITY, friction: 0.6, restitution: 0.5 });
    Composite.add(this.previewEngine.world, probe);
    Body.setVelocity(probe, { x: vx, y: vy });
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 60; i++) {
      Engine.update(this.previewEngine, 1000 / 60);
      pts.push({ x: probe.position.x, y: probe.position.y });
      if (probe.position.y > this.level.world.h + 60) break;
      if (probe.position.x < -60 || probe.position.x > this.level.world.w + 60) break;
    }
    Composite.remove(this.previewEngine.world, probe);
    return pts;
  }

  private loadBall(): void {
    this.ball = Bodies.circle(this.level.slingshot.x, this.level.slingshot.y - 30, BALL_R, {
      density: BALL_DENSITY,
      friction: 0.6,
      restitution: 0.5,
    });
    Body.setStatic(this.ball, true);
    Composite.add(this.engine.world, this.ball);
    this.ballState = 'loaded';
    this.pull = null;
  }

  pointerDown(p: { x: number; y: number }): void {
    if (this.ballState === 'loaded' && this.ball) {
      const d = Math.hypot(p.x - this.ball.position.x, p.y - this.ball.position.y);
      if (d <= 140) this.pull = p;
    }
  }
  pointerMove(p: { x: number; y: number }): void {
    if (this.pull) this.pull = p;
  }
  pointerUp(): void {
    if (!this.pull || this.ballState !== 'loaded' || !this.ball) {
      this.pull = null;
      return;
    }
    const ax = this.level.slingshot.x;
    const ay = this.level.slingshot.y - 30;
    const dx = ax - this.pull.x;
    const dy = ay - this.pull.y;
    const d = Math.hypot(dx, dy);
    if (d < 12) {
      this.pull = null;
      return;
    }
    const cap = Math.min(d, PULL_CAP) / d;
    Body.setStatic(this.ball, false);
    Sleeping.set(this.ball, false);
    Body.setVelocity(this.ball, { x: dx * cap * LAUNCH_FACTOR, y: dy * cap * LAUNCH_FACTOR });
    this.ballState = 'flying';
    this.pull = null;
    this.reloadTimer = setTimeout(() => {
      this.loadBall();
    }, RELOAD_MS);
  }

  update(dt: number): void {
    this.playT += dt;
    for (const mv of this.movers) {
      if (mv.len < 2 || !mv.o.path) continue;
      const period = (mv.len * 2) / (mv.o.path.speed || 90);
      const t = (this.playT / 1000) % period;
      const half = period / 2;
      const k = t < half ? t / half : 1 - (t - half) / half;
      const nx = mv.o.x + (mv.o.path.x - mv.o.x) * k;
      const ny = mv.o.y + (mv.o.path.y - mv.o.y) * k;
      const step = dt / 1000 || 1;
      Body.setVelocity(mv.b, { x: (nx - mv.b.position.x) / step, y: (ny - mv.b.position.y) / step });
      Body.setPosition(mv.b, { x: nx, y: ny });
    }
    for (const b of this.bodies) {
      const p = b.plugin as BodyPlugin;
      if (!p.isIce || this.broken.has(p.lvlIds[0])) continue;
      Body.scale(b, MELT_K, MELT_K);
      p.melt *= MELT_K;
      if (p.melt < MELT_MIN) this.breakBody(b, { silent: true });
    }
    Engine.update(this.engine, Math.min(dt, 33));
    // retire spent fragments
    if (this.fragments.length) {
      const alive: Fragment[] = [];
      for (const f of this.fragments) {
        if (this.playT - f.bornT > FRAGMENT_LIFE_MS) Composite.remove(this.engine.world, f.b);
        else alive.push(f);
      }
      this.fragments = alive;
    }
    // advance hit-effect particles (their own light physics, not the engine's)
    if (this.particles.length) {
      const step = Math.min(dt, 33) / 16.67;
      const alive: Particle[] = [];
      for (const pt of this.particles) {
        if (this.playT - pt.bornT > pt.life) continue;
        pt.vy += this.engine.gravity.y * pt.grav * step;
        pt.vx *= 0.985;
        pt.x += pt.vx * step;
        pt.y += pt.vy * step;
        pt.angle += pt.spin * step;
        alive.push(pt);
      }
      this.particles = alive;
    }
    if (this.flashes.length) this.flashes = this.flashes.filter((f) => this.playT - f.bornT <= f.life);
    // defeated villains tumble under light gravity until their moment is over
    if (this.corpses.length) {
      const step = Math.min(dt, 33) / 16.67;
      const alive: Corpse[] = [];
      for (const cse of this.corpses) {
        if (this.playT - cse.bornT > DEFEAT_MS) continue;
        cse.vy += this.engine.gravity.y * 0.45 * step;
        cse.x += cse.vx * step;
        cse.y += cse.vy * step;
        cse.angle += cse.spin * step;
        alive.push(cse);
      }
      this.corpses = alive;
    }
    if (this.shakeMag > 0.01) this.shakeMag *= Math.exp(-dt / 130);
  }

  /** Draw the hit-effect flashes and particles (over the pieces). */
  private renderEffects(ctx: CanvasRenderingContext2D): void {
    for (const fl of this.flashes) {
      const k = (this.playT - fl.bornT) / fl.life;
      if (k < 0 || k > 1) continue;
      ctx.save();
      if (fl.kind === 'boom') {
        const eased = 1 - (1 - k) * (1 - k);
        // shockwave ring racing out to the real blast radius
        ctx.globalAlpha = (1 - k) * 0.45;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 + 16 * (1 - k);
        ctx.beginPath();
        ctx.arc(fl.x, fl.y, 30 + (EXPLOSION.radius - 30) * eased, 0, 7);
        ctx.stroke();
        // fireball: a hot filled core that swells and burns out
        const r = 26 + (fl.rMax - 26) * eased;
        const g = ctx.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.35, '#ffd24a');
        g.addColorStop(0.75, '#ff8a3d');
        g.addColorStop(1, 'rgba(255,90,61,0)');
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(fl.x, fl.y, r, 0, 7);
        ctx.fill();
      } else {
        ctx.globalAlpha = (1 - k) * 0.7;
        ctx.strokeStyle = fl.color;
        ctx.lineWidth = 3 + 5 * (1 - k);
        ctx.beginPath();
        ctx.arc(fl.x, fl.y, 6 + (fl.rMax - 6) * k, 0, 7);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const pt of this.particles) {
      const age = this.playT - pt.bornT;
      const fade = Math.max(0, 1 - age / pt.life);
      ctx.save();
      ctx.globalAlpha = Math.min(1, fade * 1.4);
      ctx.fillStyle = pt.color;
      if (pt.shape === 'dot') {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.r, 0, 7);
        ctx.fill();
      } else if (pt.shape === 'glyph') {
        ctx.translate(pt.x, pt.y);
        ctx.rotate(pt.angle);
        ctx.font = pt.r * 2.4 + 'px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pt.glyph || '💫', 0, 0);
      } else {
        ctx.translate(pt.x, pt.y);
        ctx.rotate(pt.angle);
        if (pt.shape === 'strip') {
          ctx.fillRect(-pt.r, -pt.r * 0.45, pt.r * 2, pt.r * 0.9);
        } else {
          // shard: a small chunky triangle
          ctx.beginPath();
          ctx.moveTo(0, -pt.r);
          ctx.lineTo(pt.r, pt.r);
          ctx.lineTo(-pt.r, pt.r * 0.7);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    if (this.shakeMag > 0.25) {
      ctx.translate(Math.sin(this.playT * 0.12) * this.shakeMag, Math.cos(this.playT * 0.149) * this.shakeMag);
    }
    drawSlingshotCtx(ctx, this.level.slingshot.x, this.level.slingshot.y, false);

    // blob shatter debris (drawn under the pieces)
    for (const f of this.fragments) {
      const age = this.playT - f.bornT;
      const fade = age > FRAGMENT_LIFE_MS - FRAGMENT_FADE_MS ? Math.max(0, (FRAGMENT_LIFE_MS - age) / FRAGMENT_FADE_MS) : 1;
      ctx.save();
      ctx.globalAlpha = fade * (f.material === 'ice' ? 0.82 : 1);
      ctx.fillStyle = MATERIALS[f.material].color;
      ctx.strokeStyle = 'rgba(0,0,0,.3)';
      ctx.lineWidth = 1.5;
      if (f.kind === 'shard') {
        // a tapered, tumbling wood splinter with a hint of grain
        ctx.translate(f.b.position.x, f.b.position.y);
        ctx.rotate(f.b.angle);
        const len = f.r * 2.2;
        const th = f.r * 0.85;
        ctx.beginPath();
        ctx.moveTo(-len / 2, -th / 2);
        ctx.lineTo(len / 2, -th * 0.15);
        ctx.lineTo(len / 2, th * 0.15);
        ctx.lineTo(-len / 2, th / 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-len / 2, 0);
        ctx.lineTo(len / 2, 0);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(f.b.position.x, f.b.position.y, f.r, 0, 7);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    for (const o of this.level.objects) {
      if (this.broken.has(o.id)) continue;
      const part = this.partOf.get(o.id);
      if (!part) continue;
      const melt = (this.ownerOf.get(o.id)!.plugin as BodyPlugin).melt;
      drawMaterialCtx(ctx, { ...o, x: part.position.x, y: part.position.y, angle: part.angle * DEG, note: '' }, false, melt);
    }

    // defeated villains: the corpse swells on the hit, tumbles, and shrinks away
    for (const cse of this.corpses) {
      const k = (this.playT - cse.bornT) / DEFEAT_MS;
      if (k < 0 || k > 1) continue;
      const s = k < 0.45 ? 1 + 0.15 * Math.sin((k / 0.45) * Math.PI) : Math.max(0.02, 1 - (k - 0.45) / 0.55);
      ctx.save();
      ctx.translate(cse.x, cse.y);
      ctx.scale(s, s);
      drawMaterialCtx(ctx, { ...cse.o, x: 0, y: 0, angle: cse.angle * DEG, note: '' }, false);
      ctx.restore();
    }

    // hit-effect bursts, over the pieces
    this.renderEffects(ctx);

    const ax = this.level.slingshot.x;
    const ay = this.level.slingshot.y - 26;
    if (this.ball) {
      let bx = this.ball.position.x;
      let by = this.ball.position.y;
      if (this.pull && this.ballState === 'loaded') {
        const d = Math.hypot(ax - this.pull.x, ay - this.pull.y);
        const cap = Math.min(d, PULL_CAP) / (d || 1);
        bx = ax - (ax - this.pull.x) * cap;
        by = ay - (ay - this.pull.y) * cap;
        Body.setPosition(this.ball, { x: bx, y: by });
        ctx.strokeStyle = '#5a3a22';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(ax - 22, ay);
        ctx.lineTo(bx, by);
        ctx.lineTo(ax + 22, ay);
        ctx.stroke();
        // headless rollout through the static geometry — bounces off ramps/walls
        const traj = this.predict(bx, by, (ax - bx) * LAUNCH_FACTOR, (ay - by) * LAUNCH_FACTOR);
        ctx.fillStyle = 'rgba(255,138,61,.85)';
        for (let i = 0; i < traj.length; i += 2) {
          ctx.globalAlpha = Math.max(0.15, 1 - i / traj.length);
          ctx.beginPath();
          ctx.arc(traj[i].x, traj[i].y, 4, 0, 7);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      // hero: a round body skinned with meta.hero
      drawMaterialCtx(ctx, { shape: 'emoji', x: bx, y: by, r: BALL_R, angle: this.ball.angle * DEG, material: 'rubber', emoji: this.level.meta.hero || '🙂', note: '' }, false);
    }
    ctx.restore();
  }

  /** Villains (destroy-role targets) remaining, for the HUD. */
  get targetsLeft(): number {
    return Math.max(0, this.destroyLeft);
  }

  destroy(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
    if (this.collisionHandler) Events.off(this.engine, 'collisionStart', this.collisionHandler);
    Composite.clear(this.engine.world, false, true);
    Engine.clear(this.engine);
    if (this.previewEngine) {
      Composite.clear(this.previewEngine.world, false, true);
      Engine.clear(this.previewEngine);
    }
  }
}
