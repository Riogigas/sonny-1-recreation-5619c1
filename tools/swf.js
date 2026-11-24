// Minimal SWF (v8, AVM1) parser used at build time to extract the game's
// display-list data, vector shapes, fonts, bitmaps and sounds.
'use strict';
const zlib = require('zlib');

class Reader {
  constructor(buf, pos = 0, end = buf.length) {
    this.buf = buf; this.pos = pos; this.end = end; this.bitPos = 0; this.bitBuf = 0;
  }
  align() { this.bitPos = 0; }
  u8() { this.align(); return this.buf[this.pos++]; }
  u16() { this.align(); const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v; }
  s16() { this.align(); const v = this.buf.readInt16LE(this.pos); this.pos += 2; return v; }
  u32() { this.align(); const v = this.buf.readUInt32LE(this.pos); this.pos += 4; return v; }
  f32() { this.align(); const v = this.buf.readFloatLE(this.pos); this.pos += 4; return v; }
  fixed() { this.align(); const v = this.buf.readInt32LE(this.pos) / 65536; this.pos += 4; return v; }
  fixed8() { this.align(); const v = this.buf.readInt16LE(this.pos) / 256; this.pos += 2; return v; }
  bytes(n) { this.align(); const b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  str() {
    this.align();
    let e = this.pos; while (this.buf[e] !== 0) e++;
    const s = this.buf.toString('utf8', this.pos, e); this.pos = e + 1; return s;
  }
  ub(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      if (this.bitPos === 0) { this.bitBuf = this.buf[this.pos++]; this.bitPos = 8; }
      this.bitPos--;
      v = (v * 2) + ((this.bitBuf >> this.bitPos) & 1);
    }
    return v;
  }
  sb(n) {
    if (n === 0) return 0;
    const v = this.ub(n);
    const sign = Math.pow(2, n - 1);
    return v >= sign ? v - sign * 2 : v;
  }
  fb(n) { return this.sb(n) / 65536; }
  rect() {
    this.align();
    const n = this.ub(5);
    const r = [this.sb(n), this.sb(n), this.sb(n), this.sb(n)]; // xmin,xmax,ymin,ymax (twips)
    this.align();
    return r;
  }
  matrix() {
    this.align();
    let a = 1, b = 0, c = 0, d = 1;
    if (this.ub(1)) { const n = this.ub(5); a = this.fb(n); d = this.fb(n); }
    if (this.ub(1)) { const n = this.ub(5); b = this.fb(n); c = this.fb(n); }
    const n = this.ub(5); const tx = this.sb(n), ty = this.sb(n);
    this.align();
    return [a, b, c, d, tx, ty]; // tx,ty in twips
  }
  cxform(alpha) {
    this.align();
    const hasAdd = this.ub(1), hasMult = this.ub(1), n = this.ub(4);
    const t = [1, 1, 1, 1, 0, 0, 0, 0];
    if (hasMult) { t[0] = this.sb(n) / 256; t[1] = this.sb(n) / 256; t[2] = this.sb(n) / 256; if (alpha) t[3] = this.sb(n) / 256; }
    if (hasAdd) { t[4] = this.sb(n); t[5] = this.sb(n); t[6] = this.sb(n); if (alpha) t[7] = this.sb(n); }
    this.align();
    return t;
  }
  rgb() { return [this.u8(), this.u8(), this.u8(), 255]; }
  rgba() { return [this.u8(), this.u8(), this.u8(), this.u8()]; }
}

function readTags(r, end) {
  const tags = [];
  while (r.pos < end) {
    const h = r.u16();
    const code = h >> 6; let len = h & 0x3f;
    if (len === 0x3f) len = r.u32();
    const start = r.pos;
    tags.push({ code, start, len });
    r.pos = start + len;
    if (code === 0) break;
  }
  return tags;
}

// ---------------- shapes ----------------
function readFillStyle(r, ver) {
  const type = r.u8();
  if (type === 0x00) return { t: 's', c: ver >= 3 ? r.rgba() : r.rgb() };
  if (type === 0x10 || type === 0x12 || type === 0x13) {
    const m = r.matrix();
    r.align();
    const spread = r.ub(2), interp = r.ub(2), n = r.ub(4);
    const stops = [];
    for (let i = 0; i < n; i++) { const ratio = r.u8(); const c = ver >= 3 ? r.rgba() : r.rgb(); stops.push([ratio / 255, ...c]); }
    const g = { t: type === 0x10 ? 'l' : 'r', m: [m[0], m[1], m[2], m[3], m[4] / 20, m[5] / 20], stops, spread, interp };
    if (type === 0x13) g.focal = r.fixed8();
    return g;
  }
  if (type >= 0x40 && type <= 0x43) {
    const id = r.u16(); const m = r.matrix();
    return { t: 'b', id, m: [m[0] / 20, m[1] / 20, m[2] / 20, m[3] / 20, m[4] / 20, m[5] / 20], repeat: !(type & 1), smooth: !(type & 2) };
  }
  throw new Error('Unknown fill style ' + type);
}
function readFillStyles(r, ver) {
  let n = r.u8(); if (n === 0xff && ver >= 2) n = r.u16();
  const a = []; for (let i = 0; i < n; i++) a.push(readFillStyle(r, ver)); return a;
}
function readLineStyles(r, ver) {
  let n = r.u8(); if (n === 0xff && ver >= 2) n = r.u16();
  const a = [];
  for (let i = 0; i < n; i++) {
    const w = r.u16();
    if (ver === 4) {
      r.align();
      const startCap = r.ub(2), join = r.ub(2), hasFill = r.ub(1), noH = r.ub(1), noV = r.ub(1), hint = r.ub(1);
      r.ub(5); const noClose = r.ub(1), endCap = r.ub(2);
      let miter = 3;
      if (join === 2) miter = r.fixed8();
      const ls = { w: w / 20, cap: startCap, join, miter, noScale: !!(noH || noV) };
      if (hasFill) { const f = readFillStyle(r, ver); ls.fill = f; ls.c = f.t === 's' ? f.c : (f.stops ? f.stops[0].slice(1) : [0, 0, 0, 255]); }
      else ls.c = r.rgba();
      a.push(ls);
    } else {
      a.push({ w: w / 20, c: ver >= 3 ? r.rgba() : r.rgb(), cap: 0, join: 0 });
    }
  }
  return a;
}

function fmt(v) { return +(v / 20).toFixed(2); }

// Converts SWF edge records into ordered draw commands [{f:fillStyle,d:path}|{l:lineStyle,d:path}]
function readShapeRecords(r, ver, fillStyles, lineStyles, isGlyph) {
  r.align();
  let nFill = r.ub(4), nLine = r.ub(4);
  let x = 0, y = 0;
  let fill0 = 0, fill1 = 0, line = 0;
  const groups = [];
  let cur = newGroup(fillStyles, lineStyles);
  function newGroup(fs, ls) { return { fs, ls, fillEdges: new Map(), lineEdges: new Map() }; }
  function addEdge(e) {
    if (fill1) push(cur.fillEdges, fill1, e);
    if (fill0) push(cur.fillEdges, fill0, { x0: e.x1, y0: e.y1, x1: e.x0, y1: e.y0, cx: e.cx, cy: e.cy, q: e.q });
    if (line) push(cur.lineEdges, line, e);
  }
  function push(map, k, e) { let a = map.get(k); if (!a) map.set(k, a = []); a.push(e); }
  for (;;) {
    const type = r.ub(1);
    if (!type) {
      const newStyles = r.ub(1), lineS = r.ub(1), fs1 = r.ub(1), fs0 = r.ub(1), moveTo = r.ub(1);
      if (!newStyles && !lineS && !fs1 && !fs0 && !moveTo) break;
      if (moveTo) { const n = r.ub(5); x = r.sb(n); y = r.sb(n); }
      if (fs0) fill0 = r.ub(nFill);
      if (fs1) fill1 = r.ub(nFill);
      if (lineS) line = r.ub(nLine);
      if (newStyles) {
        groups.push(cur);
        const fs = readFillStyles(r, ver); const ls = readLineStyles(r, ver);
        cur = newGroup(fs, ls);
        r.align(); nFill = r.ub(4); nLine = r.ub(4);
      }
    } else {
      const straight = r.ub(1); const n = r.ub(4) + 2;
      if (straight) {
        let dx = 0, dy = 0;
        if (r.ub(1)) { dx = r.sb(n); dy = r.sb(n); }
        else if (r.ub(1)) dy = r.sb(n); else dx = r.sb(n);
        addEdge({ x0: x, y0: y, x1: x + dx, y1: y + dy });
        x += dx; y += dy;
      } else {
        const cdx = r.sb(n), cdy = r.sb(n), adx = r.sb(n), ady = r.sb(n);
        const cx = x + cdx, cy = y + cdy, ax = cx + adx, ay = cy + ady;
        addEdge({ x0: x, y0: y, x1: ax, y1: ay, cx, cy, q: true });
        x = ax; y = ay;
      }
    }
  }
  groups.push(cur);
  const cmds = [];
  for (const g of groups) {
    const fkeys = [...g.fillEdges.keys()].sort((a, b) => a - b);
    for (const k of fkeys) {
      const d = buildFillPath(g.fillEdges.get(k));
      if (!d) continue;
      if (isGlyph) cmds.push({ f: 1, d });
      else cmds.push({ f: g.fs[k - 1], d });
    }
    const lkeys = [...g.lineEdges.keys()].sort((a, b) => a - b);
    for (const k of lkeys) {
      const d = buildLinePath(g.lineEdges.get(k));
      if (d && g.ls[k - 1]) cmds.push({ l: g.ls[k - 1], d });
    }
  }
  return cmds;
}

function seg(e) { return e.q ? `Q${fmt(e.cx)} ${fmt(e.cy)} ${fmt(e.x1)} ${fmt(e.y1)}` : `L${fmt(e.x1)} ${fmt(e.y1)}`; }

function buildFillPath(edges) {
  const byStart = new Map();
  const used = new Array(edges.length).fill(false);
  edges.forEach((e, i) => { const k = e.x0 + ',' + e.y0; let a = byStart.get(k); if (!a) byStart.set(k, a = []); a.push(i); });
  let d = '';
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let e = edges[i];
    const sx = e.x0, sy = e.y0;
    d += `M${fmt(sx)} ${fmt(sy)}` + seg(e);
    let guard = 0;
    while (!(e.x1 === sx && e.y1 === sy) && guard++ < 100000) {
      const a = byStart.get(e.x1 + ',' + e.y1);
      let next = -1;
      if (a) { while (a.length) { const j = a.pop(); if (!used[j]) { next = j; break; } } }
      if (next < 0) break;
      used[next] = true; e = edges[next];
      d += seg(e);
    }
    d += 'Z';
  }
  return d;
}

function buildLinePath(edges) {
  let d = ''; let px = null, py = null;
  for (const e of edges) {
    if (e.x0 !== px || e.y0 !== py) d += `M${fmt(e.x0)} ${fmt(e.y0)}`;
    d += seg(e); px = e.x1; py = e.y1;
  }
  return d;
}

function parseShape(r, code) {
  const ver = code === 2 ? 1 : code === 22 ? 2 : code === 32 ? 3 : 4;
  const id = r.u16();
  const b = r.rect();
  if (ver === 4) { r.rect(); r.u8(); }
  const fs = readFillStyles(r, ver); const ls = readLineStyles(r, ver);
  const cmds = readShapeRecords(r, ver, fs, ls, false);
  return { id, c: { t: 'shape', b: [b[0] / 20, b[2] / 20, b[1] / 20, b[3] / 20], cmds } };
}

// ---------------- filters ----------------
function readFilters(r) {
  const n = r.u8(); const list = [];
  for (let i = 0; i < n; i++) {
    const id = r.u8();
    if (id === 0) { // drop shadow
      const c = r.rgba(); const bx = r.fixed(), by = r.fixed(), angle = r.fixed(), dist = r.fixed(), str = r.fixed8(); const fl = r.u8();
      list.push({ t: 'shadow', c, bx, by, angle, dist, str, inner: !!(fl & 0x80), knockout: !!(fl & 0x40), hide: !(fl & 0x20) && false, passes: fl & 0x1f });
    } else if (id === 1) {
      const bx = r.fixed(), by = r.fixed(); const fl = r.u8();
      list.push({ t: 'blur', bx, by, passes: fl >> 3 });
    } else if (id === 2) {
      const c = r.rgba(); const bx = r.fixed(), by = r.fixed(), str = r.fixed8(); const fl = r.u8();
      list.push({ t: 'glow', c, bx, by, str, inner: !!(fl & 0x80), knockout: !!(fl & 0x40), passes: fl & 0x1f });
    } else if (id === 3) {
      const c1 = r.rgba(), c2 = r.rgba(); const bx = r.fixed(), by = r.fixed(), angle = r.fixed(), dist = r.fixed(), str = r.fixed8(); const fl = r.u8();
      list.push({ t: 'bevel', c1, c2, bx, by, angle, dist, str, fl });
    } else if (id === 4 || id === 7) {
      const nc = r.u8(); const cols = []; for (let j = 0; j < nc; j++) cols.push(r.rgba());
      const ratios = []; for (let j = 0; j < nc; j++) ratios.push(r.u8());
      const bx = r.fixed(), by = r.fixed(), angle = r.fixed(), dist = r.fixed(), str = r.fixed8(); const fl = r.u8();
      list.push({ t: id === 4 ? 'gglow' : 'gbevel', cols, ratios, bx, by, angle, dist, str, fl });
    } else if (id === 5) {
      const mx = r.u8(), my = r.u8(); const div = r.f32(), bias = r.f32(); const m = []; for (let j = 0; j < mx * my; j++) m.push(r.f32());
      const c = r.rgba(); const fl = r.u8();
      list.push({ t: 'conv', mx, my, div, bias, m, c, fl });
    } else if (id === 6) {
      const m = []; for (let j = 0; j < 20; j++) m.push(r.f32());
      list.push({ t: 'cmatrix', m });
    } else throw new Error('bad filter ' + id);
  }
  return list;
}

const CLIP_EVENTS = [
  // byte0
  ['keyUp', 0x80, 0], ['keyDown', 0x40, 0], ['mouseUp', 0x20, 0], ['mouseDown', 0x10, 0], ['mouseMove', 0x08, 0], ['unload', 0x04, 0], ['enterFrame', 0x02, 0], ['load', 0x01, 0],
  // byte1
  ['dragOver', 0x80, 1], ['rollOut', 0x40, 1], ['rollOver', 0x20, 1], ['releaseOutside', 0x10, 1], ['release', 0x08, 1], ['press', 0x04, 1], ['initialize', 0x02, 1], ['data', 0x01, 1],
  // byte2
  ['construct', 0x04, 2], ['keyPress', 0x02, 2], ['dragOut', 0x01, 2],
];

function readClipActions(r) {
  r.u16(); r.u32();
  const recs = [];
  for (;;) {
    const b = [r.u8(), r.u8(), r.u8(), r.u8()];
    if (!b[0] && !b[1] && !b[2] && !b[3]) break;
    const size = r.u32();
    const end = r.pos + size;
    const ev = CLIP_EVENTS.filter(([n, m, i]) => b[i] & m).map(x => x[0]);
    let key;
    if (b[2] & 0x02) { key = r.u8(); }
    recs.push({ ev, key });
    r.pos = end;
  }
  return recs;
}

function parsePlace(r, code, end) {
  if (code === 4) {
    const id = r.u16(), depth = r.u16(); const m = r.matrix();
    const o = { op: 'place', depth, id, m: tw(m) };
    if (r.pos < end) o.cx = r.cxform(false);
    return o;
  }
  const f = r.u8(); let f2 = 0;
  if (code === 70) f2 = r.u8();
  const o = { op: 'place', depth: r.u16() };
  if (f & 0x01) o.move = true;
  if (code === 70 && ((f2 & 0x08) || ((f2 & 0x10) && (f & 0x02)))) o.cls = r.str();
  if (f & 0x02) o.id = r.u16();
  if (f & 0x04) o.m = tw(r.matrix());
  if (f & 0x08) o.cx = r.cxform(true);
  if (f & 0x10) o.ratio = r.u16();
  if (f & 0x20) o.name = r.str();
  if (f & 0x40) o.clip = r.u16();
  if (code === 70) {
    if (f2 & 0x01) o.filters = readFilters(r);
    if (f2 & 0x02) o.blend = r.u8();
    if (f2 & 0x04) o.cache = r.u8();
    if (f2 & 0x20) { o.vis = r.u8(); r.rgba(); }
  }
  if (f & 0x80) o.actions = readClipActions(r);
  return o;
}
function tw(m) { return [m[0], m[1], m[2], m[3], m[4] / 20, m[5] / 20]; }

function readSoundInfo(r) {
  const f = r.u8();
  const info = { stop: !!(f & 0x20), noMulti: !!(f & 0x10) };
  if (f & 0x01) info.inPoint = r.u32();
  if (f & 0x02) info.outPoint = r.u32();
  if (f & 0x04) info.loops = r.u16();
  if (f & 0x08) { const n = r.u8(); info.env = []; for (let i = 0; i < n; i++) info.env.push([r.u32(), r.u16(), r.u16()]); }
  return info;
}

function parseTimeline(r, tags, ctx, spriteId) {
  const frames = [[]]; const labels = {};
  let fi = 0; let actionIdx = 0; let stream = null;
  for (const t of tags) {
    r.pos = t.start; const end = t.start + t.len;
    const fr = frames[fi];
    switch (t.code) {
      case 18: case 45: {
        r.u8(); const fmt = r.u8(); const per = r.u16();
        stream = { format: fmt >> 4, rate: [5512.5, 11025, 22050, 44100][(fmt >> 2) & 3], stereo: !!(fmt & 1), per, chunks: [], samples: 0, seek0: 0 };
        break;
      }
      case 19: {
        if (stream && stream.format === 2 && t.len > 4) {
          const sc = r.buf.readUInt16LE(t.start), seek = r.buf.readInt16LE(t.start + 2);
          if (!stream.chunks.length) stream.seek0 = seek;
          fr.push({ op: 'stream', t: stream.samples });
          stream.chunks.push(r.buf.subarray(t.start + 4, end));
          stream.samples += sc;
        }
        break;
      }
      case 1: frames.push([]); fi++; actionIdx = 0; break;
      case 4: case 26: case 70: fr.push(parsePlace(r, t.code, end)); break;
      case 5: r.u16(); fr.push({ op: 'remove', depth: r.u16() }); break;
      case 28: fr.push({ op: 'remove', depth: r.u16() }); break;
      case 12: {
        const a = { op: 'action', idx: actionIdx++ };
        if (t.len > 3 && r.buf[t.start] === 0x88) {
          const n = r.buf.readUInt16LE(t.start + 3); let p = t.start + 5; const pool = [];
          for (let i = 0; i < n && p < end; i++) { let e = p; while (r.buf[e] !== 0) e++; pool.push(r.buf.toString('utf8', p, e)); p = e + 1; }
          Object.defineProperty(a, 'pool', { value: pool, enumerable: false });
        }
        Object.defineProperty(a, 'size', { value: t.len, enumerable: false });
        fr.push(a); break;
      }
      case 43: labels[r.str()] = fi; break;
      case 15: { const id = r.u16(); fr.push({ op: 'sound', id, info: readSoundInfo(r) }); break; }
      case 89: break;
      case 0: break;
      default:
        if (ctx) ctx.handle(t, r);
    }
  }
  if (frames.length > 1 && frames[frames.length - 1].length === 0) frames.pop();
  return { frames, labels, stream: stream && stream.chunks.length ? stream : null };
}

function parseButton2(r, end) {
  const id = r.u16(); const flags = r.u8(); const actOff = r.u16();
  const actStart = actOff ? r.pos - 2 + actOff : end;
  const records = [];
  for (;;) {
    const f = r.u8(); if (!f) break;
    const rec = { states: f & 0x0f, id: r.u16(), depth: r.u16(), m: tw(r.matrix()), cx: r.cxform(true) };
    if (f & 0x10) rec.filters = readFilters(r);
    if (f & 0x20) rec.blend = r.u8();
    records.push(rec);
  }
  const conds = [];
  if (actOff) {
    r.pos = actStart;
    for (;;) {
      const size = r.u16(); const c = r.u16();
      const b0 = c & 0xff, b1 = c >> 8; // little endian: first byte = low
      const ev = [];
      if (b0 & 0x80) ev.push('idleToOverDown');
      if (b0 & 0x40) ev.push('releaseOutside');
      if (b0 & 0x20) ev.push('dragOver');
      if (b0 & 0x10) ev.push('dragOut');
      if (b0 & 0x08) ev.push('release');
      if (b0 & 0x04) ev.push('press');
      if (b0 & 0x02) ev.push('rollOut');
      if (b0 & 0x01) ev.push('rollOver');
      if (b1 & 0x01) ev.push('overDownToIdle');
      const key = b1 >> 1;
      conds.push({ ev, key: key || undefined });
      if (!size) break;
      r.pos = r.pos - 4 + size;
    }
  }
  return { id, c: { t: 'button', menu: !!(flags & 1), records, conds } };
}

function parseEditText(r) {
  const id = r.u16(); const b = r.rect();
  const f1 = r.u8(), f2 = r.u8();
  const o = { t: 'edit', b: [b[0] / 20, b[2] / 20, b[1] / 20, b[3] / 20] };
  if (f1 & 0x01) o.font = r.u16();
  if (f2 & 0x80) o.fontClass = r.str();
  if (f1 & 0x01) o.size = r.u16() / 20;
  if (f1 & 0x04) o.color = r.rgba();
  if (f1 & 0x02) o.maxLen = r.u16();
  if (f2 & 0x20) { o.align = r.u8(); o.lm = r.u16() / 20; o.rm = r.u16() / 20; o.indent = r.u16() / 20; o.leading = r.s16() / 20; }
  o.v = r.str();
  if (f1 & 0x80) o.text = r.str();
  o.wrap = !!(f1 & 0x40); o.multi = !!(f1 & 0x20); o.pass = !!(f1 & 0x10); o.ro = !!(f1 & 0x08);
  o.auto = !!(f2 & 0x40); o.nosel = !!(f2 & 0x10); o.border = !!(f2 & 0x08); o.html = !!(f2 & 0x02); o.outlines = !!(f2 & 0x01);
  return { id, c: o };
}

function parseText(r, code) {
  const id = r.u16(); const b = r.rect(); const m = tw(r.matrix());
  const gb = r.u8(), ab = r.u8();
  const recs = []; let cur = { font: 0, color: [0, 0, 0, 255], x: 0, y: 0, size: 12 };
  for (;;) {
    const f = r.u8(); if (!f) break;
    if (f & 0x08) cur.font = r.u16();
    if (f & 0x04) cur.color = code === 33 ? r.rgba() : r.rgb();
    if (f & 0x01) cur.x = r.s16() / 20;
    if (f & 0x02) cur.y = r.s16() / 20;
    if (f & 0x08) cur.size = r.u16() / 20;
    const n = r.u8(); const glyphs = [];
    for (let i = 0; i < n; i++) glyphs.push([r.ub(gb), r.sb(ab) / 20]);
    r.align();
    recs.push({ font: cur.font, color: cur.color.slice(), x: cur.x, y: cur.y, size: cur.size, glyphs });
    let adv = 0; for (const g of glyphs) adv += g[1]; cur.x += adv;
  }
  return { id, c: { t: 'stext', b: [b[0] / 20, b[2] / 20, b[1] / 20, b[3] / 20], m, recs } };
}

function parseFont(r, code, end) {
  const id = r.u16(); const f = r.u8(); r.u8();
  const nameLen = r.u8(); const name = r.bytes(nameLen).toString('utf8').replace(/\0+$/, '');
  const n = r.u16();
  const wideOff = !!(f & 0x08), wideCodes = !!(f & 0x04);
  const tableStart = r.pos;
  const offs = []; for (let i = 0; i < n; i++) offs.push(wideOff ? r.u32() : r.u16());
  const codeOff = n ? (wideOff ? r.u32() : r.u16()) : 0;
  const glyphs = [];
  for (let i = 0; i < n; i++) {
    r.pos = tableStart + offs[i];
    const cmds = readShapeRecords(r, 1, [], [], true);
    glyphs.push(cmds.map(c => c.d).join(''));
  }
  const font = { t: 'font', name, bold: !!(f & 1), italic: !!(f & 2), scale: code === 75 ? 20 : 1, glyphs, codes: [], adv: [] };
  if (n) {
    r.pos = tableStart + codeOff;
    for (let i = 0; i < n; i++) font.codes.push(wideCodes ? r.u16() : r.u8());
  }
  if (f & 0x80) {
    font.ascent = r.u16(); font.descent = r.u16(); font.leading = r.s16();
    for (let i = 0; i < n; i++) font.adv.push(r.s16());
  }
  return { id, c: font };
}

function parseSwf(file) {
  let buf = require('fs').readFileSync(file);
  const sig = buf.toString('ascii', 0, 3);
  if (sig === 'CWS') buf = Buffer.concat([buf.subarray(0, 8), zlib.inflateSync(buf.subarray(8))]);
  const r = new Reader(buf, 8);
  const rect = r.rect();
  const fps = r.u16() / 256; const frameCount = r.u16();
  const movie = { w: (rect[1] - rect[0]) / 20, h: (rect[3] - rect[2]) / 20, fps, frameCount, bg: [255, 255, 255], chars: {}, exports: {}, sounds: {}, bitmaps: {} };
  const tags = readTags(r, buf.length);
  const ctx = {
    handle(t, r) {
      const end = t.start + t.len;
      switch (t.code) {
        case 9: movie.bg = r.rgb(); break;
        case 2: case 22: case 32: case 83: { const s = parseShape(r, t.code); movie.chars[s.id] = s.c; break; }
        case 39: {
          const id = r.u16(); const fc = r.u16();
          const sub = readTags(r, end);
          const tl = parseTimeline(r, sub, null, id);
          while (tl.frames.length < fc) tl.frames.push([]);
          movie.chars[id] = { t: 'sprite', n: fc, frames: tl.frames, labels: tl.labels };
          if (tl.stream) Object.defineProperty(movie.chars[id], '$stream', { value: tl.stream, enumerable: false });
          break;
        }
        case 34: { const b = parseButton2(r, end); movie.chars[b.id] = b.c; break; }
        case 37: { const e = parseEditText(r); movie.chars[e.id] = e.c; break; }
        case 11: case 33: { const s = parseText(r, t.code); movie.chars[s.id] = s.c; break; }
        case 48: case 75: { const f = parseFont(r, t.code, end); movie.chars[f.id] = f.c; break; }
        case 56: { const n = r.u16(); for (let i = 0; i < n; i++) { const id = r.u16(); movie.exports[r.str()] = id; } break; }
        case 14: {
          const id = r.u16(); const b = r.u8(); const samples = r.u32();
          const format = b >> 4, rate = [5512, 11025, 22050, 44100][(b >> 2) & 3], is16 = (b >> 1) & 1, stereo = b & 1;
          const data = buf.subarray(r.pos, end);
          movie.sounds[id] = { format, rate, is16, stereo, samples, data };
          movie.chars[id] = { t: 'sound', format, rate, stereo, samples };
          break;
        }
        case 20: case 36: {
          const id = r.u16(); const fmtb = r.u8(); const w = r.u16(), h = r.u16();
          let ct = 0; if (fmtb === 3) ct = r.u8() + 1;
          const data = zlib.inflateSync(buf.subarray(r.pos, end));
          movie.bitmaps[id] = { format: fmtb, w, h, ct, alpha: t.code === 36, data };
          movie.chars[id] = { t: 'bitmap', w, h };
          break;
        }
        case 6: case 21: case 35: case 90: {
          const id = r.u16(); movie.chars[id] = { t: 'bitmap', unsupported: true };
          console.warn('JPEG bitmap not handled', id); break;
        }
        case 46: case 84: console.warn('morph shape not handled'); break;
        case 69: case 77: case 73: case 74: case 88: case 24: case 13: case 62: case 18: case 19: case 45: case 8: break;
        default: console.warn('unhandled tag', t.code);
      }
    }
  };
  const tl = parseTimeline(r, tags, ctx, 0);
  movie.root = { t: 'sprite', n: frameCount, frames: tl.frames, labels: tl.labels };
  while (movie.root.frames.length < frameCount) movie.root.frames.push([]);
  return movie;
}

module.exports = { parseSwf, Reader };
