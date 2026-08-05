/* =====================================================================
   play/drive.ts — drive mode (M5, the Red Ball direction).

   A distinct game runtime reading the SAME schema (meta.mode === "drive").
   The hero is a drivable ball (left/right + jump) instead of a slingshot
   projectile; reach meta.goal to clear the level. Target-material pieces are
   hazards. Prototype-quality tuning — deliberately its own pass, not the
   rigid-body defaults. Structure mirrors PlaySession so main.ts can treat
   them interchangeably (update/render/destroy + status).
   ===================================================================== */

import Matter from 'matter-js';
import { Level, LevelObject } from '../schema';
import { drawMaterialCtx, DEG } from '../editor/render';
import { makeMatterBody } from './bodies';
import { GroundTracker } from './grounded';
import { MATERIALS } from '../materials';

const { Engine, Bodies, Body, Composite, Sleeping, Events } = Matter;

const HERO_R = 24;
const MOVE_VX = 7.5; // horizontal speed (world units / step)
const JUMP_VY = 12; // jump impulse
// The hero IS a rubber ball (the "Red Ball"): take its bounce/grip straight from
// the rubber material so it matches how it's drawn, instead of a dead hand-tuned
// body. Bounce means |vy| never settles, so grounding uses real contacts below.
const RUBBER = MATERIALS.rubber;

export type DriveStatus = 'playing' | 'won' | 'failed';

interface Mover {
  b: Matter.Body;
  o: LevelObject;
  len: number;
}

export class DriveSession {
  private level: Level;
  private engine: Matter.Engine;
  private partOf = new Map<string, Matter.Body>();
  private tops: Matter.Body[] = [];
  private movers: Mover[] = [];
  private hazards: Matter.Body[] = [];
  private hero: Matter.Body;
  private ground = new GroundTracker();
  private onCollide: ((ev: Matter.IEventCollision<Matter.Engine>) => void) | null = null;
  private dir = 0;
  private wantJump = false;
  private playT = 0;
  status: DriveStatus = 'playing';

  constructor(level: Level) {
    this.level = level;
    this.engine = Engine.create({ enableSleeping: false });
    this.engine.gravity.y = level.meta.gravity ?? 1;

    const { w: W, h: H, floorY } = level.world;
    Composite.add(this.engine.world, [
      Bodies.rectangle(W / 2, floorY + (H - floorY) / 2 + 40, W + 400, H - floorY + 80, { isStatic: true }),
      Bodies.rectangle(-40, H / 2, 80, H * 3, { isStatic: true }),
      Bodies.rectangle(W + 40, H / 2, 80, H * 3, { isStatic: true }),
    ]);

    for (const o of level.objects) {
      const b = makeMatterBody(o);
      this.partOf.set(o.id, b);
      this.tops.push(b);
      Composite.add(this.engine.world, b);
      if (o.path) this.movers.push({ b, o, len: Math.hypot(o.path.x - o.x, o.path.y - o.y) });
      if (o.material === 'target') this.hazards.push(b);
    }

    // Bounciness is author-tunable per level (settings slider → meta.bounce);
    // fall back to the rubber material's own restitution when unset.
    const bounce = level.meta.bounce ?? RUBBER.restitution;
    this.hero = Bodies.circle(level.slingshot.x, floorY - 120, HERO_R, {
      density: RUBBER.density,
      friction: RUBBER.friction,
      frictionStatic: 0.05,
      restitution: bounce,
    });
    Composite.add(this.engine.world, this.hero);

    // Ground the jump on real contacts (a support point underfoot), not on a
    // velocity threshold — a bouncing ball never stays under one.
    this.onCollide = (ev) => this.ground.observe(this.hero, ev.pairs, HERO_R, this.playT);
    Events.on(this.engine, 'collisionStart', this.onCollide);
    Events.on(this.engine, 'collisionActive', this.onCollide);
  }

  setMove(dir: number): void {
    this.dir = Math.sign(dir);
  }
  jump(): void {
    this.wantJump = true;
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

    if (this.status === 'playing') {
      // Responsive horizontal control; preserve vertical from physics.
      if (this.dir !== 0) Body.setVelocity(this.hero, { x: this.dir * MOVE_VX, y: this.hero.velocity.y });
      else Body.setVelocity(this.hero, { x: this.hero.velocity.x * 0.8, y: this.hero.velocity.y });
      if (this.wantJump && this.ground.canJump(this.playT)) {
        Body.setVelocity(this.hero, { x: this.hero.velocity.x, y: -JUMP_VY });
        this.ground.reset(); // one contact, one jump — no mid-air/mid-bounce double jump
        Sleeping.set(this.hero, false);
      }
    }
    this.wantJump = false;

    Engine.update(this.engine, Math.min(dt, 33));

    if (this.status === 'playing') {
      const hp = this.hero.position;
      const goal = this.level.meta.goal;
      if (goal && Math.hypot(hp.x - goal.x, hp.y - goal.y) <= goal.r + HERO_R) this.status = 'won';
      for (const hz of this.hazards) {
        const d = Math.hypot(hp.x - hz.position.x, hp.y - hz.position.y);
        if (d <= HERO_R + (hz.circleRadius ?? 26)) {
          this.status = 'failed';
          break;
        }
      }
      // fell out of the world
      if (hp.y > this.level.world.h + 200) this.status = 'failed';
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const goal = this.level.meta.goal;
    if (goal) {
      const pulse = 0.6 + 0.4 * Math.abs(Math.sin(this.playT / 400));
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#ffd24a';
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(goal.x, goal.y, goal.r, 0, 7);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.font = goal.r * 1.1 + 'px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🏁', goal.x, goal.y);
      ctx.restore();
    }
    for (const o of this.level.objects) {
      const b = this.partOf.get(o.id);
      if (!b) continue;
      drawMaterialCtx(ctx, { ...o, x: b.position.x, y: b.position.y, angle: b.angle * DEG, note: '' }, false);
    }
    drawMaterialCtx(ctx, { shape: 'emoji', x: this.hero.position.x, y: this.hero.position.y, r: HERO_R, angle: this.hero.angle * DEG, material: 'rubber', emoji: this.level.meta.hero || '🙂', note: '' }, false);
  }

  destroy(): void {
    if (this.onCollide) {
      Events.off(this.engine, 'collisionStart', this.onCollide);
      Events.off(this.engine, 'collisionActive', this.onCollide);
    }
    Composite.clear(this.engine.world, false, true);
    Engine.clear(this.engine);
  }
}
