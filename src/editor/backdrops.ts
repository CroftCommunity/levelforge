/* =====================================================================
   editor/backdrops.ts — procedural scenery + custom backdrops.

   Six canvas-drawn backgrounds (grid, grass, cave, desert, night, sky),
   a custom-image path, an edit-mode alignment grid overlay, and the
   copyable agent brief for image-generation agents. Ported from the
   reference; the physics floor stays legible over any art.

   Invariant: the surface pieces rest on is exactly the fy line. Scenery
   painted above fy (hills, dunes) must read as distant background — hazy,
   translucent — never as the ground surface, or resting pieces look sunk
   below ground.

   World-refactor: every painter takes the level's world dimensions (W, H)
   and floor line (fy). Nothing here reads a global world size — a tall
   900 x 1600 level paints just as correctly as a wide 1600 x 900 one.
   ===================================================================== */

import { BackgroundKind, WIDE, floorYFor } from '../schema';

function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

type BgFn = (c: CanvasRenderingContext2D, W: number, H: number, fy: number) => void;

export const BACKGROUNDS: Record<Exclude<BackgroundKind, 'custom'>, BgFn> = {
  grid(c, W, H, fy) {
    c.fillStyle = '#101a27';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(60,90,130,.16)';
    c.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, H);
      c.stroke();
    }
    for (let y = 0; y <= H; y += 40) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(W, y);
      c.stroke();
    }
    c.fillStyle = '#22314a';
    c.fillRect(0, fy, W, H - fy);
    c.strokeStyle = '#31486b';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, fy);
    c.lineTo(W, fy);
    c.stroke();
  },
  grass(c, W, H, fy) {
    const g = c.createLinearGradient(0, 0, 0, fy);
    g.addColorStop(0, '#8ec9ef');
    g.addColorStop(1, '#d6ecf9');
    c.fillStyle = g;
    c.fillRect(0, 0, W, fy);
    c.fillStyle = 'rgba(255,255,255,.75)';
    for (let i = 0; i < 5; i++) {
      const cxx = 200 + i * 330 + hash(i) * 80;
      const cy = 90 + hash(i + 9) * 130;
      c.beginPath();
      c.ellipse(cxx, cy, 80 + hash(i + 3) * 40, 26, 0, 0, 7);
      c.ellipse(cxx + 60, cy + 8, 55, 20, 0, 0, 7);
      c.fill();
    }
    // distant hills: translucent so they sit behind the playfield, not on it
    c.fillStyle = 'rgba(154,201,122,.45)';
    c.beginPath();
    c.moveTo(0, fy);
    c.quadraticCurveTo(W * 0.25, fy - 130, W * 0.5, fy);
    c.quadraticCurveTo(W * 0.75, fy - 90, W, fy);
    c.closePath();
    c.fill();
    c.fillStyle = '#79b356';
    c.fillRect(0, fy, W, H - fy);
    c.strokeStyle = '#5f9440';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, fy);
    c.lineTo(W, fy);
    c.stroke();
    c.strokeStyle = '#5f9440';
    c.lineWidth = 2;
    for (let x = 8; x < W; x += 22) {
      c.beginPath();
      c.moveTo(x, fy);
      c.lineTo(x + (hash(x) * 8 - 4), fy - 9 - hash(x + 1) * 8);
      c.stroke();
    }
  },
  cave(c, W, H, fy) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1c1510');
    g.addColorStop(1, '#3a2d21');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#141009';
    for (let i = 0; i < 11; i++) {
      const x = i * 150 + hash(i) * 70;
      const w = 45 + hash(i + 5) * 55;
      const h = 70 + hash(i + 2) * 150;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x + w / 2, h);
      c.lineTo(x + w, 0);
      c.closePath();
      c.fill();
    }
    c.fillStyle = 'rgba(255,220,150,.05)';
    for (let i = 0; i < 40; i++) {
      c.beginPath();
      c.arc(hash(i * 7) * W, hash(i * 7 + 1) * H, 2 + hash(i) * 3, 0, 7);
      c.fill();
    }
    c.fillStyle = '#241a10';
    c.fillRect(0, fy, W, H - fy);
    c.strokeStyle = '#4a3826';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, fy);
    c.lineTo(W, fy);
    c.stroke();
  },
  desert(c, W, H, fy) {
    const g = c.createLinearGradient(0, 0, 0, fy);
    g.addColorStop(0, '#f7d99b');
    g.addColorStop(1, '#f2be6e');
    c.fillStyle = g;
    c.fillRect(0, 0, W, fy);
    c.fillStyle = '#ffe9b0';
    c.beginPath();
    c.arc(W - 220, 130, 64, 0, 7);
    c.fill();
    // distant dunes: hazy, clearly behind the playfield surface
    c.fillStyle = 'rgba(224,169,95,.38)';
    c.beginPath();
    c.moveTo(0, fy);
    c.quadraticCurveTo(W * 0.3, fy - 110, W * 0.62, fy - 10);
    c.quadraticCurveTo(W * 0.85, fy - 70, W, fy);
    c.closePath();
    c.fill();
    c.fillStyle = '#dba55e';
    c.fillRect(0, fy, W, H - fy);
    c.strokeStyle = '#b9813f';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, fy);
    c.lineTo(W, fy);
    c.stroke();
    c.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const x = 100 + i * 170;
      const y = fy + 18 + hash(i) * 20;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + 38, y - 9, x + 76, y);
      c.stroke();
    }
  },
  night(c, W, H, fy) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#080b1e');
    g.addColorStop(1, '#1c2447');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#fff';
    for (let i = 0; i < 90; i++) {
      c.globalAlpha = 0.3 + hash(i) * 0.7;
      c.beginPath();
      c.arc(hash(i * 3) * W, hash(i * 3 + 1) * fy * 0.9, 0.8 + hash(i) * 1.6, 0, 7);
      c.fill();
    }
    c.globalAlpha = 1;
    c.fillStyle = '#f2ecd8';
    c.beginPath();
    c.arc(260, 140, 52, 0, 7);
    c.fill();
    c.fillStyle = '#1c2447';
    c.beginPath();
    c.arc(282, 126, 44, 0, 7);
    c.fill();
    c.fillStyle = '#131a36';
    c.fillRect(0, fy, W, H - fy);
    c.strokeStyle = '#2c3763';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, fy);
    c.lineTo(W, fy);
    c.stroke();
  },
  sky(c, W, H, fy) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#7fb7e8');
    g.addColorStop(1, '#e6f4fd');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,.85)';
    for (let i = 0; i < 7; i++) {
      const cxx = 120 + i * 230 + hash(i) * 90;
      const cy = 110 + hash(i + 4) * 500;
      c.beginPath();
      c.ellipse(cxx, cy, 90 + hash(i + 2) * 50, 30, 0, 0, 7);
      c.ellipse(cxx + 70, cy + 10, 60, 22, 0, 0, 7);
      c.fill();
    }
    c.fillStyle = 'rgba(190,220,245,.9)';
    c.fillRect(0, fy, W, H - fy);
    c.strokeStyle = '#9dc4e4';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, fy);
    c.lineTo(W, fy);
    c.stroke();
  },
};

/* --------------------------- custom images ---------------------------- */
let bgImgCache: { src: string | null; img: HTMLImageElement | null; ready: boolean } = {
  src: null,
  img: null,
  ready: false,
};
/** Lazily load and cache a single backdrop image; null until it's ready. */
export function getBgImg(src: string): HTMLImageElement | null {
  if (bgImgCache.src === src) return bgImgCache.ready ? bgImgCache.img : null;
  const img = new Image();
  bgImgCache = { src, img, ready: false };
  img.onload = () => {
    bgImgCache.ready = true;
  };
  img.src = src;
  return null;
}

interface BackdropLevel {
  meta?: { background?: string; backgroundImage?: string | null; backgroundSrc?: string | null };
  world?: { w?: number; h?: number; floorY?: number };
}

/** Draw the full board backdrop in world space, with an optional edit grid.
    Dimensions come from the level's world — never a global. */
export function drawBackdrop(
  c: CanvasRenderingContext2D,
  lvl: BackdropLevel,
  editGrid: boolean,
): void {
  const W = lvl.world?.w ?? WIDE.w;
  const H = lvl.world?.h ?? WIDE.h;
  const fy = lvl.world?.floorY ?? floorYFor(H);
  const bgName = (lvl.meta?.background || 'grid') as BackgroundKind;
  const customSrc = lvl.meta?.backgroundImage || lvl.meta?.backgroundSrc || null;

  if (bgName === 'custom' && customSrc) {
    const img = getBgImg(customSrc);
    if (img) {
      const s = Math.max(W / img.width, H / img.height);
      const dw = img.width * s;
      const dh = img.height * s;
      c.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      BACKGROUNDS.grid(c, W, H, fy); // while loading
    }
    // keep the physics floor legible on any art
    c.fillStyle = 'rgba(0,0,0,.22)';
    c.fillRect(0, fy, W, H - fy);
    c.strokeStyle = 'rgba(255,255,255,.4)';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, fy);
    c.lineTo(W, fy);
    c.stroke();
  } else {
    const fn = (BACKGROUNDS as Record<string, BgFn>)[bgName] || BACKGROUNDS.grid;
    fn(c, W, H, fy);
  }

  if (editGrid && bgName !== 'grid') {
    c.strokeStyle = 'rgba(255,255,255,.07)';
    c.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, H);
      c.stroke();
    }
    for (let y = 0; y <= H; y += 40) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(W, y);
      c.stroke();
    }
  }
}

/* Copyable brief for image-generation agents. The exact dimensions and floor
   percentage are computed from the level's world so a tall backdrop asks for a
   tall image; the rest is verbatim from the reference. */
export function agentBrief(world: { w: number; h: number; floorY: number }): string {
  const { w, h, floorY } = world;
  const ratio = w >= h ? '16:9 landscape' : '9:16 portrait';
  const floorPct = Math.round((floorY / h) * 100);
  return `Create ONE game-backdrop image with these exact requirements:

FORM
- Dimensions: ${w} x ${h} pixels (${ratio}). Deliver PNG or JPG.
- No text, no logos, no watermarks, no UI elements, no borders or frames.

FUNCTION (this sits BEHIND a 2D physics game; pieces render on top)
- Ground line: the playfield floor is at ${floorPct}% of image height (y=${floorY} of ${h}).
  The bottom ${100 - floorPct}% should read as ground surface (grass, rock, sand, etc.).
- The central band (roughly 20%-90% of height) is where gameplay happens:
  keep it low-contrast and low-detail so game pieces stay readable.
  Put the strongest detail near the top and the far edges.
- Flat, even lighting. No heavy vignette (max ~15% darkening at corners).
- Avoid saturated greens near #7bc86c and oranges near #ff8a3d
  (reserved for game targets and UI); earth tones, blues, and muted
  palettes work best.
- A consistent implied horizon; no tilted or fisheye perspective.

STYLE (from the level designer)
- [PASTE YOUR STYLE NOTES HERE — e.g. "misty bamboo forest at dawn,
  woodblock print, soft teal and cream palette"]`;
}

/** Back-compat: the wide-world brief as a constant, for callers without a level. */
export const AGENT_BRIEF = agentBrief({ w: WIDE.w, h: WIDE.h, floorY: floorYFor(WIDE.h) });
