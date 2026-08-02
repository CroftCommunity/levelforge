/* =====================================================================
   editor/render.ts — procedural per-material canvas rendering.

   The texture IS the label: because each material draws distinctively, the
   UI can stay icon-only. Ported from the prototype's drawMaterialCtx and
   friends. These functions draw in WORLD coordinates; the caller sets up the
   view transform. They are shared by the editor, Test mode, and thumbnails.
   ===================================================================== */

import { MATERIALS, MaterialKey } from '../materials';
import { WORLD, DEFAULT_FLOOR_Y } from '../schema';
import { triVerts } from './geometry';

const DEG = 180 / Math.PI;

/** Everything render needs from an object; a superset of LevelObject fields. */
export interface RenderObject {
  shape: 'box' | 'circle' | 'tri' | 'emoji';
  x: number;
  y: number;
  w?: number;
  h?: number;
  r?: number;
  angle?: number;
  material: MaterialKey;
  emoji?: string;
  anchored?: boolean;
  path?: unknown;
  note?: string;
  role?: 'destroy' | 'protect';
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

export function drawMaterialCtx(
  c: CanvasRenderingContext2D,
  o: RenderObject,
  ghost: boolean,
  melt = 1,
): void {
  const m = MATERIALS[o.material];
  c.save();
  c.translate(o.x, o.y);
  c.rotate((o.angle || 0) / DEG);
  c.globalAlpha = ghost ? 0.45 : o.material === 'ice' ? 0.82 : 1;
  c.fillStyle = m.color;
  c.strokeStyle = 'rgba(0,0,0,.35)';
  c.lineWidth = 2;

  if (o.shape === 'box') {
    const w = (o.w ?? 0) * melt;
    const h = (o.h ?? 0) * melt;
    c.beginPath();
    c.rect(-w / 2, -h / 2, w, h);
    c.fill();
    c.stroke();
    c.save();
    c.beginPath();
    c.rect(-w / 2, -h / 2, w, h);
    c.clip();
    if (o.material === 'wood') {
      c.strokeStyle = 'rgba(90,55,20,.45)';
      c.lineWidth = 2;
      const along = w >= h;
      const len = along ? w : h;
      const across = along ? h : w;
      const nLines = Math.max(2, Math.floor(across / 14));
      for (let i = 1; i < nLines; i++) {
        const t = -across / 2 + i * (across / nLines);
        c.beginPath();
        if (along) {
          c.moveTo(-len / 2, t);
          c.lineTo(len / 2, t);
        } else {
          c.moveTo(t, -len / 2);
          c.lineTo(t, len / 2);
        }
        c.stroke();
      }
    } else if (o.material === 'stone') {
      c.fillStyle = 'rgba(0,0,0,.18)';
      const n = Math.max(4, (w * h) / 900);
      for (let i = 0; i < n; i++) {
        const px = (hash(i * 3 + 1) - 0.5) * w;
        const py = (hash(i * 3 + 2) - 0.5) * h;
        c.beginPath();
        c.arc(px, py, 1.5 + hash(i) * 2.5, 0, 7);
        c.fill();
      }
    } else if (o.material === 'metal') {
      c.strokeStyle = 'rgba(50,70,95,.5)';
      c.lineWidth = 3;
      c.strokeRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8);
      c.fillStyle = 'rgba(50,70,95,.6)';
      ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).forEach(([a, b]) => {
        c.beginPath();
        c.arc(a * (w / 2 - 9), b * (h / 2 - 9), 2.6, 0, 7);
        c.fill();
      });
    } else if (o.material === 'ice') {
      c.strokeStyle = 'rgba(255,255,255,.55)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(-w / 2 + 5, h / 2 - 6);
      c.lineTo(w / 2 - 8, -h / 2 + 5);
      c.stroke();
    }
    c.restore();
  } else if (o.shape === 'tri') {
    const v = triVerts({ w: (o.w ?? 0) * melt, h: (o.h ?? 0) * melt });
    c.beginPath();
    c.moveTo(v[0].x, v[0].y);
    c.lineTo(v[1].x, v[1].y);
    c.lineTo(v[2].x, v[2].y);
    c.closePath();
    c.fill();
    c.stroke();
    c.save();
    c.clip();
    if (o.material === 'stone') {
      c.fillStyle = 'rgba(0,0,0,.18)';
      for (let i = 0; i < 8; i++) {
        c.beginPath();
        c.arc((hash(i * 3 + 1) - 0.5) * (o.w ?? 0) * 0.8, (hash(i * 3 + 2) - 0.3) * (o.h ?? 0) * 0.7, 1.5 + hash(i) * 2.5, 0, 7);
        c.fill();
      }
    } else if (o.material === 'wood') {
      c.strokeStyle = 'rgba(90,55,20,.45)';
      c.lineWidth = 2;
      for (let i = 1; i < 4; i++) {
        const t = v[2].y + (v[0].y - v[2].y) * (i / 4);
        c.beginPath();
        c.moveTo(-(o.w ?? 0) / 2, t);
        c.lineTo((o.w ?? 0) / 2, t);
        c.stroke();
      }
    }
    c.restore();
  } else if (o.shape === 'emoji') {
    const r = (o.r ?? 0) * melt;
    c.globalAlpha = ghost ? 0.45 : 0.25;
    c.beginPath();
    c.arc(0, 0, r, 0, 7);
    c.fill();
    c.globalAlpha = ghost ? 0.6 : 1;
    c.font = r * 1.9 + 'px system-ui,sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(o.emoji || '🙂', 0, r * 0.08);
  } else {
    // circle
    const r = (o.r ?? 0) * melt;
    c.beginPath();
    c.arc(0, 0, r, 0, 7);
    c.fill();
    c.stroke();
    if (o.material === 'target') {
      // Protect-role targets wear a distinct (blue) face so the "hostage" reads.
      const faceColor = o.role === 'protect' ? '#123a4a' : '#173a12';
      c.fillStyle = faceColor;
      c.beginPath();
      c.arc(-r * 0.32, -r * 0.18, r * 0.14, 0, 7);
      c.fill();
      c.beginPath();
      c.arc(r * 0.32, -r * 0.18, r * 0.14, 0, 7);
      c.fill();
      c.strokeStyle = faceColor;
      c.lineWidth = 2.5;
      c.beginPath();
      if (o.role === 'protect') {
        // worried mouth (frown) for protect
        c.arc(0, r * 0.45, r * 0.4, 1.25 * Math.PI, 1.75 * Math.PI);
      } else {
        c.arc(0, r * 0.15, r * 0.4, 0.25 * Math.PI, 0.75 * Math.PI);
      }
      c.stroke();
    } else if (o.material === 'rubber') {
      c.fillStyle = 'rgba(255,255,255,.35)';
      c.beginPath();
      c.arc(-r * 0.3, -r * 0.3, r * 0.22, 0, 7);
      c.fill();
    } else {
      c.strokeStyle = 'rgba(0,0,0,.25)';
      c.beginPath();
      c.arc(0, 0, r * 0.62, 0, 7);
      c.stroke();
    }
  }

  if (o.anchored && !o.path) {
    c.globalAlpha = 0.85;
    c.fillStyle = 'rgba(15,23,34,.8)';
    c.font = '11px ui-monospace,monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('⚓', 0, 0);
  }
  if (o.note) {
    c.globalAlpha = 1;
    c.fillStyle = '#ff8a3d';
    const px = o.shape === 'box' ? (o.w ?? 0) / 2 : (o.r ?? (o.w ?? 0) / 2) * 0.8;
    const py = o.shape === 'box' ? -(o.h ?? 0) / 2 : -(o.r ?? (o.h ?? 0) / 2) * 0.8;
    c.beginPath();
    c.arc(px, py, 5, 0, 7);
    c.fill();
  }
  c.restore();
}

export function drawSlingshotCtx(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: boolean,
): void {
  c.save();
  c.translate(x, y);
  c.strokeStyle = '#6b4a2c';
  c.lineWidth = 10;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(0, 90);
  c.lineTo(0, 10);
  c.stroke();
  c.beginPath();
  c.moveTo(0, 10);
  c.lineTo(-22, -26);
  c.stroke();
  c.beginPath();
  c.moveTo(0, 10);
  c.lineTo(22, -26);
  c.stroke();
  if (label) {
    c.fillStyle = 'rgba(125,142,163,.9)';
    c.font = '15px ui-monospace,monospace';
    c.textAlign = 'center';
    c.fillText('launcher', 0, 118);
  }
  c.restore();
}

export function drawBoardCtx(
  c: CanvasRenderingContext2D,
  floorY: number = DEFAULT_FLOOR_Y,
): void {
  c.fillStyle = '#101a27';
  c.fillRect(0, 0, WORLD.w, WORLD.h);
  c.strokeStyle = 'rgba(60,90,130,.16)';
  c.lineWidth = 1;
  for (let x = 0; x <= WORLD.w; x += 40) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, WORLD.h);
    c.stroke();
  }
  for (let y = 0; y <= WORLD.h; y += 40) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(WORLD.w, y);
    c.stroke();
  }
  c.fillStyle = '#22314a';
  c.fillRect(0, floorY, WORLD.w, WORLD.h - floorY);
  c.strokeStyle = '#31486b';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(0, floorY);
  c.lineTo(WORLD.w, floorY);
  c.stroke();
}

/** Render a level small onto a thumbnail canvas (library cards). */
export function renderThumb(
  canvasEl: HTMLCanvasElement,
  lvl: {
    world?: { floorY?: number };
    slingshot: { x: number; y: number };
    objects: RenderObject[];
  },
): void {
  const c = canvasEl.getContext('2d');
  if (!c) return;
  const s = canvasEl.width / WORLD.w;
  c.setTransform(s, 0, 0, s, 0, (canvasEl.height - WORLD.h * s) / 2);
  drawBoardCtx(c, lvl.world?.floorY ?? DEFAULT_FLOOR_Y);
  drawSlingshotCtx(c, lvl.slingshot.x, lvl.slingshot.y, false);
  for (const o of lvl.objects || []) drawMaterialCtx(c, { ...o, note: '' }, false);
}

export { DEG };
