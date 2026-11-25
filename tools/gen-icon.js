/**
 * Generates the application and tray icons without any image library.
 *
 * Draws a rounded-square gradient tile with a white cloud mark, then derives
 * PNG variants and a multi-resolution .ico container.
 *
 *   node tools/gen-icon.js
 *
 * Design notes (why it looks the way it does):
 *   - The cloud silhouette is a union of three discs that are all tangent to a
 *     single baseline, plus a capsule base. Tangency keeps the bottom edge
 *     perfectly flat, which is what reads as "cloud" at 16 px. The discs are
 *     merged with a smooth union so the shoulders flow into the crown instead
 *     of forming visible scallops.
 *   - The mark sits on its optical centre (~0.476 y), not the geometric one,
 *     so it does not look like it is sinking in the tile.
 *   - A soft shadow under the mark and a diagonal gradient keep the glyph
 *     separated from the sky blue, where white-on-blue contrast is weakest.
 *   - At 32 px and below the sheen, the rim light and most of the cloud tint
 *     are dropped, and the flat bottom and left edge are snapped onto whole
 *     device pixels: sub-pixel decoration only turns into grey mush there.
 *   - The .ico carries every size Windows can ask for, so the taskbar at
 *     125 / 150 / 200 % scaling gets a native bitmap instead of a resample.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'assets');

/* ---------------------------------------------------------------- helpers */

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(t) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
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

// Polynomial smooth minimum: unions shapes without leaving a visible crease
// where two circles cross over.
function smin(a, b, k) {
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return lerp(b, a, h) - k * h * (1 - h);
}

/* ------------------------------------------------------------- geometries */

// Tile covers the full canvas; Windows draws icons edge to edge and a margin
// only makes the button look undersized next to native apps.
const TILE = { cx: 0.5, cy: 0.5, hw: 0.5, hh: 0.5, r: 0.225 };

// Mark geometry. Every disc is tangent to BASELINE (cy + r === BASELINE), so
// the flat bottom comes out clean instead of scalloped.
const BASELINE = 0.672;
const MARK = {
  anchor: { x: 0.507, y: 0.476 },
  bbox: { left: 0.194 },
  base: { cx: 0.507, cy: 0.597, hw: 0.200, hh: 0.075, r: 0.075 },
  discs: [
    { cx: 0.322, cy: BASELINE - 0.128, r: 0.128 }, // left shoulder
    { cx: 0.492, cy: BASELINE - 0.196, r: 0.196 }, // crown
    { cx: 0.678, cy: BASELINE - 0.142, r: 0.142 }, // right shoulder
  ],
};

const BG_LIGHT = [70, 150, 249]; // sky, top-left
const BG_MID = [38, 122, 240];
const BG_DEEP = [10, 70, 186]; // deep sea, bottom-right
const CLOUD_TOP = [255, 255, 255];
const CLOUD_BOTTOM = [219, 233, 255];
// At 16–32 px the tinted bottom would read as grey, so the small variant keeps
// the mark almost pure white and lets the tile gradient carry the depth.
const CLOUD_SMALL_BOTTOM = [238, 245, 255];
const SHADOW = [7, 42, 112];

/**
 * SDF of the cloud mark, optionally scaled about its optical anchor.
 *
 * The discs are blended with a smooth union so the shoulders flow into the
 * crown instead of forming scallops, then the result is intersected with the
 * baseline half-plane to keep the bottom edge dead flat.
 */
function sdMark(px, py, scale, blend) {
  const ax = MARK.anchor.x;
  const ay = MARK.anchor.y;
  const x = ax + (px - ax) / scale;
  const y = ay + (py - ay) / scale;

  const base = sdRoundRect(x, y, MARK.base.cx, MARK.base.cy, MARK.base.hw, MARK.base.hh, MARK.base.r);
  const left = sdCircle(x, y, MARK.discs[0].cx, MARK.discs[0].cy, MARK.discs[0].r);
  const crown = sdCircle(x, y, MARK.discs[1].cx, MARK.discs[1].cy, MARK.discs[1].r);
  const right = sdCircle(x, y, MARK.discs[2].cx, MARK.discs[2].cy, MARK.discs[2].r);

  let d = smin(left, crown, blend);
  d = smin(d, right, blend);
  d = smin(d, base, blend * 0.6);
  d = Math.max(d, y - BASELINE); // clip the blending bulge: bottom stays flat

  // Scaling the field back to canvas units keeps edge softness constant.
  return d * scale;
}

/**
 * Renders one square RGBA tile at `size` px.
 *
 * `detail: false` is the small-size variant (16–32 px): no sheen, no rim,
 * tighter shadow, slightly larger mark.
 */
function renderTile(size, { detail = true } = {}) {
  // Small tiles need the most samples; big ones already have plenty of pixels.
  const ss = size <= 32 ? 8 : size <= 64 ? 6 : size <= 128 ? 4 : 2;
  const big = size * ss;
  const buf = new Float32Array(big * big * 4);

  const markScale = detail ? 1 : 0.98;
  const blend = detail ? 0.034 : 0.046;
  const shadowBlur = detail ? 0.050 : 0.032;
  const shadowAlpha = detail ? 0.18 : 0.17;
  const shadowOffset = detail ? 0.022 : 0.018;

  // Pixel snapping: at 16–32 px the flat bottom and the left edge are the two
  // dominant straight lines, so landing them on whole device pixels keeps the
  // mark crisp instead of grey. Bigger tiles are antialiased smoothly anyway.
  let snapX = 0;
  let snapY = 0;
  if (size <= 32) {
    const left = MARK.anchor.x + (MARK.bbox.left - MARK.anchor.x) * markScale;
    const bottom = MARK.anchor.y + (BASELINE - MARK.anchor.y) * markScale;
    snapX = (Math.round(left * size) - left * size) / size;
    snapY = (Math.round(bottom * size) - bottom * size) / size;
  }

  for (let y = 0; y < big; y++) {
    const py = (y + 0.5) / big;
    for (let x = 0; x < big; x++) {
      const px = (x + 0.5) / big;
      const i = (y * big + x) * 4;

      // --- background tile
      const dTile = sdRoundRect(px, py, TILE.cx, TILE.cy, TILE.hw, TILE.hh, TILE.r);
      const tileA = clamp01(0.5 - dTile * big);
      if (tileA <= 0) continue;

      // Diagonal gradient: reads as light coming from the top-left, which is
      // also where the sheen sits.
      const t = smoothstep((px * 0.26 + py * 0.92) / 1.18);
      let bg = t < 0.5
        ? mixColor(BG_LIGHT, BG_MID, smoothstep(t * 2))
        : mixColor(BG_MID, BG_DEEP, smoothstep((t - 0.5) * 2));

      if (detail) {
        // soft specular sheen around the light source
        const hl = clamp01(1 - Math.hypot(px - 0.27, py - 0.15) / 0.60);
        const sheen = smoothstep(hl) * 0.06;
        bg = mixColor(bg, [255, 255, 255], sheen);

        // 1 px inner rim on the upper edge only, for a sense of thickness
        const edge = clamp01(1 - -dTile / 0.011);
        const rim = edge * (1 - smoothstep((py - 0.30) / 0.45)) * 0.16;
        bg = mixColor(bg, [255, 255, 255], rim);
      }

      let r = bg[0];
      let g = bg[1];
      let b = bg[2];

      // --- shadow under the mark (sampled above the glyph, drawn below it)
      const dShadow = sdMark(px - snapX, py - shadowOffset - snapY, markScale, blend);
      const shadow = clamp01(0.5 - dShadow / (shadowBlur * 2)) * shadowAlpha;
      if (shadow > 0) {
        r = lerp(r, SHADOW[0], shadow);
        g = lerp(g, SHADOW[1], shadow);
        b = lerp(b, SHADOW[2], shadow);
      }

      // --- mark
      const dMark = sdMark(px - snapX, py - snapY, markScale, blend);
      const markA = clamp01(0.5 - dMark * big);
      if (markA > 0) {
        const cm = detail
          ? mixColor(CLOUD_TOP, CLOUD_BOTTOM, smoothstep((py - 0.29) / 0.40))
          : mixColor(CLOUD_TOP, CLOUD_SMALL_BOTTOM, smoothstep((py - 0.29) / 0.40));
        r = lerp(r, cm[0], markA);
        g = lerp(g, cm[1], markA);
        b = lerp(b, cm[2], markA);
      }

      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = 255 * tileA;
    }
  }

  return downsample(buf, big, size, ss);
}

function downsample(buf, big, size, ss) {
  const out = Buffer.alloc(size * size * 4);
  const n = ss * ss;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const i = ((y * ss + sy) * big + (x * ss + sx)) * 4;
          const pa = buf[i + 3] / 255;
          r += buf[i] * pa;
          g += buf[i + 1] * pa;
          b += buf[i + 2] * pa;
          a += buf[i + 3];
        }
      }
      const aAvg = a / n;
      const pa = aAvg / 255;
      const o = (y * size + x) * 4;
      // Un-premultiply so edge pixels keep their colour instead of going dark.
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
    dir[o + 2] = 0; // palette entries
    dir[o + 3] = 0; // reserved
    dir.writeUInt16LE(1, o + 4); // colour planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
    blobs.push(e.png);
  });

  return Buffer.concat([header, dir, ...blobs]);
}

/* ------------------------------------------------------------------ main */

// Every size Windows can ask for: 100 % taskbar (24/32), 125 % (30/40),
// 150 % (36/48), 200 % (48/64), plus alt-tab (64/128) and jumbo (256).
const ICO_SIZES = [16, 20, 24, 32, 36, 40, 48, 64, 96, 128, 256];

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const cache = new Map();
  const tile = (size) => {
    const key = `t${size}`;
    if (!cache.has(key)) cache.set(key, renderTile(size, { detail: size > 32 }));
    return cache.get(key);
  };

  // icon.png — window icon / Linux / store listings. 512 keeps it crisp when
  // Windows asks for large-shell renderings and when it is shown in docs.
  fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), encodePng(512, tile(512)));

  // tray.png — 32 px so it stays sharp at 200 % DPI; Windows scales it down to
  // the 16 px notification-area slot at 100 %.
  fs.writeFileSync(path.join(OUT_DIR, 'tray.png'), encodePng(32, renderTile(32, { detail: false })));

  const ico = encodeIco(ICO_SIZES.map((s) => ({ size: s, png: encodePng(s, tile(s)) })));
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico);

  console.log('assets/icon.png  512x512');
  console.log('assets/tray.png   32x32');
  console.log('assets/icon.ico  ' + ICO_SIZES.join(', '));
  console.log('assets/icon.ico  ' + (ico.length / 1024).toFixed(1) + ' KB');
}

if (require.main === module) main();

module.exports = { renderTile, encodePng, encodeIco, ICO_SIZES };
