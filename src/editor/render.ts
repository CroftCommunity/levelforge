/* =====================================================================
   editor/render.ts — procedural per-material canvas rendering.

   The texture IS the label: each material draws distinctively so the UI can
   stay icon-only. Draws in WORLD coordinates; the caller sets the view
   transform. Shared by the editor, Test mode, and thumbnails. The board
   backdrop lives in backdrops.ts; this file draws pieces + slingshot.
   ===================================================================== */

import { MATERIALS, MaterialKey } from '../materials';
import { WIDE, BRUSH_DEFAULT, BlobPoint, SLING_POLE_BOTTOM } from '../schema';
import { triVerts } from './geometry';
import { drawBackdrop } from './backdrops';
import { getSpriteImg } from './sprites';

const DEG = 180 / Math.PI;

export interface RenderObject {
  shape: 'box' | 'circle' | 'tri' | 'emoji' | 'blob';
  x: number;
  y: number;
  w?: number;
  h?: number;
  r?: number;
  angle?: number;
  material: MaterialKey;
  emoji?: string;
  sprite?: string;
  pts?: BlobPoint[];
  brushR?: number;
  anchored?: boolean;
  path?: unknown;
  note?: string;
  role?: 'destroy' | 'protect' | 'goal';
  /** Custom "#rrggbb" paint color overriding the material's base fill. */
  color?: string;
  /** Box-only label: the box renders as these glyphs (physics keeps w×h). */
  text?: string;
  /** Opacity in (0, 1]; omitted = opaque. Rendering only. */
  alpha?: number;
  /** Blob-only: render the stroke as a closed, filled shape. */
  fill?: boolean;
}

/** A text box's font size from its box height — one formula shared with the
    editor's measurement so the glyphs always fill the physics body. */
export const TEXT_H_PER_PX = 1.3;
export function textFont(px: number): string {
  return `700 ${px}px system-ui,sans-serif`;
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
  // a custom paint color overrides the material's base fill (rendering only)
  const baseColor = o.color ?? m.color;
  // a piece's own opacity scales every alpha the shape branches set
  const alphaMul = o.alpha ?? 1;
  c.save();
  c.translate(o.x, o.y);
  c.rotate((o.angle || 0) / DEG);
  c.globalAlpha = (ghost ? 0.45 : o.material === 'ice' ? 0.82 : 1) * alphaMul;
  c.fillStyle = baseColor;
  c.strokeStyle = 'rgba(0,0,0,.35)';
  c.lineWidth = 2;

  if (o.shape === 'box' && o.text) {
    // a text piece: the glyphs are the visual; physics stays the box's w×h
    const h = (o.h ?? 0) * melt;
    const px = Math.max(4, h / TEXT_H_PER_PX);
    c.font = textFont(px);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = Math.max(1.5, px / 14);
    c.strokeText(o.text, 0, px * 0.06);
    c.fillText(o.text, 0, px * 0.06);
  } else if (o.shape === 'box') {
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
      (
        [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ] as const
      ).forEach(([a, b]) => {
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
  } else if (o.shape === 'blob') {
    const r = (o.brushR ?? BRUSH_DEFAULT) * melt;
    const pts = (o.pts ?? []).map(([px, py]) => [px * melt, py * melt] as [number, number]);
    if (pts.length) {
      for (const [lw, st] of [
        [r * 2 + 5, 'rgba(0,0,0,.35)'],
        [r * 2, baseColor],
      ] as Array<[number, string]>) {
        c.strokeStyle = st;
        c.lineWidth = lw;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.beginPath();
        if (pts.length === 1) {
          c.arc(pts[0][0], pts[0][1], lw / 2, 0, 7);
          c.fillStyle = st;
          c.fill();
        } else {
          c.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
          c.stroke();
        }
      }
      // fill bucket: close the stroke and flood its interior. Visual only —
      // the physics body stays the bead-chain outline.
      if (o.fill && pts.length > 2) {
        c.fillStyle = baseColor;
        c.beginPath();
        c.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
        c.closePath();
        c.fill();
      }
      if (o.material === 'stone') {
        c.fillStyle = 'rgba(0,0,0,.18)';
        for (let i = 0; i < pts.length; i++) {
          c.beginPath();
          c.arc(
            pts[i][0] + (hash(i) - 0.5) * r,
            pts[i][1] + (hash(i + 3) - 0.5) * r,
            1.5 + hash(i) * 2.5,
            0,
            7,
          );
          c.fill();
        }
      }
    }
  } else if (o.shape === 'emoji') {
    const r = (o.r ?? 0) * melt;
    const sprite = o.sprite ? getSpriteImg(o.sprite) : null;
    if (sprite) {
      // custom image skin, clipped to the body's circle
      c.save();
      c.globalAlpha = (ghost ? 0.6 : 1) * alphaMul;
      c.beginPath();
      c.arc(0, 0, r, 0, 7);
      c.clip();
      const s = Math.max((r * 2) / sprite.width, (r * 2) / sprite.height);
      const dw = sprite.width * s;
      const dh = sprite.height * s;
      c.drawImage(sprite, -dw / 2, -dh / 2, dw, dh);
      c.restore();
      c.globalAlpha = (ghost ? 0.4 : 0.6) * alphaMul;
      c.strokeStyle = 'rgba(0,0,0,.3)';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(0, 0, r, 0, 7);
      c.stroke();
    } else {
      c.globalAlpha = (ghost ? 0.45 : 0.25) * alphaMul;
      c.beginPath();
      c.arc(0, 0, r, 0, 7);
      c.fill();
      c.globalAlpha = (ghost ? 0.6 : 1) * alphaMul;
      c.font = r * 1.9 + 'px system-ui,sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(o.emoji || '🙂', 0, r * 0.08);
    }
  } else {
    // circle
    const r = (o.r ?? 0) * melt;
    c.beginPath();
    c.arc(0, 0, r, 0, 7);
    c.fill();
    c.stroke();
    if (o.material === 'target') {
      // protect-role villains ("hostages") wear a blue, worried face
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
      if (o.role === 'protect') c.arc(0, r * 0.45, r * 0.4, 1.25 * Math.PI, 1.75 * Math.PI);
      else c.arc(0, r * 0.15, r * 0.4, 0.25 * Math.PI, 0.75 * Math.PI);
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
  if (o.role === 'goal') {
    // goal-zone marker: a checkered flag riding above the piece (the tray/post
    // itself is the object). Mode decides tray-vs-flag framing in the runtime.
    c.globalAlpha = ghost ? 0.6 : 1;
    const half = o.shape === 'box' ? (o.h ?? 40) / 2 : (o.r ?? o.w ?? 40) / 1;
    const fs = Math.max(
      24,
      o.shape === 'box' ? Math.min(o.w ?? 44, (o.h ?? 44) * 2) : (o.r ?? 30) * 1.6,
    );
    c.font = fs + 'px system-ui,sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('🏁', 0, -half - fs * 0.5);
  }
  if (o.note) {
    c.globalAlpha = 1;
    c.fillStyle = '#ff8a3d';
    const px = o.shape === 'box' ? (o.w ?? 0) / 2 : ((o.r ?? (o.w ?? 0) / 2) || 30) * 0.8;
    const py = o.shape === 'box' ? -(o.h ?? 0) / 2 : -((o.r ?? (o.h ?? 0) / 2) || 30) * 0.8;
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
  c.moveTo(0, SLING_POLE_BOTTOM);
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
    c.fillStyle = 'rgba(200,215,235,.9)';
    c.font = '15px ui-monospace,monospace';
    c.textAlign = 'center';
    c.fillText('launcher', 0, 118);
  }
  c.restore();
}

/** Render a level small onto a thumbnail canvas (library cards). */
export function renderThumb(
  canvasEl: HTMLCanvasElement,
  lvl: {
    meta?: {
      background?: string;
      backgroundImage?: string | null;
      backgroundSrc?: string | null;
      hero?: string;
    };
    world?: { w?: number; h?: number; floorY?: number };
    slingshot: { x: number; y: number };
    objects: RenderObject[];
  },
): void {
  const c = canvasEl.getContext('2d');
  if (!c) return;
  // Fit the level's world into the thumbnail, centred — derive from the level,
  // never a global, so tall levels thumbnail correctly.
  const W = lvl.world?.w ?? WIDE.w;
  const H = lvl.world?.h ?? WIDE.h;
  const s = Math.min(canvasEl.width / W, canvasEl.height / H);
  c.setTransform(s, 0, 0, s, (canvasEl.width - W * s) / 2, (canvasEl.height - H * s) / 2);
  drawBackdrop(c, lvl, false);
  drawSlingshotCtx(c, lvl.slingshot.x, lvl.slingshot.y, false);
  for (const o of lvl.objects || []) drawMaterialCtx(c, { ...o, note: '' }, false);
}

export { DEG };
