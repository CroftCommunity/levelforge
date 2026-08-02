/* Generate demo committed image assets with no external deps:
   - levels/arcade/backdrop.png   (1600x900 backdrop, follows the agent brief)
   - levels/arcade/sprites/blip.png (128x128 transparent custom-emoji sprite)
   Run: node scripts/gen-assets.mjs */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const arcade = join(here, '..', 'levels', 'arcade');
mkdirSync(join(arcade, 'sprites'), { recursive: true });

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba) {
  const rowBytes = w * 4;
  const raw = Buffer.alloc((rowBytes + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (rowBytes + 1)] = 0;
    rgba.copy(raw, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const lerp = (a, b, t) => Math.round(a + (b - a) * t);

// --- backdrop: dusk gradient, low-contrast centre, ground band at ~96% ---
function backdrop() {
  const W = 1600;
  const H = 900;
  const buf = Buffer.alloc(W * H * 4);
  const groundY = Math.round(H * 0.96);
  for (let y = 0; y < H; y++) {
    const t = y / H;
    // muted teal->cream sky (avoids reserved greens/oranges)
    let r = lerp(0x3a, 0xcf, t);
    let g = lerp(0x5a, 0xd6, t);
    let b = lerp(0x74, 0xe0, t);
    if (y >= groundY) {
      r = 0x8a;
      g = 0x74;
      b = 0x5a;
    }
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
      buf[o + 3] = 0xff;
    }
  }
  writeFileSync(join(arcade, 'backdrop.png'), encodePng(W, H, buf));
  console.log('wrote levels/arcade/backdrop.png');
}

// --- sprite: transparent 128 png, a teal face (custom emoji skin) ---
function sprite() {
  const S = 128;
  const buf = Buffer.alloc(S * S * 4); // transparent
  const cx = S / 2;
  const cy = S / 2;
  const R = 58;
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const o = (y * S + x) * 4;
    buf[o] = r;
    buf[o + 1] = g;
    buf[o + 2] = b;
    buf[o + 3] = 0xff;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (Math.hypot(x - cx, y - cy) <= R) put(x, y, 0x6f, 0xc7, 0xd6);
    }
  }
  // eyes
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if (Math.hypot(x - (cx - 20), y - (cy - 12)) <= 8) put(x, y, 0x12, 0x2a, 0x33);
      if (Math.hypot(x - (cx + 20), y - (cy - 12)) <= 8) put(x, y, 0x12, 0x2a, 0x33);
    }
  // smile (arc band)
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - cx, y - (cy - 6));
      if (d >= 26 && d <= 32 && y > cy + 4) put(x, y, 0x12, 0x2a, 0x33);
    }
  writeFileSync(join(arcade, 'sprites', 'blip.png'), encodePng(S, S, buf));
  console.log('wrote levels/arcade/sprites/blip.png');
}

backdrop();
sprite();
