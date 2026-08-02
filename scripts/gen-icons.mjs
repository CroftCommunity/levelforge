/* Generate the PWA PNG icons with no external deps.
   Draws a full-bleed brand background with the on-brand orange triangle mark
   (the 'tri' shape), plus a rounded-square favicon-friendly variant. Run with:
     node scripts/gen-icons.mjs
   Outputs public/icons/icon-192.png and icon-512.png. */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const BG = [0x16, 0x21, 0x2f]; // --panel
const TRI = [0xff, 0x8a, 0x3d]; // --accent
const LINE = [0x23, 0x33, 0x48];

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
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function pointInTri(px, py, ax, ay, bx, by, cx, cy) {
  const s = (x1, y1, x2, y2) => (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  const d1 = s(ax, ay, bx, by);
  const d2 = s(bx, by, cx, cy);
  const d3 = s(cx, cy, ax, ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function makePng(size) {
  const rowBytes = size * 4;
  const raw = Buffer.alloc((rowBytes + 1) * size);
  const r = size * 0.62;
  const cx = size / 2;
  // isoceles wedge, apex up, centroid-centred (matches the app's triVerts)
  const w = r;
  const h = r * 0.9;
  const cy = size / 2 + h * 0.15;
  const ax = cx - w / 2;
  const ay = cy + h / 3;
  const bx = cx + w / 2;
  const by = cy + h / 3;
  const tx = cx;
  const ty = cy - (2 * h) / 3;
  for (let y = 0; y < size; y++) {
    raw[y * (rowBytes + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let col = BG;
      // subtle inner border ring for definition
      const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
      if (edge < size * 0.03) col = LINE;
      if (pointInTri(x + 0.5, y + 0.5, ax, ay, bx, by, tx, ty)) col = TRI;
      const off = y * (rowBytes + 1) + 1 + x * 4;
      raw[off] = col[0];
      raw[off + 1] = col[1];
      raw[off + 2] = col[2];
      raw[off + 3] = 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  writeFileSync(join(outDir, `icon-${size}.png`), makePng(size));
  console.log(`wrote icon-${size}.png`);
}
