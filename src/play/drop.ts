/* =====================================================================
   play/drop.ts — drop mode (tap-to-hop descent).

   A game runtime reading the SAME schema (meta.mode === "drop"). The hero
   spawns as a dynamic ball at the start point (the slingshot field reinterpreted
   as a spawn marker) and gravity does the rest; a tap anywhere hops it, but only
   while grounded (an active contact underfoot) or within a short coyote window.
   Villains (target-material objects) are hazards — any contact restarts the run
   at the spawn point and bumps the attempt counter; nothing is destroyed. Reach
   an object marked role:'goal' (a static sensor, drawn as a catch tray) to clear.

   Deliberate seams:
   - No break system here (drop never destroys). Ice still MELTS.
   - Grounded/coyote logic lives in grounded.ts, shared with bounce mode.
   - Feel constants (HOP, COYOTE_MS) live in tuning.ts — placeholders until
     phone testing.

   Structure mirrors PlaySession/DriveSession so main.ts treats them
   interchangeably (update/render/destroy + status).
   ===================================================================== */

import Matter from 'matter-js';
import { Level, LevelObject } from '../schema';
import { drawMaterialCtx, DEG } from '../editor/render';
import { makeMatterBody } from './bodies';
import { GroundTracker } from './grounded';
import { HOP } from './tuning';

const { Engine, Bodies, Body, Composite, Events } = Matter;

const HERO_R = 22;
const HERO_FRICTION = 0.35;
const HERO_RESTITUTION = 0.15;
const HERO_DENSITY = 0.0016;
const MELT_K = 0.9985;
const MELT_MIN = 0.3;
const ROLL_SPEED = 1.2; // above this the hero renders as a plain rolling disc
const FLASH_MS = 260;

export type DropStatus = 'playing' | 'won' | 'failed';

interface Mover {
  b: Matter.Body;
  o: LevelObject;
  len: number;
}

type CollisionHandler = (ev: Matter.IEventCollision<Matter.Engine>) => void;

export class DropSession {
  private level: Level;
  private engine: Matter.Engine;
  private partOf = new Map<string, Matter.Body>();
  private meltOf = new Map<Matter.Body, { o: LevelObject; melt: number }>();
  private movers: Mover[] = [];
  private hazards = new Set<Matter.Body>();
  private goals = new Set<Matter.Body>();
  private hero!: Matter.Body;
  private ground = new GroundTracker();
  private spawn: { x: number; y: number };
  private playT = 0;
  private flashUntil = 0;
  private wantJump = false;
  private onStart: CollisionHandler | null = null;
  private onActive: CollisionHandler | null = null;
  attempts = 0;
  status: DropStatus = 'playing';

  constructor(level: Level) {
    this.level = level;
    this.spawn = { x: level.slingshot.x, y: level.slingshot.y };
    this.engine = Engine.create({ enableSleeping: false });
    this.engine.gravity.y = level.meta.gravity ?? 1;

    const { w: W, h: H, floorY } = level.world;
    Composite.add(this.engine.world, [
      Bodies.rectangle(W / 2, floorY + (H - floorY) / 2 + 40, W + 400, H - floorY + 80, { isStatic: true }),
      Bodies.rectangle(-40, H / 2, 80, H * 3, { isStatic: true }),
      Bodies.rectangle(W + 40, H / 2, 80, H * 3, { isStatic: true }),
    ]);

    this.buildBodies();
    this.spawnHero();
    this.wireCollisions();
  }

  private buildBodies(): void {
    for (const o of this.level.objects) {
      const b = makeMatterBody(o);
      this.partOf.set(o.id, b);
      if (o.role === 'goal') {
        // goal zones detect overlap without colliding, and never move/break
        Body.setStatic(b, true);
        b.isSensor = true;
        this.goals.add(b);
      } else {
        if (o.path) this.movers.push({ b, o, len: Math.hypot(o.path.x - o.x, o.path.y - o.y) });
        if (o.material === 'target') this.hazards.add(b);
        if (o.material === 'ice') this.meltOf.set(b, { o, melt: 1 });
      }
      Composite.add(this.engine.world, b);
    }
  }

  private spawnHero(): void {
    this.hero = Bodies.circle(this.spawn.x, this.spawn.y, HERO_R, {
      density: HERO_DENSITY,
      friction: HERO_FRICTION,
      restitution: HERO_RESTITUTION,
    });
    Composite.add(this.engine.world, this.hero);
  }

  /** Reset the hero to the spawn point with no velocity or spin (a restart). */
  private respawnHero(): void {
    Body.setPosition(this.hero, { x: this.spawn.x, y: this.spawn.y });
    Body.setVelocity(this.hero, { x: 0, y: 0 });
    Body.setAngularVelocity(this.hero, 0);
    Body.setAngle(this.hero, 0);
    this.ground.reset();
  }

  private restart(): void {
    this.attempts++;
    this.flashUntil = this.playT + FLASH_MS;
    this.respawnHero();
  }

  private isHero(b: Matter.Body): boolean {
    const top = b.parent && b.parent !== b ? b.parent : b;
    return top === this.hero;
  }
  private topOf(b: Matter.Body): Matter.Body {
    return b.parent && b.parent !== b ? b.parent : b;
  }

  private wireCollisions(): void {
    const scan = (ev: Matter.IEventCollision<Matter.Engine>) => {
      if (this.status !== 'playing') return;
      this.ground.observe(this.hero, ev.pairs, HERO_R, this.playT);
      for (const pair of ev.pairs) {
        let other: Matter.Body | null = null;
        if (this.isHero(pair.bodyA)) other = this.topOf(pair.bodyB);
        else if (this.isHero(pair.bodyB)) other = this.topOf(pair.bodyA);
        if (!other) continue;
        if (this.goals.has(other)) {
          this.status = 'won';
          return;
        }
        if (this.hazards.has(other)) {
          this.restart();
          return;
        }
      }
    };
    this.onStart = scan;
    this.onActive = scan;
    Events.on(this.engine, 'collisionStart', this.onStart);
    Events.on(this.engine, 'collisionActive', this.onActive);
  }

  /** A tap anywhere: hop if grounded or within the coyote window. */
  tap(): void {
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

    // ice melt (goal sensors are excluded — they never melt)
    for (const [b, st] of this.meltOf) {
      Body.scale(b, MELT_K, MELT_K);
      st.melt *= MELT_K;
      if (st.melt < MELT_MIN) {
        Composite.remove(this.engine.world, b);
        this.partOf.delete(st.o.id);
        this.meltOf.delete(b);
      }
    }

    if (this.status === 'playing' && this.wantJump) {
      if (this.ground.canJump(this.playT)) {
        Body.setVelocity(this.hero, { x: this.hero.velocity.x, y: -HOP });
        this.ground.reset(); // one contact, one hop — no mid-air double jump
      }
    }
    this.wantJump = false;

    Engine.update(this.engine, Math.min(dt, 33));

    // fell out of the world — same as touching a hazard
    if (this.status === 'playing' && this.hero.position.y > this.level.world.h + 200) this.restart();
  }

  render(ctx: CanvasRenderingContext2D): void {
    for (const o of this.level.objects) {
      const b = this.partOf.get(o.id);
      if (!b) continue;
      const melt = this.meltOf.get(b)?.melt ?? 1;
      drawMaterialCtx(ctx, { ...o, x: b.position.x, y: b.position.y, angle: b.angle * DEG, note: '' }, false, melt);
    }
    this.drawHero(ctx);

    // hazard restart flash
    if (this.playT < this.flashUntil) {
      const a = 0.35 * ((this.flashUntil - this.playT) / FLASH_MS);
      ctx.save();
      ctx.fillStyle = `rgba(220,40,50,${a})`;
      ctx.fillRect(0, 0, this.level.world.w, this.level.world.h);
      ctx.restore();
    }
  }

  private drawHero(ctx: CanvasRenderingContext2D): void {
    const p = this.hero.position;
    const speed = Math.hypot(this.hero.velocity.x, this.hero.velocity.y);
    const rolling = this.status === 'playing' && speed >= ROLL_SPEED;
    if (rolling) {
      // plain rolling disc — the body spins but the skin doesn't show it
      ctx.save();
      ctx.fillStyle = '#ffd93d';
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, HERO_R, 0, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      ctx.beginPath();
      ctx.arc(p.x - HERO_R * 0.32, p.y - HERO_R * 0.32, HERO_R * 0.24, 0, 7);
      ctx.fill();
      ctx.restore();
    } else {
      // at rest and on clearing: show the hero's face
      drawMaterialCtx(ctx, { shape: 'emoji', x: p.x, y: p.y, r: HERO_R, angle: 0, material: 'rubber', emoji: this.level.meta.hero || '🙂', note: '' }, false);
    }
  }

  destroy(): void {
    if (this.onStart) Events.off(this.engine, 'collisionStart', this.onStart);
    if (this.onActive) Events.off(this.engine, 'collisionActive', this.onActive);
    Composite.clear(this.engine.world, false, true);
    Engine.clear(this.engine);
  }
}
