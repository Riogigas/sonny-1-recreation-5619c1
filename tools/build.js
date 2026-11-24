// Build step: converts the original SWF into data the JS runtime can load.
//   node tools/build.js <swf>
// Outputs game/data/movie.json, game/snd/*.mp3, game/img/*.png
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parseSwf } = require('./swf.js');

const ROOT = path.resolve(__dirname, '..');
const swfPath = process.argv[2] || path.join(ROOT, 'uploads', 'f616dd60-9405-45fa-8658-68be5564e862.swf');
const OUT = path.join(ROOT, 'game');
for (const d of ['data', 'snd', 'img']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

const movie = parseSwf(swfPath);

// ---- sounds (all MP3 in this movie) ----
for (const id in movie.sounds) {
  const s = movie.sounds[id];
  if (s.format === 2) {
    fs.writeFileSync(path.join(OUT, 'snd', id + '.mp3'), s.data.subarray(2));
    movie.chars[id].src = 'snd/' + id + '.mp3';
    movie.chars[id].seek = s.data.readInt16LE(0);
  } else {
    console.warn('sound format not supported', id, s.format);
  }
}

// ---- streaming sounds (timeline-synced MP3) ----
for (const id in movie.chars) {
  const c = movie.chars[id];
  const st = c.$stream;
  if (!st) continue;
  fs.writeFileSync(path.join(OUT, 'snd', 'stream_' + id + '.mp3'), Buffer.concat(st.chunks));
  c.stream = { src: 'snd/stream_' + id + '.mp3', rate: st.rate, seek0: st.seek0, samples: st.samples };
}

// ---- bitmaps ----
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const id in movie.bitmaps) {
  const b = movie.bitmaps[id];
  const out = Buffer.alloc(b.w * b.h * 4);
  if (b.format === 5) {
    for (let i = 0; i < b.w * b.h; i++) {
      const a = b.alpha ? b.data[i * 4] : 255; let r = b.data[i * 4 + 1], g = b.data[i * 4 + 2], bl = b.data[i * 4 + 3];
      if (b.alpha && a > 0 && a < 255) { r = Math.min(255, Math.round(r * 255 / a)); g = Math.min(255, Math.round(g * 255 / a)); bl = Math.min(255, Math.round(bl * 255 / a)); }
      out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = bl; out[i * 4 + 3] = a;
    }
  } else if (b.format === 3) {
    const cs = b.alpha ? 4 : 3; const pal = b.data.subarray(0, b.ct * cs); const pix = b.data.subarray(b.ct * cs);
    const stride = (b.w + 3) & ~3;
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      const idx = pix[y * stride + x]; const o = (y * b.w + x) * 4;
      out[o] = pal[idx * cs]; out[o + 1] = pal[idx * cs + 1]; out[o + 2] = pal[idx * cs + 2]; out[o + 3] = b.alpha ? pal[idx * cs + 3] : 255;
      if (b.alpha && out[o + 3] > 0 && out[o + 3] < 255) for (let k = 0; k < 3; k++) out[o + k] = Math.min(255, Math.round(out[o + k] * 255 / out[o + 3]));
    }
  } else { console.warn('bitmap format', b.format); continue; }
  fs.writeFileSync(path.join(OUT, 'img', id + '.png'), png(b.w, b.h, out));
  movie.chars[id].src = 'img/' + id + '.png';
}

const data = { w: movie.w, h: movie.h, fps: movie.fps, bg: movie.bg, chars: movie.chars, exports: movie.exports, root: movie.root };
fs.writeFileSync(path.join(OUT, 'data', 'movie.json'), JSON.stringify(data));
console.log('movie.json', (fs.statSync(path.join(OUT, 'data', 'movie.json')).size / 1024).toFixed(0) + 'KB');
