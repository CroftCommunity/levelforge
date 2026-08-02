/* =====================================================================
   play/world.ts — Test mode: the Matter.js world built from a level.

   Physics exists only here (edit mode is a frozen god view). This module
   owns the engine, steps it, applies the break model, melts ice, drives
   pathed movers, runs the slingshot, and tracks the win/fail state
   (destroy vs protect target roles). It draws its own content in world
   space; the caller supplies the view transform and board backdrop.
   ===================================================================== */

import Matter from 'matter-js';
import { Level, LevelObject } from '../schema';
import { MATERIALS } from '../materials';
import { drawMaterialCtx, drawSlingshotCtx, DEG } from '../editor/render';
import { triVerts } from '../editor/geometry';
import { impactOf, breaksAt } from './break-model';

const { Engine, Bodies, Body, Composite, Events, Sleeping } = Matter;

const SETTLE_MS = 500; // no breaking during the initial settle
const MELT_K = 0.9985; // ice shrink per frame
const MELT_MIN = 0.3; // remove ice below this fraction of original
const BALL_R = 22;
const BALL_DENSITY = 0.0016;
const LAUNCH_FACTOR = 0.16;
const PULL_CAP = 200;
const RELOAD_MS = 3800;

export type PlayStatus = 'playing' | 'won' | 'failed';

interface BodyPlugin {
  lvlIds: string[]; // one for a solo body, many for a weld group
  breakAt: number | null;
  isIce: boolean;
  melt: number;
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
  /** Top-level bodies (solo or compound) — the units that break and melt. */
  private bodies: Matter.Body[] = [];
  /** lvlId -> the body/part to read position+angle from when rendering. */
  private partOf = new Map<string, Matter.Body>();
  /** lvlId -> the owning top-level body (for melt/broken bookkeeping). */
  private ownerOf = new Map<string, Matter.Body>();
  private movers: Mover[] = [];
  private broken = new Set<string>();
  private ball: Matter.Body | null = null;
  private ballState: 'loaded' | 'flying' = 'loaded';
  private pull: { x: number; y: number } | null = null;
  private destroyLeft = 0;
  private playT = 0;
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

  /* --------------------------- world build --------------------------- */

  private makeBody(o: LevelObject): Matter.Body {
    const m = MATERIALS[o.material];
    const opts: Matter.IBodyDefinition = {
      density: m.density,
      friction: m.friction,
      restitution: m.restitution,
      angle: (o.angle || 0) / DEG,
      isStatic: !!o.anchored || !!o.path,
    };
    if (o.shape === 'box') return Bodies.rectangle(o.x, o.y, o.w!, o.h!, opts);
    if (o.shape === 'tri') return Bodies.fromVertices(o.x, o.y, [triVerts({ w: o.w!, h: o.h! })], opts);
    return Bodies.circle(o.x, o.y, o.r!, opts);
  }

  private buildBodies(): void {
    // Group by weld id; ungrouped pieces are their own singleton group.
    const groups = new Map<string, LevelObject[]>();
    let solo = 0;
    for (const o of this.level.objects) {
      const key = o.weld ? `weld:${o.weld}` : `solo:${solo++}`;
      const arr = groups.get(key);
      if (arr) arr.push(o);
      else groups.set(key, [o]);
    }

    for (const [, members] of groups) {
      let top: Matter.Body;
      if (members.length === 1) {
        top = this.makeBody(members[0]);
        this.partOf.set(members[0].id, top);
      } else {
        // Weld: fuse parts into one compound body (v0.4). Parts must be
        // dynamic before Body.create; each part stays readable for rendering.
        const parts = members.map((o) => {
          const b = this.makeBody(o);
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
    const breakAts = members.map((o) => MATERIALS[o.material].breakAt);
    const numeric = breakAts.filter((v): v is number => v != null);
    // A group breaks as a unit at its weakest member; unbreakable only if every
    // member is unbreakable.
    const breakAt = numeric.length ? Math.min(...numeric) : null;
    return {
      lvlIds: members.map((o) => o.id),
      breakAt,
      isIce: members.length === 1 && members[0].material === 'ice',
      melt: 1,
    };
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
      if (this.playT < SETTLE_MS) return; // settle grace: placed pieces land quietly
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
    // Collisions report parts; walk up to the owning top-level body.
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
    for (const id of p.lvlIds) this.broken.add(id);
    Composite.remove(this.engine.world, top);
    for (const o of this.level.objects) {
      if (!p.lvlIds.includes(o.id) || o.material !== 'target') continue;
      if ((o.role ?? 'destroy') === 'protect') this.status = 'failed';
      else this.destroyLeft--;
    }
    if (this.status !== 'failed' && this.destroyLeft <= 0) this.status = 'won';
  }

  /* ---------------------------- slingshot ---------------------------- */

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

  /* ------------------------------ update ----------------------------- */

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
  }

  /* ------------------------------ render ----------------------------- */

  /** Draw the play content in world space (caller has set the view transform). */
  render(ctx: CanvasRenderingContext2D): void {
    drawSlingshotCtx(ctx, this.level.slingshot.x, this.level.slingshot.y, false);

    for (const o of this.level.objects) {
      if (this.broken.has(o.id)) continue;
      const part = this.partOf.get(o.id);
      if (!part) continue;
      const owner = this.ownerOf.get(o.id)!;
      const melt = (owner.plugin as BodyPlugin).melt;
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
        ctx.fillStyle = 'rgba(255,138,61,.7)';
        for (let i = 1; i <= 9; i++) {
          const t = i * 0.09;
          ctx.beginPath();
          ctx.arc(bx + vx * t * 60, by + vy * t * 60 + 0.5 * (this.engine.gravity.y * 0.001 * Math.pow(t * 60, 2)) * 16.66, 4, 0, 7);
          ctx.fill();
        }
      }
      drawMaterialCtx(ctx, { shape: 'circle', x: bx, y: by, r: BALL_R, angle: this.ball.angle * DEG, material: 'rubber', note: '' }, false);
    }
  }

  /** Targets remaining to destroy (for the HUD). */
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
