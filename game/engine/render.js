// Canvas2D renderer for the display list (shapes, gradients, bitmaps, text, masks, filters).
'use strict';
(function () {
  const F = window.F;
  const { mul, inv, tBounds } = F.mat;
  const hctx = document.createElement('canvas').getContext('2d');
  const R = F.render = {};
  let images = {};
  R.images = images;

  const clamp = (v) => v < 0 ? 0 : v > 255 ? 255 : v;
  function rgba(c, cx) {
    let r = c[0], g = c[1], b = c[2], a = c[3] === undefined ? 255 : c[3];
    if (cx) { r = r * cx[0] + cx[4]; g = g * cx[1] + cx[5]; b = b * cx[2] + cx[6]; a = a * cx[3] + cx[7]; }
    return 'rgba(' + (clamp(r) | 0) + ',' + (clamp(g) | 0) + ',' + (clamp(b) | 0) + ',' + (clamp(a) / 255) + ')';
  }
  R.rgba = rgba;
  function catCx(p, c) {
    if (!c) return p; if (!p) return c;
    return [c[0] * p[0], c[1] * p[1], c[2] * p[2], c[3] * p[3], c[4] * p[0] + p[4], c[5] * p[1] + p[5], c[6] * p[2] + p[6], c[7] * p[3] + p[7]];
  }
  const dm = (m) => new DOMMatrix([m[0], m[1], m[2], m[3], m[4], m[5]]);
  const pathOf = (cmd) => cmd.path || (cmd.path = new Path2D(cmd.d));
  const setT = (ctx, m) => ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);

  function gradientFor(ctx, f, cx) {
    const key = cx ? cx.join(',') : '';
    if (f.$g && f.$gk === key) return f.$g;
    let g;
    if (f.t === 'l') g = ctx.createLinearGradient(-819.2, 0, 819.2, 0);
    else { const fo = (f.focal || 0) * 819.2; g = ctx.createRadialGradient(fo, 0, 0, 0, 0, 819.2); }
    let last = -1;
    for (const s of f.stops) { let r = Math.max(last, Math.min(1, s[0])); last = r; g.addColorStop(r, rgba([s[1], s[2], s[3], s[4]], cx)); }
    f.$g = g; f.$gk = key;
    return g;
  }
  function bitmapSource(id, cx) {
    const img = images[id];
    if (!img) return null;
    if (!cx || (cx[0] === 1 && cx[1] === 1 && cx[2] === 1 && !cx[4] && !cx[5] && !cx[6])) return img;
    const key = cx.slice(0, 3).concat(cx.slice(4, 7)).join(',');
    img.$tint = img.$tint || {};
    if (img.$tint[key]) return img.$tint[key];
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height); const p = d.data;
    for (let i = 0; i < p.length; i += 4) { p[i] = clamp(p[i] * cx[0] + cx[4]); p[i + 1] = clamp(p[i + 1] * cx[1] + cx[5]); p[i + 2] = clamp(p[i + 2] * cx[2] + cx[6]); }
    x.putImageData(d, 0, 0);
    const keys = Object.keys(img.$tint); if (keys.length > 16) delete img.$tint[keys[0]];
    return (img.$tint[key] = c);
  }

  function drawCmds(ctx, cmds, m, cx) {
    const sc = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    for (const cmd of cmds) {
      if (cmd.f) {
        const f = cmd.f;
        if (f.t === 's') {
          if (cx ? (f.c[3] * cx[3] + cx[7]) <= 0 : f.c[3] === 0) continue;
          setT(ctx, m); ctx.fillStyle = rgba(f.c, cx); ctx.fill(pathOf(cmd), 'evenodd');
        } else if (f.t === 'l' || f.t === 'r') {
          const g = f.m; const det = g[0] * g[3] - g[1] * g[2];
          if (Math.abs(det) < 1e-12) { const s = f.stops[f.stops.length - 1]; setT(ctx, m); ctx.fillStyle = rgba([s[1], s[2], s[3], s[4]], cx); ctx.fill(pathOf(cmd), 'evenodd'); continue; }
          if (!cmd.gpath) { cmd.gpath = new Path2D(); cmd.gpath.addPath(pathOf(cmd), dm(inv(g))); }
          setT(ctx, mul(m, g)); ctx.fillStyle = gradientFor(ctx, f, cx); ctx.fill(cmd.gpath, 'evenodd');
        } else if (f.t === 'b') {
          const src = bitmapSource(f.id, cx);
          if (!src) continue;
          setT(ctx, m);
          const key = f.repeat ? 'repeat' : 'no-repeat';
          const pat = ctx.createPattern(src, key);
          pat.setTransform(dm(f.m));
          const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = f.smooth !== false;
          const ga = ctx.globalAlpha; if (cx) ctx.globalAlpha = ga * Math.max(0, Math.min(1, cx[3] + cx[7] / 255));
          ctx.fillStyle = pat; ctx.fill(pathOf(cmd), 'evenodd');
          ctx.globalAlpha = ga; ctx.imageSmoothingEnabled = sm;
        }
      } else if (cmd.l) {
        const l = cmd.l;
        setT(ctx, m);
        ctx.strokeStyle = rgba(l.c, cx);
        let w = l.noScale ? l.w / sc : l.w;
        if (w * sc < 1) w = 1 / sc;
        ctx.lineWidth = w;
        ctx.lineCap = l.cap === 1 ? 'butt' : l.cap === 2 ? 'square' : 'round';
        ctx.lineJoin = l.join === 1 ? 'bevel' : l.join === 2 ? 'miter' : 'round';
        if (l.join === 2) ctx.miterLimit = l.miter || 3;
        ctx.stroke(pathOf(cmd));
      }
    }
  }

  function glyphPath(font, idx) {
    const ps = font.$paths || (font.$paths = []);
    return ps[idx] || (ps[idx] = new Path2D(font.glyphs[idx] || ''));
  }
  function drawStaticText(ctx, obj, m, cx) {
    const def = obj.$.def; const chars = obj.$.player.chars;
    const base = mul(m, def.m);
    for (const rec of def.recs) {
      const font = chars[rec.font]; if (!font) continue;
      const s = rec.size / (font.scale === 20 ? 1024 : 51.2);
      ctx.fillStyle = rgba(rec.color, cx);
      let x = rec.x;
      for (const [gi, adv] of rec.glyphs) {
        const gm = mul(base, [s, 0, 0, s, x, rec.y]);
        setT(ctx, gm);
        ctx.fill(glyphPath(font, gi), 'evenodd');
        x += adv;
      }
    }
  }

  // ---------------------------------------------------------------- display tree
  function renderObj(ctx, obj, pm, pcx) {
    const $ = obj.$;
    if (!$.visible) return;
    const m = mul(pm, $.m);
    const cx = catCx(pcx, $.cx);
    if (cx && cx[3] <= 0 && cx[7] <= 0) return;
    if ($.filters && R.filtersEnabled) { renderFiltered(ctx, obj, m, cx); return; }
    const blend = BLEND[$.blend];
    if (blend) { const op = ctx.globalCompositeOperation; ctx.globalCompositeOperation = blend; drawObj(ctx, obj, m, cx); ctx.globalCompositeOperation = op; }
    else drawObj(ctx, obj, m, cx);
  }
  const BLEND = { 3: 'multiply', 4: 'screen', 5: 'lighten', 6: 'darken', 7: 'difference', 8: 'lighter', 9: 'difference', 10: 'difference', 12: 'destination-out', 13: 'overlay', 14: 'hard-light' };

  function drawObj(ctx, obj, m, cx) {
    if (obj instanceof F.MovieClip) {
      const g = obj.$.graphics;
      if (g && g.cmds.length) drawCmds(ctx, g.cmds, m, cx);
      drawChildren(ctx, obj, m, cx);
    } else if (obj instanceof F.StaticText) drawStaticText(ctx, obj, m, cx);
    else if (obj instanceof F.Shape) drawCmds(ctx, obj.$.def.cmds, m, cx);
    else if (obj instanceof F.TextField) {
      setT(ctx, m);
      const p = obj.$.player;
      F.text.draw(ctx, obj, cx, p.focus === obj && (p.caretBlink & 16) === 0, p.focus === obj && p.selAll);
    } else if (obj instanceof F.Button) drawChildren(ctx, obj, m, cx);
    else if (obj instanceof F.BitmapObj) {
      const src = bitmapSource(obj.$.id, cx); if (!src) return;
      setT(ctx, m); const ga = ctx.globalAlpha; if (cx) ctx.globalAlpha = ga * Math.max(0, Math.min(1, cx[3] + cx[7] / 255));
      ctx.drawImage(src, 0, 0); ctx.globalAlpha = ga;
    }
  }

  function drawChildren(ctx, obj, m, cx) {
    const list = obj.$sorted();
    let masks = 0; const maskEnds = [];
    for (const c of list) {
      while (masks && c.$.depth > maskEnds[masks - 1]) { ctx.restore(); masks--; maskEnds.pop(); }
      if (c.$.clipDepth) {
        ctx.save();
        const p = new Path2D();
        collectMask(c, mul(m, c.$.m), p);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clip(p);
        masks++; maskEnds.push(c.$.clipDepth);
        continue;
      }
      renderObj(ctx, c, m, cx);
    }
    while (masks) { ctx.restore(); masks--; }
  }

  function collectMask(obj, m, path) {
    if (obj instanceof F.MovieClip) {
      const g = obj.$.graphics;
      if (g) for (const cmd of g.cmds) if (cmd.f) path.addPath(pathOf(cmd), dm(m));
      for (const c of obj.$sorted()) if (!c.$.clipDepth) collectMask(c, mul(m, c.$.m), path);
    } else if (obj instanceof F.StaticText || obj instanceof F.TextField || obj instanceof F.BitmapObj) {
      const b = obj.$bounds(); if (!b) return;
      const r = new Path2D(); r.rect(b[0], b[1], b[2] - b[0], b[3] - b[1]); path.addPath(r, dm(m));
    } else if (obj instanceof F.Shape) {
      for (const cmd of obj.$.def.cmds) if (cmd.f) path.addPath(pathOf(cmd), dm(m));
    } else if (obj instanceof F.Button) {
      for (const c of obj.$sorted()) collectMask(c, mul(m, c.$.m), path);
    }
  }

  // ---------------------------------------------------------------- filters
  const pool = [];
  function getCanvas(w, h) {
    const c = pool.pop() || document.createElement('canvas');
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } else { const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h); }
    const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.filter = 'none';
    return c;
  }
  const release = (c) => { if (pool.length < 12) pool.push(c); };

  function silhouette(src, color, alpha) {
    const c = getCanvas(src.width, src.height); const x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
    x.fillRect(0, 0, c.width, c.height);
    return c;
  }
  function blurred(src, bx, by, passes, scale) {
    const sigma = Math.max(bx, by) * scale * Math.sqrt(Math.max(1, passes) / 12);
    if (sigma < 0.3) return src;
    const c = getCanvas(src.width, src.height); const x = c.getContext('2d');
    x.filter = `blur(${sigma.toFixed(2)}px)`;
    x.drawImage(src, 0, 0);
    x.filter = 'none';
    return c;
  }
  function strengthen(src, strength) {
    if (strength <= 1.01) return src;
    const c = getCanvas(src.width, src.height); const x = c.getContext('2d');
    let s = Math.min(strength, 12);
    while (s > 0) { x.globalAlpha = Math.min(1, s); x.drawImage(src, 0, 0); s -= 1; }
    x.globalAlpha = 1;
    return c;
  }

  function renderFiltered(ctx, obj, m, cx) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const lb = obj.$bounds(); if (!lb) return;
    let b = tBounds(m, lb);
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) / Math.sqrt(Math.abs(obj.$.m[0] * obj.$.m[3] - obj.$.m[1] * obj.$.m[2]) || 1) || 1;
    const stageScale = R.stageScale || 1;
    let pad = 0;
    for (const f of obj.$.filters) pad = Math.max(pad, (Math.max(f.bx || 0, f.by || 0) + (f.dist || 0)) * stageScale * 1.2 + 2);
    let x0 = Math.floor(b[0] - pad), y0 = Math.floor(b[1] - pad), x1 = Math.ceil(b[2] + pad), y1 = Math.ceil(b[3] + pad);
    x0 = Math.max(x0, -64); y0 = Math.max(y0, -64); x1 = Math.min(x1, W + 64); y1 = Math.min(y1, H + 64);
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0 || w > 8192 || h > 8192) return;
    let src = getCanvas(w, h);
    const sctx = src.getContext('2d');
    const om = [1, 0, 0, 1, -x0, -y0];
    drawObj(sctx, obj, mul(om, m), cx);
    const alphaMul = cx ? Math.max(0, Math.min(1, cx[3])) : 1;
    for (const f of obj.$.filters) {
      const out = applyFilter(src, f, stageScale, alphaMul);
      if (out !== src) { release(src); src = out; }
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const blend = BLEND[obj.$.blend]; if (blend) ctx.globalCompositeOperation = blend;
    ctx.drawImage(src, x0, y0);
    ctx.restore();
    release(src);
  }

  function applyFilter(src, f, scale, alphaMul) {
    const w = src.width, h = src.height;
    if (f.t === 'blur') return blurred(src, f.bx, f.by, f.passes, scale);
    if (f.t === 'glow' || f.t === 'shadow') {
      const color = f.c; const alpha = (color[3] / 255) * alphaMul;
      const dx = f.t === 'shadow' ? Math.cos(f.angle) * f.dist * scale : 0, dy = f.t === 'shadow' ? Math.sin(f.angle) * f.dist * scale : 0;
      const out = getCanvas(w, h); const o = out.getContext('2d');
      if (!f.inner) {
        let sil = silhouette(src, color, 1);
        let bl = blurred(sil, f.bx, f.by, f.passes, scale); if (bl !== sil) release(sil);
        let st = strengthen(bl, f.str); if (st !== bl) release(bl);
        o.globalAlpha = alpha; o.drawImage(st, dx, dy); o.globalAlpha = 1;
        release(st);
        if (f.knockout) { o.globalCompositeOperation = 'destination-out'; o.drawImage(src, 0, 0); o.globalCompositeOperation = 'source-over'; }
        else if (!f.hide) o.drawImage(src, 0, 0);
      } else {
        // inner: blur the inverted alpha and keep it inside the source
        const inv = getCanvas(w, h); const ix = inv.getContext('2d');
        ix.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`; ix.fillRect(0, 0, w, h);
        ix.globalCompositeOperation = 'destination-out'; ix.drawImage(src, dx, dy);
        let bl = blurred(inv, f.bx, f.by, f.passes, scale); if (bl !== inv) release(inv);
        let st = strengthen(bl, f.str); if (st !== bl) release(bl);
        if (!f.knockout && !f.hide) o.drawImage(src, 0, 0);
        const tmp = getCanvas(w, h); const tx = tmp.getContext('2d');
        tx.drawImage(src, 0, 0); tx.globalCompositeOperation = 'source-in'; tx.globalAlpha = alpha; tx.drawImage(st, 0, 0);
        release(st);
        if (f.knockout) { o.globalCompositeOperation = 'source-over'; }
        o.drawImage(tmp, 0, 0);
        release(tmp);
      }
      return out;
    }
    if (f.t === 'cmatrix') {
      const out = getCanvas(w, h); const o = out.getContext('2d');
      o.drawImage(src, 0, 0);
      try {
        const d = o.getImageData(0, 0, w, h); const p = d.data; const M = f.m;
        for (let i = 0; i < p.length; i += 4) {
          const r = p[i], g = p[i + 1], b = p[i + 2], a = p[i + 3];
          p[i] = clamp(M[0] * r + M[1] * g + M[2] * b + M[3] * a + M[4]);
          p[i + 1] = clamp(M[5] * r + M[6] * g + M[7] * b + M[8] * a + M[9]);
          p[i + 2] = clamp(M[10] * r + M[11] * g + M[12] * b + M[13] * a + M[14]);
          p[i + 3] = clamp(M[15] * r + M[16] * g + M[17] * b + M[18] * a + M[19]);
        }
        o.putImageData(d, 0, 0);
      } catch (e) { }
      return out;
    }
    return src;
  }
  R.filtersEnabled = true;

  // ---------------------------------------------------------------- stage
  R.frame = function (ctx, player, view) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const bg = player.bg;
    ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
    ctx.fillRect(view.x, view.y, view.w, view.h);
    ctx.save();
    ctx.beginPath(); ctx.rect(view.x, view.y, view.w, view.h); ctx.clip();
    R.stageScale = view.s;
    renderObj(ctx, player.root, [view.s, 0, 0, view.s, view.x, view.y], null);
    ctx.restore();
  };

  // ---------------------------------------------------------------- hit testing
  R.hitShapeDef = function (def, x, y) {
    if (def.t !== 'shape') return true;
    hctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const cmd of def.cmds) {
      if (cmd.f) { if (hctx.isPointInPath(pathOf(cmd), x, y, 'evenodd')) return true; }
      else if (cmd.l) { hctx.lineWidth = Math.max(1, cmd.l.w); if (hctx.isPointInStroke(pathOf(cmd), x, y)) return true; }
    }
    return false;
  };
  R.hitGraphics = function (g, x, y) {
    if (g.b && (x < g.b[0] || x > g.b[2] || y < g.b[1] || y > g.b[3])) return false;
    hctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const cmd of g.cmds) {
      if (cmd.f) { if (hctx.isPointInPath(pathOf(cmd), x, y, 'evenodd')) return true; }
      else if (cmd.l) { hctx.lineWidth = Math.max(1, cmd.l.w); if (hctx.isPointInStroke(pathOf(cmd), x, y)) return true; }
    }
    return false;
  };
})();
