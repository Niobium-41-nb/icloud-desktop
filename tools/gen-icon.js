/**
 * Generates the application and tray icons without any image library.
 *
 * Draws a rounded-square gradient tile with a white cloud mark, then derives
 * PNG variants and a multi-resolution .ico container.
 *
 *   node tools/gen-icon.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'assets');
const SS = 4; // supersampling factor

/* ------------------------------------------------------------------ shapes */

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Signed distance to a rounded rectangle centred in the unit square.
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.sqrt(ax * ax + ay * ay) - r;
}

function sdCircle(px, py, cx, cy, r) {
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy) - r;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(c1, c2, t) {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
  ];
}

/**
 * Renders one square RGBA tile at `size` px using SSx supersampling.
 */
function renderTile(size) {
  const big = size * SS;
  const buf = new Float32Array(big * big * 4);

  const TOP = [96, 173, 255];
  const BOTTOM = [22, 100, 224];
  const CLOUD_TOP = [255, 255, 255];
  const CLOUD_BOTTOM = [233, 242, 255];

  for (let y = 0; y < big; y++) {
    const py = (y + 0.5) / big;
    for (let x = 0; x < big; x++) {
      const px = (x + 0.5) / big;
      const i = (y * big + x) * 4;

      // --- background tile: rounded square with a vertical gradient
      const dTile = sdRoundRect(px, py, 0.5, 0.5, 0.5, 0.5, 0.225);
      const tileA = clamp01(0.5 - dTile * big * 0.55);
      if (tileA <= 0) continue;

      const t = py;
      const bg = mixColor(TOP, BOTTOM, t * t * 0.55 + t * 0.45);
      // subtle top-left highlight
      const hl = clamp01(1 - Math.hypot(px - 0.28, py - 0.2) * 1.7) * 0.10;
      let r = Math.min(255, bg[0] + 255 * hl);
      let g = Math.min(255, bg[1] + 255 * hl);
      let b = Math.min(255, bg[2] + 255 * hl);

      // --- cloud mark: union of three discs and a rounded base
      let dCloud = sdCircle(px, py, 0.365, 0.545, 0.135);
      dCloud = Math.min(dCloud, sdCircle(px, py, 0.545, 0.435, 0.195));
      dCloud = Math.min(dCloud, sdCircle(px, py, 0.700, 0.560, 0.120));
      dCloud = Math.min(dCloud, sdRoundRect(px, py, 0.512, 0.590, 0.245, 0.083, 0.083));
      const cloudA = clamp01(0.5 - dCloud * big * 0.55);

      if (cloudA > 0) {
        const cc = mixColor(CLOUD_TOP, CLOUD_BOTTOM, clamp01((py - 0.36) / 0.32));
        r = lerp(r, cc[0], cloudA);
        g = lerp(g, cc[1], cloudA);
        b = lerp(b, cc[2], cloudA);
      }

      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = 255 * tileA;
    }
  }

  // box-downsample
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * big + (x * SS + sx)) * 4;
          const pa = buf[i + 3] / 255;
          r += buf[i] * pa;
          g += buf[i + 1] * pa;
          b += buf[i + 2] * pa;
          a += buf[i + 3];
        }
      }
      const n = SS * SS;
      const aAvg = a / n;
      const pa = aAvg / 255;
      const o = (y * size + x) * 4;
      out[o] = pa > 0 ? Math.round(r / n / pa) : 0;
      out[o + 1] = pa > 0 ? Math.round(g / n / pa) : 0;
      out[o + 2] = pa > 0 ? Math.round(b / n / pa) : 0;
      out[o + 3] = Math.round(aAvg);
    }
  }
  return out;
}

/* ------------------------------------------------------------------- PNG */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------- ICO */

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  const blobs = [];

  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
    blobs.push(e.png);
  });

  return Buffer.concat([header, dir, ...blobs]);
}

/* ------------------------------------------------------------------ main */

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const sizes = [256, 128, 64, 48, 32, 24, 16];
  const rendered = new Map();
  for (const s of sizes) rendered.set(s, renderTile(s));

  const iconPath = path.join(OUT_DIR, 'icon.png');
  fs.writeFileSync(iconPath, encodePng(256, rendered.get(256)));

  const tray = path.join(OUT_DIR, 'tray.png');
  fs.writeFileSync(tray, encodePng(32, rendered.get(32)));

  const ico = encodeIco(sizes.map((s) => ({ size: s, png: encodePng(s, rendered.get(s)) })));
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico);

  console.log('assets/icon.png  256x256');
  console.log('assets/tray.png   32x32');
  console.log('assets/icon.ico  ' + sizes.join(', '));
}

main();
