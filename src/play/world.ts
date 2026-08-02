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
import { behaviorFor, EXPLOSION } from './behaviors';
import { fragmentPlacements } from './fracture';

const { Engine, Bodies, Body, Composite, Events, Sleeping } = Matter;

const FRAGMENT_LIFE_MS = 2200;
const FRAGMENT_FADE_MS = 700;
const MAX_FRAGMENTS = 24;

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
  /** Detonates nearby bodies when this one breaks (e.g. 💣). */
  explode: boolean;
  /** Present for a solo blob, so it can shatter into fragments on break. */
  blob?: { pts: BlobPoint[]; brushR: number; material: MaterialKey };
}

interface Fragment {
  b: Matter.Body;
  material: MaterialKey;
  r: number;
  bornT: number;
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
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private collisionHandler: CollisionHandler | null = null;
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
    const breakAt = numeric.length ? Math.min(...numeric) : null;
    const plugin: BodyPlugin = {
      lvlIds: members.map((o) => o.id),
      breakAt,
      isIce: members.length === 1 && members[0].material === 'ice',
      melt: 1,
      explode: members.some((o) => behaviorFor(o) === 'explode'),
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

  private breakBody(top: Matter.Body): void {
    const p = top.plugin as BodyPlugin;
    if (p.lvlIds.every((id) => this.broken.has(id))) return;
    const at = { x: top.position.x, y: top.position.y };
    const angle = top.angle;
    const vel = { x: top.velocity.x, y: top.velocity.y };
    for (const id of p.lvlIds) this.broken.add(id);
    Composite.remove(this.engine.world, top);
    for (const o of this.level.objects) {
      if (!p.lvlIds.includes(o.id) || o.material !== 'target') continue;
      if ((o.role ?? 'destroy') === 'protect') this.status = 'failed';
      else this.destroyLeft--;
    }
    if (this.status !== 'failed' && this.destroyLeft <= 0) this.status = 'won';
    if (p.blob) this.fractureBlob(p.blob, at, angle, vel);
    if (p.explode) this.explodeAt(at.x, at.y);
  }

  /** Shatter a broken blob into scattering fragment bodies. */
  private fractureBlob(blob: { pts: BlobPoint[]; brushR: number; material: MaterialKey }, at: { x: number; y: number }, angle: number, vel: { x: number; y: number }): void {
    const m = MATERIALS[blob.material];
    for (const f of fragmentPlacements(blob.pts, blob.brushR, at, angle, MAX_FRAGMENTS)) {
      const b = Bodies.circle(f.x, f.y, f.r, { density: m.density, friction: m.friction, restitution: Math.min(0.5, m.restitution + 0.15) });
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
      this.fragments.push({ b, material: blob.material, r: f.r, bornT: this.playT });
    }
  }

  /** Shove nearby bodies and detonate breakable ones within lethal range. */
  private explodeAt(x: number, y: number): void {
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
      if (p.melt < MELT_MIN) this.breakBody(b);
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
  }

  render(ctx: CanvasRenderingContext2D): void {
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
      ctx.beginPath();
      ctx.arc(f.b.position.x, f.b.position.y, f.r, 0, 7);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    for (const o of this.level.objects) {
      if (this.broken.has(o.id)) continue;
      const part = this.partOf.get(o.id);
      if (!part) continue;
      const melt = (this.ownerOf.get(o.id)!.plugin as BodyPlugin).melt;
      drawMaterialCtx(ctx, { ...o, x: part.position.x, y: part.position.y, angle: part.angle * DEG, note: '' }, false, melt);
    }

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
        const vx = (ax - bx) * LAUNCH_FACTOR;
        const vy = (ay - by) * LAUNCH_FACTOR;
        ctx.fillStyle = 'rgba(255,138,61,.75)';
        for (let i = 1; i <= 9; i++) {
          const t = i * 0.09;
          ctx.beginPath();
          ctx.arc(bx + vx * t * 60, by + vy * t * 60 + 0.5 * (this.engine.gravity.y * 0.001 * Math.pow(t * 60, 2)) * 16.66, 4, 0, 7);
          ctx.fill();
        }
      }
      // hero: a round body skinned with meta.hero
      drawMaterialCtx(ctx, { shape: 'emoji', x: bx, y: by, r: BALL_R, angle: this.ball.angle * DEG, material: 'rubber', emoji: this.level.meta.hero || '🙂', note: '' }, false);
    }
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
  }
}
