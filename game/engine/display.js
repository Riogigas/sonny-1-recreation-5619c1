// Display list, timelines and AS2-visible display object API.
// Timeline/goto/event ordering follows Ruffle's AVM1 implementation.
'use strict';
(function () {
  const F = window.F;
  const { toNum, toStr } = F;
  const TL_MAX = 16384; // AS depth 0 == internal depth 16384
  let instanceCounter = 0;

  const ID = [1, 0, 0, 1, 0, 0];
  function mul(P, L) {
    return [P[0] * L[0] + P[2] * L[1], P[1] * L[0] + P[3] * L[1], P[0] * L[2] + P[2] * L[3], P[1] * L[2] + P[3] * L[3], P[0] * L[4] + P[2] * L[5] + P[4], P[1] * L[4] + P[3] * L[5] + P[5]];
  }
  function inv(m) {
    const det = m[0] * m[3] - m[1] * m[2];
    if (!det) return [1, 0, 0, 1, -m[4], -m[5]];
    const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
    return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
  }
  function apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  function tBounds(m, b) {
    if (!b) return null;
    const p = [apply(m, b[0], b[1]), apply(m, b[2], b[1]), apply(m, b[0], b[3]), apply(m, b[2], b[3])];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1];
  }
  function union(a, b) { if (!a) return b; if (!b) return a; return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]; }
  F.mat = { mul, inv, apply, tBounds, union, ID };

  function asBool(v) {
    switch (typeof v) {
      case 'boolean': return v;
      case 'number': return v !== 0 && v === v;
      case 'string': return v.length > 0;
      case 'undefined': return false;
      default: return v !== null;
    }
  }
  F.asBool = asBool;
  const twip = (v) => Math.trunc(v * 20) / 20;

  // ---------------------------------------------------------------- DisplayObject
  class DisplayObject {
    constructor(player, def, id) {
      Object.defineProperty(this, '$', {
        value: {
          player, def, id, parent: null, depth: 0, name: '', m: ID.slice(), cx: null, visible: true,
          filters: null, blend: 0, clipDepth: 0, ratio: 0, placeFrame: 0, scriptPlaced: false, transformed: false,
          removed: false, scaleCached: false, sx: 1, sy: 1, rot: 0, skew: 0, scope: null, bound: null, maskOwner: null, mask: null,
        }
      });
    }
    $path() {
      const $ = this.$;
      if (!$.parent) return '_level0';
      return $.parent.$path() + '.' + $.name;
    }
    $slashPath() {
      const $ = this.$;
      if (!$.parent) return '/';
      const p = $.parent.$slashPath();
      return (p === '/' ? '' : p) + '/' + $.name;
    }
    $scope() { return this.$.scope || (this.$.scope = F.makeScope(this)); }
    $world() {
      let m = this.$.m, p = this.$.parent;
      while (p) { m = mul(p.$.m, m); p = p.$.parent; }
      return m;
    }
    $cx() { return this.$.cx || [1, 1, 1, 1, 0, 0, 0, 0]; }
    $setCx(x) { this.$.cx = x; this.$.transformed = true; }
    $setMatrix(m) { this.$.m = m; this.$.scaleCached = false; this.$.transformed = true; }
    $cacheScale() {
      const $ = this.$;
      if ($.scaleCached) return;
      const [a, b, c, d] = $.m;
      const rx = Math.atan2(b, a), ry = Math.atan2(-c, d);
      $.sx = Math.hypot(a, b); $.sy = Math.hypot(c, d); $.rot = rx; $.skew = ry - rx; $.scaleCached = true;
    }
    $rebuild() {
      const $ = this.$;
      const cx = Math.cos($.rot), sx = Math.sin($.rot), cy = Math.cos($.rot + $.skew), sy = Math.sin($.rot + $.skew);
      $.m = [$.sx * cx, $.sx * sx, -$.sy * sy, $.sy * cy, $.m[4], $.m[5]];
      $.transformed = true;
    }
    // Local (untransformed) bounds [x0,y0,x1,y1] or null.
    $bounds() { return null; }
    $applyPlace(op) {
      const $ = this.$;
      if ($.transformed) return;
      if (op.m) { $.m = op.m.slice(); $.scaleCached = false; }
      if (op.cx) $.cx = op.cx.slice();
      if (op.ratio !== undefined) $.ratio = op.ratio;
      if (op.blend !== undefined) $.blend = op.blend;
      if (op.filters !== undefined) $.filters = op.filters && op.filters.length ? op.filters : null;
    }
    $replaceWith(id) { }
    $unload() { this.$.removed = true; }
    $hitShape(gx, gy) { return false; }
    $isInteractive() { return false; }
    // AS-visible properties
    get _x() { return this.$.m[4]; }
    set _x(v) { v = toNum(v); if (!isFinite(v)) return; this.$.m[4] = twip(v); this.$.transformed = true; }
    get _y() { return this.$.m[5]; }
    set _y(v) { v = toNum(v); if (!isFinite(v)) return; this.$.m[5] = twip(v); this.$.transformed = true; }
    get _xscale() { this.$cacheScale(); return this.$.sx * 100; }
    set _xscale(v) { v = toNum(v); if (!isFinite(v)) return; this.$cacheScale(); this.$.sx = v / 100; this.$rebuild(); }
    get _yscale() { this.$cacheScale(); return this.$.sy * 100; }
    set _yscale(v) { v = toNum(v); if (!isFinite(v)) return; this.$cacheScale(); this.$.sy = v / 100; this.$rebuild(); }
    get _rotation() { this.$cacheScale(); let d = this.$.rot * 180 / Math.PI; return d; }
    set _rotation(v) {
      v = toNum(v); if (!isFinite(v)) return;
      v = v % 360; if (v > 180) v -= 360; else if (v < -180) v += 360;
      this.$cacheScale(); this.$.rot = v * Math.PI / 180; this.$rebuild();
    }
    get _width() { const b = tBounds(this.$.m, this.$bounds()); return b ? b[2] - b[0] : 0; }
    set _width(v) {
      v = toNum(v); if (!isFinite(v) || v < 0) return;
      const b = this.$bounds(); if (!b) return; const w = b[2] - b[0]; if (!w) return;
      this.$cacheScale(); this.$.sx = v / w; this.$rebuild();
    }
    get _height() { const b = tBounds(this.$.m, this.$bounds()); return b ? b[3] - b[1] : 0; }
    set _height(v) {
      v = toNum(v); if (!isFinite(v) || v < 0) return;
      const b = this.$bounds(); if (!b) return; const h = b[3] - b[1]; if (!h) return;
      this.$cacheScale(); this.$.sy = v / h; this.$rebuild();
    }
    get _alpha() { return this.$cx()[3] * 100; }
    set _alpha(v) { v = toNum(v); if (v !== v) return; const c = this.$cx().slice(); c[3] = v / 100; this.$.cx = c; this.$.transformed = true; }
    get _visible() { return this.$.visible; }
    set _visible(v) { this.$.visible = asBool(v); }
    get _name() { return this.$.name; }
    set _name(v) { const p = this.$.parent; const old = this.$.name; this.$.name = toStr(v); if (p) { p.$unlinkName(this, old); p.$linkName(this); } }
    get _parent() { return this.$.parent || undefined; }
    get _root() { return this.$.player.root; }
    get _level0() { return this.$.player.root; }
    get _global() { return F.GLOBALS; }
    get _target() { return this.$slashPath(); }
    get _url() { return this.$.player.url; }
    get _xmouse() { const p = apply(inv(this.$world()), this.$.player.mouseX, this.$.player.mouseY); return Math.round(p[0] * 20) / 20; }
    get _ymouse() { const p = apply(inv(this.$world()), this.$.player.mouseX, this.$.player.mouseY); return Math.round(p[1] * 20) / 20; }
    get _quality() { return this.$.player.quality; }
    set _quality(v) { this.$.player.quality = toStr(v).toUpperCase(); }
    get _highquality() { return this.$.player.quality === 'LOW' ? 0 : this.$.player.quality === 'MEDIUM' ? 1 : 2; }
    set _highquality(v) { v = toNum(v); this.$.player.quality = v === 0 ? 'LOW' : v === 1 ? 'MEDIUM' : 'HIGH'; }
    get _focusrect() { return true; } set _focusrect(v) { }
    get _soundbuftime() { return 5; } set _soundbuftime(v) { }
    get _droptarget() { return this.$.player.dropTarget(this); }
    get filters() { return F.fromInternalFilters(this.$.filters); }
    set filters(v) { this.$.filters = F.toInternalFilters(v); }
    get blendMode() { return ['normal', 'normal', 'layer', 'multiply', 'screen', 'lighten', 'darken', 'difference', 'add', 'subtract', 'invert', 'alpha', 'erase', 'overlay', 'hardlight'][this.$.blend] || 'normal'; }
    set blendMode(v) { const names = ['normal', 'normal', 'layer', 'multiply', 'screen', 'lighten', 'darken', 'difference', 'add', 'subtract', 'invert', 'alpha', 'erase', 'overlay', 'hardlight']; const i = typeof v === 'number' ? v : names.indexOf(toStr(v).toLowerCase()); if (i >= 0) this.$.blend = i; }
    get transform() { return new F.GLOBALS.flash.geom.Transform(this); }
    set transform(t) { if (t && t.$mc && t.$mc.$) { this.$.cx = t.$mc.$cx().slice(); this.$.m = t.$mc.$.m.slice(); this.$.scaleCached = false; this.$.transformed = true; } }
    get cacheAsBitmap() { return false; } set cacheAsBitmap(v) { }
    get scale9Grid() { return undefined; } set scale9Grid(v) { }
    get opaqueBackground() { return undefined; } set opaqueBackground(v) { }
    get tabIndex() { return undefined; } set tabIndex(v) { }
    toString() { return this.$path(); }
    // common methods
    getDepth() { return this.$.depth - TL_MAX; }
    swapDepths(target) {
      const p = this.$.parent; if (!p || !(p instanceof MovieClip)) return;
      let depth;
      if (target instanceof DisplayObject) { if (target.$.parent !== p) return; depth = target.$.depth; }
      else if (typeof target === 'string') { const t = p.$childByName(target); if (!t) return; depth = t.$.depth; }
      else { const n = toNum(target); if (!isFinite(n)) return; depth = (n | 0) + TL_MAX; }
      if (depth === this.$.depth) return;
      p.$swapAtDepth(this, depth);
      this.$.transformed = true; this.$.scriptPlaced = true;
    }
    localToGlobal(pt) { if (!pt) return; const p = apply(this.$world(), toNum(pt.x), toNum(pt.y)); pt.x = p[0]; pt.y = p[1]; }
    globalToLocal(pt) { if (!pt) return; const p = apply(inv(this.$world()), toNum(pt.x), toNum(pt.y)); pt.x = p[0]; pt.y = p[1]; }
    getBounds(target) {
      const b = this.$bounds();
      if (!b) return { xMin: 6710886.35, xMax: 6710886.35, yMin: 6710886.35, yMax: 6710886.35 };
      let m = this.$world();
      if (target instanceof DisplayObject) m = mul(inv(target.$world()), m);
      const r = tBounds(m, b);
      return { xMin: r[0], yMin: r[1], xMax: r[2], yMax: r[3] };
    }
    getRect(target) { return this.getBounds(target); }
    hitTest(x, y, shape) {
      if (x instanceof DisplayObject) {
        const a = tBounds(this.$world(), this.$bounds()), b = tBounds(x.$world(), x.$bounds());
        if (!a || !b) return false;
        return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
      }
      x = toNum(x); y = toNum(y);
      if (!isFinite(x) || !isFinite(y)) return false;
      if (asBool(shape)) return this.$hitShape(x, y, false);
      const a = tBounds(this.$world(), this.$bounds());
      return !!a && x >= a[0] && x <= a[2] && y >= a[1] && y <= a[3];
    }
  }
  F.DisplayObject = DisplayObject;

  // ---------------------------------------------------------------- Shape / StaticText / Bitmap
  class Shape extends DisplayObject {
    $bounds() { const b = this.$.def.b; return b ? [b[0], b[1], b[2], b[3]] : null; }
    $replaceWith(id) { const d = this.$.player.chars[id]; if (d && (d.t === 'shape' || d.t === 'stext')) { this.$.def = d; this.$.id = id; } }
    $hitShape(gx, gy) {
      const p = apply(inv(this.$world()), gx, gy);
      const b = this.$bounds(); if (!b || p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) return false;
      return F.render.hitShapeDef(this.$.def, p[0], p[1]);
    }
  }
  class StaticText extends Shape {
    $hitShape(gx, gy) {
      const p = apply(inv(this.$world()), gx, gy); const b = this.$bounds();
      return !!b && p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
    }
  }
  class BitmapObj extends DisplayObject {
    $bounds() { const d = this.$.def; return [0, 0, d.w, d.h]; }
    $hitShape(gx, gy) { const p = apply(inv(this.$world()), gx, gy); const b = this.$bounds(); return p[0] >= 0 && p[1] >= 0 && p[0] <= b[2] && p[1] <= b[3]; }
  }
  F.Shape = Shape; F.StaticText = StaticText; F.BitmapObj = BitmapObj;

  // ---------------------------------------------------------------- Container helpers (shared by MovieClip & Button)
  const containerMethods = {
    $sorted() {
      const $ = this.$;
      if (!$.list) $.list = [...$.children.values()].sort((a, b) => a.$.depth - b.$.depth);
      return $.list;
    },
    $childByName(name) {
      for (const c of this.$sorted()) if (c.$.name === name) return c;
      return undefined;
    },
    // Named children are exposed as own properties; script variables take priority.
    $linkName(child) {
      const n = child.$.name;
      if (!n || !(this instanceof MovieClip) || n in MovieClip.prototype) return;
      const d = Object.getOwnPropertyDescriptor(this, n);
      if (d) {
        const v = d.value;
        if (!(v instanceof DisplayObject)) return;
        if (v !== child && !v.$.removed && v.$.parent === this && v.$.depth < child.$.depth) return;
      }
      this[n] = child;
    },
    $unlinkName(child, name) {
      name = name === undefined ? child.$.name : name;
      if (!name || !(this instanceof MovieClip)) return;
      if (Object.prototype.hasOwnProperty.call(this, name) && this[name] === child) {
        delete this[name];
        const other = this.$childByName(name);
        if (other && other !== child) this[name] = other;
      }
    },
    $addAtDepth(child, depth) {
      const $ = this.$;
      const prev = $.children.get(depth);
      if (prev) this.$removeChild(prev);
      child.$.parent = this; child.$.depth = depth;
      $.children.set(depth, child); $.list = null;
      this.$linkName(child);
    },
    $removeChild(child) {
      const $ = this.$;
      if ($.children.get(child.$.depth) !== child) return;
      $.children.delete(child.$.depth); $.list = null;
      this.$unlinkName(child);
      child.$unload();
    },
    $swapAtDepth(child, depth) {
      const $ = this.$;
      const other = $.children.get(depth);
      const old = child.$.depth;
      $.children.delete(old);
      if (other) { other.$.depth = old; $.children.set(old, other); other.$.transformed = true; }
      child.$.depth = depth; $.children.set(depth, child); $.list = null;
    },
    $containerBounds() {
      let b = null;
      for (const c of this.$sorted()) {
        if (c.$.clipDepth) continue;
        b = union(b, tBounds(c.$.m, c.$bounds()));
      }
      return b;
    },
    $hitChildren(gx, gy, pick) {
      const list = this.$sorted();
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i];
        if (c.$.clipDepth) continue;
        if (pick && !c.$.visible) continue;
        const mask = this.$maskFor(c, list);
        if (mask && !mask.$hitShape(gx, gy, false)) continue;
        if (c.$hitShape(gx, gy, pick)) return true;
      }
      return false;
    },
    $maskFor(c, list) {
      for (const m of list) {
        if (m.$.clipDepth && m.$.depth < c.$.depth && m.$.clipDepth >= c.$.depth) return m;
      }
      return null;
    },
  };

  // ---------------------------------------------------------------- MovieClip
  const EMPTY_TL = { n: 1, frames: [[]], labels: {} };
  const CX_ID = [1, 1, 1, 1, 0, 0, 0, 0];
  const arrEq = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  function survivesRewind(child, finals) {
    const $ = child.$;
    if ($.depth >= TL_MAX) return true;
    const fp = finals.get($.depth);
    if (!fp) return false;
    if ($.scriptPlaced) return false;
    const idEq = fp.kind !== 'modify' && $.id === fp.id;
    const ratioEq = fp.ratio === undefined || $.ratio === fp.ratio;
    const clipEq = fp.clip === undefined || $.clipDepth === fp.clip;
    if (child instanceof MovieClip) return ratioEq;
    if (child instanceof Shape) return ratioEq && idEq && clipEq && (!fp.m || arrEq($.m, fp.m)) && (!fp.cx || arrEq(child.$cx(), fp.cx));
    return ratioEq && idEq && clipEq;
  }
  class MovieClip extends DisplayObject {
    constructor(player, def, id) {
      super(player, def, id);
      const $ = this.$;
      $.tl = def || EMPTY_TL; $.cur = 0; $.total = Math.max(1, $.tl.n || 1); $.playing = true;
      $.children = new Map(); $.list = null; $.initialized = false; $.graphics = null; $.clipEvents = null;
      $.enabled = true; $.hand = true; $.hitArea = null; $.inExec = false; $.drawn = null;
    }
    $bounds() {
      let b = this.$containerBounds();
      if (this.$.graphics && this.$.graphics.b) b = union(b, this.$.graphics.b);
      return b;
    }
    $hitShape(gx, gy, pick) {
      if (this.$.graphics && this.$.graphics.cmds.length) {
        const p = apply(inv(this.$world()), gx, gy);
        if (F.render.hitGraphics(this.$.graphics, p[0], p[1])) return true;
      }
      return this.$hitChildren(gx, gy, pick);
    }
    $hasButtonHandlers() {
      const $ = this.$;
      if ($.clipEvents && ($.clipEvents.press || $.clipEvents.release || $.clipEvents.rollOver || $.clipEvents.rollOut || $.clipEvents.releaseOutside || $.clipEvents.dragOver || $.clipEvents.dragOut)) return true;
      for (const k of BUTTON_METHODS) if (typeof this[k] === 'function') return true;
      return false;
    }
    $unload() {
      const $ = this.$;
      for (const c of this.$sorted()) c.$unload();
      if (!$.removed) {
        $.removed = true;
        this.$dispatch('unload');
        $.player.onClipRemoved(this);
      }
    }
    // --- events
    $dispatch(ev) {
      const $ = this.$; const p = $.player;
      const lbl = BUTTON_LABELS[ev];
      if (lbl && $.tl.labels && this.$hasButtonHandlers()) {
        if (!$.lower) { $.lower = {}; for (const k in $.tl.labels) $.lower[k.toLowerCase()] = $.tl.labels[k] + 1; }
        const f = $.lower[lbl];
        if (f) { $.playing = false; if (f !== $.cur) this.$goto(f); }
      }
      if ($.clipEvents && $.clipEvents[ev]) p.queue(this, $.clipEvents[ev], ev === 'unload', 'clip:' + ev);
      const meth = METHOD_NAMES[ev];
      if (meth) p.queueMethod(this, meth, ev === 'unload');
    }
    $runFrameAvm1() {
      const $ = this.$;
      if ($.unloaded) return;
      if (!$.initialized) { this.$dispatch('load'); $.initialized = true; }
      else this.$dispatch('enterFrame');
      if ($.playing) this.$advance();
    }
    $advance() {
      const $ = this.$;
      if ($.cur < $.total) this.$runFrame(true, true);
      else if ($.total > 1) this.$goto(1);
      else $.playing = false;
    }
    $runFrame(display, sounds) {
      const $ = this.$;
      const f = ++$.cur;
      const ops = $.tl.frames[f - 1];
      if (!ops) return;
      for (const op of ops) {
        switch (op.op) {
          case 'place': if (display) this.$placeOp(op, f); break;
          case 'remove': if (display) { const c = $.children.get(op.depth); if (c) this.$removeChild(c); } break;
          case 'action': { const fn = $.player.frameScript($.id, f - 1, op.idx); if (fn) $.player.queue(this, fn, false, 'frame:' + $.id + ':' + (f - 1)); break; }
          case 'sound': if (sounds && F.audio) F.audio.startSound(op.id, op.info); break;
          case 'stream': if (sounds && F.audio) F.audio.streamFrame(this, op.t); break;
        }
      }
    }
    $placeOp(op, frame) {
      const $ = this.$;
      const existing = $.children.get(op.depth);
      if (!op.move) { if (op.id !== undefined) this.$instantiateChild(op.id, op.depth, op, frame, op.$akey); }
      else if (op.id !== undefined) {
        if (existing) { existing.$replaceWith(op.id); existing.$applyPlace(op); existing.$.placeFrame = frame; }
      } else if (existing) existing.$applyPlace(op);
    }
    $instantiateChild(id, depth, op, frame, akey) {
      const $ = this.$; const p = $.player;
      if ($.children.has(depth)) return null;
      const child = p.instantiate(id);
      if (!child) return null;
      child.$.placeFrame = frame;
      if (op.name) child.$.name = op.name; else child.$.name = 'instance' + (++instanceCounter);
      if (op.clip) child.$.clipDepth = op.clip;
      this.$addAtDepth(child, depth);
      child.$applyPlace(op);
      if (akey && child instanceof MovieClip) child.$.clipEvents = p.clipScripts(akey);
      p.postInstantiate(child, true);
      return child;
    }
    // --- goto (Ruffle run_goto)
    $goto(frame) {
      const $ = this.$;
      if ($.streamInst && F.audio) F.audio.stopClipStream(this);
      const fromFrame = $.cur;
      const isRewind = frame <= $.cur;
      if (isRewind) $.cur = 0;
      let cmds = [];
      let index = 0;
      const clamped = Math.min(frame, $.total);
      while ($.cur < clamped) {
        $.cur++;
        const ops = $.tl.frames[$.cur - 1] || [];
        for (const op of ops) {
          if (op.op === 'place') {
            index++;
            const kind = !op.move ? 'place' : (op.id !== undefined ? 'replace' : 'modify');
            const po = { depth: op.depth, kind, id: op.id, m: op.m, cx: op.cx, ratio: op.ratio, name: op.name, clip: op.clip, filters: op.filters, blend: op.blend, $akey: op.$akey, frame: $.cur, index };
            if (isRewind && kind === 'place') {
              if (!po.m) po.m = ID; if (!po.cx) po.cx = CX_ID; if (po.ratio === undefined) po.ratio = 0;
              if (po.blend === undefined) po.blend = 0; if (po.filters === undefined) po.filters = null;
            }
            const cur = cmds.find(c => c.depth === op.depth);
            if (cur) {
              if (kind !== 'modify') { cur.kind = kind; cur.id = op.id; cur.frame = $.cur; }
              for (const k of ['m', 'cx', 'ratio', 'filters', 'blend']) if (po[k] !== undefined) cur[k] = po[k];
            } else cmds.push(po);
          } else if (op.op === 'remove') {
            const i = cmds.findIndex(c => c.depth === op.depth);
            if (i >= 0) { const last = cmds.pop(); if (i < cmds.length) cmds[i] = last; }
            if (!isRewind) {
              const c = $.children.get(op.depth);
              if (c) { const save = $.cur; $.cur = fromFrame; this.$removeChild(c); $.cur = save; }
            }
          }
        }
      }
      const hit = $.cur === frame;
      if (isRewind) {
        const finals = new Map(cmds.map(c => [c.depth, c]));
        for (const c of [...this.$sorted()]) if (!survivesRewind(c, finals)) this.$removeChild(c);
      }
      cmds.sort((a, b) => a.index - b.index);
      const run = (c) => {
        const existing = $.children.get(c.depth);
        if (existing && (isRewind || c.kind === 'modify')) existing.$applyPlace(c);
        else if (existing && c.kind === 'replace') { existing.$replaceWith(c.id); existing.$applyPlace(c); existing.$.placeFrame = c.frame; }
        else if (c.kind !== 'modify') this.$instantiateChild(c.id, c.depth, c, c.frame, c.$akey);
      };
      for (const c of cmds) if (c.frame < frame) run(c);
      if (hit) {
        $.cur = frame - 1;
        this.$runFrame(false, frame !== fromFrame);
      } else $.cur = clamped;
      for (const c of cmds) if (c.frame >= frame) run(c);
    }
    $frameFromArg(f) {
      const $ = this.$;
      if (typeof f === 'number') { if (f !== Math.floor(f)) f = toStr(f); else return f; }
      const s = toStr(f);
      if (!$.lower) { $.lower = {}; for (const k in $.tl.labels) $.lower[k.toLowerCase()] = $.tl.labels[k] + 1; }
      const l = $.lower[s.toLowerCase()];
      if (l !== undefined) return l;
      if (/^\s*-?\d+(\.\d+)?\s*$/.test(s)) return Math.floor(Number(s));
      return undefined;
    }
    $gotoFrame(f, stop) {
      const $ = this.$;
      const frame = this.$frameFromArg(f);
      if (frame === undefined || frame <= 0) return;
      if (stop) $.playing = false; else if ($.total > 1) $.playing = true;
      if (frame !== $.cur) this.$goto(Math.max(1, frame));
    }
    // --- AS API
    play() { if (this.$.total > 1) this.$.playing = true; }
    stop() { this.$.playing = false; }
    gotoAndStop(f) { this.$gotoFrame(f, true); }
    gotoAndPlay(f) { this.$gotoFrame(f, false); }
    nextFrame() { const $ = this.$; if ($.cur < $.total) this.$gotoFrame($.cur + 1, true); else $.playing = false; }
    prevFrame() { const $ = this.$; if ($.cur > 1) this.$gotoFrame($.cur - 1, true); else $.playing = false; }
    get _currentframe() { return Math.max(1, this.$.cur); }
    get _totalframes() { return this.$.total; }
    get _framesloaded() { return this.$.total; }
    get _lockroot() { return false; } set _lockroot(v) { }
    get enabled() { return this.$.enabled; } set enabled(v) { this.$.enabled = asBool(v); }
    get useHandCursor() { return this.$.hand; } set useHandCursor(v) { this.$.hand = asBool(v); }
    get hitArea() { return this.$.hitArea || undefined; } set hitArea(v) { this.$.hitArea = v instanceof DisplayObject ? v : null; }
    get trackAsMenu() { return false; } set trackAsMenu(v) { }
    get tabChildren() { return true; } set tabChildren(v) { }
    get focusEnabled() { return false; } set focusEnabled(v) { }
    get tabEnabled() { return false; } set tabEnabled(v) { }
    get menu() { return undefined; } set menu(v) { }
    getBytesLoaded() { return 1000; }
    getBytesTotal() { return 1000; }
    getSWFVersion() { return 8; }
    getNextHighestDepth() {
      let max = -1;
      for (const c of this.$.children.values()) if (c.$.depth - TL_MAX > max) max = c.$.depth - TL_MAX;
      return max + 1;
    }
    getInstanceAtDepth(d) { return this.$.children.get((toNum(d) | 0) + TL_MAX); }
    attachMovie(linkage, name, depth, init) {
      const $ = this.$; const p = $.player;
      const id = p.exports[toStr(linkage)];
      if (id === undefined) return undefined;
      const child = p.instantiate(id);
      if (!child) return undefined;
      child.$.name = toStr(name); child.$.scriptPlaced = true;
      this.$addAtDepth(child, (toNum(depth) | 0) + TL_MAX);
      p.postInstantiate(child, true);
      if (init && typeof init === 'object') for (const k of Object.keys(init).reverse()) child[k] = init[k];
      return child;
    }
    createEmptyMovieClip(name, depth) {
      const p = this.$.player;
      const child = new MovieClip(p, null, -1);
      child.$.name = toStr(name); child.$.scriptPlaced = true;
      this.$addAtDepth(child, (toNum(depth) | 0) + TL_MAX);
      p.postInstantiate(child, true);
      return child;
    }
    duplicateMovieClip(a, b, c, d) {
      let target = this, name = a, depth = b, init = c;
      if (a instanceof DisplayObject || (typeof a === 'string' && typeof c !== 'object' && c !== undefined && typeof b === 'string')) { target = F.resolveTarget(a, this); name = b; depth = c; init = d; }
      if (!target || !target.$.parent) return undefined;
      const par = target.$.parent; const p = this.$.player;
      const child = p.instantiate(target.$.id);
      if (!child) return undefined;
      child.$.name = toStr(name); child.$.scriptPlaced = true;
      child.$.m = target.$.m.slice(); child.$.cx = target.$.cx && target.$.cx.slice(); child.$.clipEvents = target.$.clipEvents;
      par.$addAtDepth(child, (toNum(depth) | 0) + TL_MAX);
      p.postInstantiate(child, true);
      if (init && typeof init === 'object') for (const k of Object.keys(init).reverse()) child[k] = init[k];
      return child;
    }
    createTextField(name, depth, x, y, w, h) {
      const p = this.$.player;
      const tf = new TextField(p, null, -1);
      tf.$.name = toStr(name); tf.$.scriptPlaced = true;
      tf.$.m = [1, 0, 0, 1, toNum(x) || 0, toNum(y) || 0];
      tf.$.w = Math.max(0, toNum(w) || 0); tf.$.h = Math.max(0, toNum(h) || 0);
      this.$addAtDepth(tf, (toNum(depth) | 0) + TL_MAX);
      p.postInstantiate(tf, true);
      return tf;
    }
    removeMovieClip(...args) {
      let t = this;
      if (args.length) t = F.resolveTarget(args[0], this);
      if (!t || !(t instanceof DisplayObject)) return;
      const p = t.$.parent;
      if (!p || t.$.depth < TL_MAX || t.$.depth >= 2130706416) return;
      p.$removeChild(t);
    }
    unloadMovie(...args) {
      let t = this;
      if (args.length) t = F.resolveTarget(args[0], this);
      if (!(t instanceof MovieClip)) return;
      for (const c of [...t.$sorted()]) t.$removeChild(c);
      if (!t.$.unloaded) t.$dispatch('unload');
      t.$.tl = EMPTY_TL; t.$.total = 1; t.$.cur = 1; t.$.playing = false; t.$.graphics = null; t.$.lower = null;
      t.$.clipEvents = null; t.$.unloaded = true;
    }
    // External SWFs (e.g. the defunct CPMStar ad server) can't be loaded; clear the placeholder instead.
    loadMovie(url) { if (/^https?:/i.test(String(url))) { this.unloadMovie(); if (F.onBlockedLoad) F.onBlockedLoad(this, url); } }
    loadVariables() { }
    loadMovieNum() { }
    getURL(u) { F.GLOBALS.getURL(u); }
    startDrag(a, b, c, d, e) {
      let t = this, lock = a, r = [b, c, d, e];
      if (a instanceof DisplayObject || typeof a === 'string') { t = F.resolveTarget(a, this); lock = b; r = [c, d, arguments[5], arguments[6]]; if (r[0] === undefined) r = [arguments[2], arguments[3], arguments[4], arguments[5]]; }
      if (!t) return;
      this.$.player.startDrag(t, asBool(lock), r.every(v => v !== undefined) ? r.map(toNum) : null);
    }
    stopDrag() { this.$.player.stopDrag(); }
    setMask(m) {
      const $ = this.$;
      if ($.mask) $.mask.$.maskOwner = null;
      $.mask = m instanceof DisplayObject ? m : null;
      if ($.mask) $.mask.$.maskOwner = this;
    }
    attachAudio() { }
    attachBitmap() { }
    getTextSnapshot() { return undefined; }
    // drawing API
    $g() { return this.$.graphics || (this.$.graphics = { cmds: [], b: null, fill: null, line: null, x: 0, y: 0 }); }
    clear() { this.$.graphics = null; }
    lineStyle(w, color, alpha, pixelHinting, noScale, caps, joints, miter) {
      const g = this.$g();
      if (w === undefined || w === null) { g.line = null; return; }
      w = toNum(w); if (w !== w) { g.line = null; return; }
      color = toNum(color) | 0; alpha = alpha === undefined ? 100 : toNum(alpha);
      g.line = { w: Math.max(0, Math.min(255, w)), c: [(color >> 16) & 255, (color >> 8) & 255, color & 255, Math.round(Math.max(0, Math.min(100, alpha)) * 2.55)], cap: caps === 'none' ? 1 : caps === 'square' ? 2 : 0, join: joints === 'bevel' ? 1 : joints === 'miter' ? 2 : 0, miter: toNum(miter) || 3, d: null };
    }
    beginFill(color, alpha) {
      const g = this.$g(); this.endFill();
      if (color === undefined) return;
      color = toNum(color) | 0; alpha = alpha === undefined ? 100 : toNum(alpha);
      g.fill = { f: { t: 's', c: [(color >> 16) & 255, (color >> 8) & 255, color & 255, Math.round(Math.max(0, Math.min(100, alpha)) * 2.55)] }, d: `M${g.x} ${g.y}`, sx: g.x, sy: g.y };
      g.cmds.push(g.fill);
    }
    beginGradientFill(type, colors, alphas, ratios, matrix) {
      const g = this.$g(); this.endFill();
      if (!Array.isArray(colors)) return;
      const stops = colors.map((c, i) => { c = toNum(c) | 0; return [toNum(ratios[i]) / 255, (c >> 16) & 255, (c >> 8) & 255, c & 255, Math.round(toNum(alphas[i]) * 2.55)]; });
      let m = [1 / 819.2, 0, 0, 1 / 819.2, 0, 0];
      if (matrix) {
        if (matrix.matrixType === 'box') {
          const w = toNum(matrix.w), h = toNum(matrix.h), r = toNum(matrix.r) || 0, x = toNum(matrix.x), y = toNum(matrix.y);
          const c = Math.cos(r), s = Math.sin(r);
          m = [c * w / 1638.4, s * h / 1638.4, -s * w / 1638.4, c * h / 1638.4, x + w / 2, y + h / 2];
        } else if (matrix.a !== undefined) m = [toNum(matrix.a), toNum(matrix.b), toNum(matrix.c), toNum(matrix.d), toNum(matrix.tx), toNum(matrix.ty)];
      }
      g.fill = { f: { t: type === 'radial' ? 'r' : 'l', m, stops, spread: 0, interp: 0 }, d: `M${g.x} ${g.y}`, sx: g.x, sy: g.y };
      g.cmds.push(g.fill);
    }
    endFill() {
      const g = this.$g();
      if (g.fill) { g.fill.d += ` L${g.fill.sx} ${g.fill.sy} Z`; g.fill.path = null; g.fill = null; }
    }
    $gpt(x, y) {
      const g = this.$g(); const w = g.line ? g.line.w / 2 : 0;
      g.b = union(g.b, [Math.min(x, g.x) - w, Math.min(y, g.y) - w, Math.max(x, g.x) + w, Math.max(y, g.y) + w]);
    }
    moveTo(x, y) {
      const g = this.$g(); x = toNum(x); y = toNum(y); if (!isFinite(x) || !isFinite(y)) return;
      if (g.fill) { g.fill.d += ` L${g.fill.sx} ${g.fill.sy} M${x} ${y}`; g.fill.sx = x; g.fill.sy = y; g.fill.path = null; }
      g.x = x; g.y = y; g.lineCmd = null;
    }
    lineTo(x, y) {
      const g = this.$g(); x = toNum(x); y = toNum(y); if (!isFinite(x) || !isFinite(y)) return;
      this.$gpt(x, y);
      if (g.fill) { g.fill.d += ` L${x} ${y}`; g.fill.path = null; }
      if (g.line) {
        if (!g.lineCmd || g.lineCmd.l !== g.line) { g.lineCmd = { l: g.line, d: `M${g.x} ${g.y}` }; g.cmds.push(g.lineCmd); }
        g.lineCmd.d += ` L${x} ${y}`; g.lineCmd.path = null;
      }
      g.x = x; g.y = y;
    }
    curveTo(cx, cy, x, y) {
      const g = this.$g(); cx = toNum(cx); cy = toNum(cy); x = toNum(x); y = toNum(y); if (![cx, cy, x, y].every(isFinite)) return;
      this.$gpt(cx, cy); this.$gpt(x, y);
      if (g.fill) { g.fill.d += ` Q${cx} ${cy} ${x} ${y}`; g.fill.path = null; }
      if (g.line) {
        if (!g.lineCmd || g.lineCmd.l !== g.line) { g.lineCmd = { l: g.line, d: `M${g.x} ${g.y}` }; g.cmds.push(g.lineCmd); }
        g.lineCmd.d += ` Q${cx} ${cy} ${x} ${y}`; g.lineCmd.path = null;
      }
      g.x = x; g.y = y;
    }
  }
  Object.assign(MovieClip.prototype, containerMethods);
  F.MovieClip = MovieClip;

  const METHOD_NAMES = { load: 'onLoad', enterFrame: 'onEnterFrame', unload: 'onUnload', mouseDown: 'onMouseDown', mouseUp: 'onMouseUp', mouseMove: 'onMouseMove', keyDown: 'onKeyDown', keyUp: 'onKeyUp', press: 'onPress', release: 'onRelease', releaseOutside: 'onReleaseOutside', rollOver: 'onRollOver', rollOut: 'onRollOut', dragOver: 'onDragOver', dragOut: 'onDragOut', data: 'onData' };
  const BUTTON_METHODS = ['onPress', 'onRelease', 'onReleaseOutside', 'onRollOver', 'onRollOut', 'onDragOver', 'onDragOut'];
  const BUTTON_LABELS = { rollOut: '_up', releaseOutside: '_up', rollOver: '_over', release: '_over', dragOut: '_over', press: '_down', dragOver: '_down' };
  F.METHOD_NAMES = METHOD_NAMES; F.BUTTON_METHODS = BUTTON_METHODS;

  // ---------------------------------------------------------------- Button (DefineButton2)
  class Button extends DisplayObject {
    constructor(player, def, id) {
      super(player, def, id);
      const $ = this.$;
      $.children = new Map(); $.list = null; $.state = -1; $.enabled = true; $.hand = true; $.hit = null;
    }
    $setState(state) {
      const $ = this.$; const p = $.player;
      if ($.state === state) return;
      $.state = state;
      const bit = state === 0 ? 1 : state === 1 ? 2 : 4;
      const keep = new Set();
      const created = [];
      for (const rec of $.def.records) {
        if (!(rec.states & bit)) continue;
        keep.add(rec.depth);
        let child = $.children.get(rec.depth);
        if (!child || child.$.id !== rec.id) {
          child = p.instantiate(rec.id);
          if (!child) continue;
          child.$.name = 'instance' + (++instanceCounter);
          child.$.parent = this; child.$.depth = rec.depth;
          created.push([child, rec.depth]);
        }
        child.$.m = rec.m.slice(); child.$.scaleCached = false; child.$.cx = rec.cx ? rec.cx.slice() : null;
        child.$.filters = rec.filters && rec.filters.length ? rec.filters : null; child.$.blend = rec.blend || 0;
      }
      for (const [d, c] of [...$.children]) if (!keep.has(d)) { $.children.delete(d); c.$unload(); }
      for (const [c, d] of created) {
        const prev = $.children.get(d); if (prev && prev !== c) prev.$unload();
        $.children.set(d, c);
        p.postInstantiate(c, true);
      }
      $.list = null;
    }
    $hitInstances() {
      const $ = this.$;
      if (!$.hit) {
        $.hit = [];
        for (const rec of $.def.records) if (rec.states & 8) {
          const c = $.player.instantiate(rec.id, true); if (!c) continue;
          c.$.parent = this; c.$.m = rec.m.slice(); c.$.depth = rec.depth;
          if (c instanceof MovieClip) { c.$.playing = false; c.$runFrame(true, false); }
          $.hit.push(c);
        }
      }
      return $.hit;
    }
    $bounds() { return this.$containerBounds(); }
    $hitShape(gx, gy, pick) { return this.$hitChildren(gx, gy, pick); }
    $hitArea(gx, gy) {
      for (const c of this.$hitInstances()) if (c.$hitShape(gx, gy, false)) return true;
      return false;
    }
    $unload() {
      const $ = this.$;
      for (const c of $.children.values()) c.$unload();
      if (!$.removed) { $.removed = true; $.player.onClipRemoved(this); }
    }
    get enabled() { return this.$.enabled; } set enabled(v) { this.$.enabled = asBool(v); }
    get useHandCursor() { return this.$.hand; } set useHandCursor(v) { this.$.hand = asBool(v); }
    get trackAsMenu() { return false; } set trackAsMenu(v) { }
    get tabEnabled() { return false; } set tabEnabled(v) { }
  }
  Object.assign(Button.prototype, containerMethods);
  F.Button = Button;

  // ---------------------------------------------------------------- TextField
  class TextField extends DisplayObject {
    constructor(player, def, id) {
      super(player, def, id);
      const $ = this.$;
      const d = def || { b: [0, 0, 100, 100], size: 12, color: [0, 0, 0, 255], align: 0, font: null, leading: 0, v: '', text: '', wrap: false, multi: false, ro: false, auto: false, nosel: false, border: false, html: false, dynamic: true };
      $.def = d;
      if (def) { $.x0 = d.b[0]; $.y0 = d.b[1]; $.w = d.b[2] - d.b[0]; $.h = d.b[3] - d.b[1]; }
      else { $.x0 = 0; $.y0 = 0; $.w = 100; $.h = 100; }
      const fontDef = d.font !== undefined && d.font !== null ? player.chars[d.font] : null;
      const align = ['left', 'right', 'center', 'justify'][d.align || 0] || 'left';
      $.fmt = { font: fontDef ? fontDef.name : (def ? '_sans' : 'Times New Roman'), size: d.size || 12, color: d.color ? ((d.color[0] << 16) | (d.color[1] << 8) | d.color[2]) : 0, bold: fontDef ? !!fontDef.bold : false, italic: fontDef ? !!fontDef.italic : false, underline: false, align, leftMargin: d.lm || 0, rightMargin: d.rm || 0, indent: d.indent || 0, leading: d.leading || 0, url: '', target: '' };
      $.wordWrap = !!d.wrap; $.multiline = !!d.multi; $.selectable = !d.nosel; $.border = !!d.border; $.background = !!d.border;
      $.borderColor = 0; $.backgroundColor = 0xFFFFFF; $.html = !!d.html; $.type = d.ro || !def ? (def ? 'dynamic' : 'dynamic') : 'input';
      $.password = !!d.pass; $.maxChars = d.maxLen || null; $.autoSize = d.auto ? 'left' : 'none'; $.embedFonts = !!d.outlines;
      $.variable = d.v || null; $.runs = [];
      $.layout = null; $.condenseWhite = false;
      $.textAlpha = d.color ? d.color[3] / 255 : 1;
      this.$setContent(d.text || '', $.html);
    }
    // runs: [{text, fmt}] ; newlines as '\n'
    $setContent(s, html) {
      const $ = this.$;
      s = toStr(s);
      if (html) $.runs = F.text.parseHtml(s, $.fmt, $.condenseWhite);
      else $.runs = [{ text: s.replace(/\r\n?/g, '\n'), fmt: Object.assign({}, $.fmt) }];
      $.layout = null;
    }
    $plain() { return this.$.runs.map(r => r.text).join('').replace(/\n/g, '\r'); }
    $bounds() { const $ = this.$; this.$doLayout(); return [$.x0, $.y0, $.x0 + $.w, $.y0 + $.h]; }
    $doLayout() {
      const $ = this.$;
      if ($.layout) return $.layout;
      const L = $.layout = F.text.layout(this);
      if ($.autoSize !== 'none' && $.autoSize !== false) {
        const nw = $.wordWrap ? $.w : L.width + 4, nh = L.height + 4;
        if (!$.wordWrap) {
          if ($.autoSize === 'right') $.x0 += $.w - nw; else if ($.autoSize === 'center') $.x0 += ($.w - nw) / 2;
          $.w = nw;
        }
        $.h = nh;
        if (!$.wordWrap) { $.layout = null; const L2 = $.layout = F.text.layout(this); return L2; }
      }
      return L;
    }
    $hitShape(gx, gy) { const p = apply(inv(this.$world()), gx, gy); const b = this.$bounds(); return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]; }
    $syncVar() {
      const $ = this.$;
      if (!$.variable || !$.parent) return;
      const r = F.resolveVar($.parent, $.variable);
      if (!r) return;
      const v = r.obj[r.key];
      if (v === undefined) return;
      const s = toStr(v);
      if (s !== $.lastVar) { $.lastVar = s; this.$setContent(s, $.html); }
    }
    $bindInit() {
      const $ = this.$;
      if (!$.variable || !$.parent) return;
      const r = F.resolveVar($.parent, $.variable);
      if (!r) return;
      if (r.obj[r.key] === undefined) { r.obj[r.key] = $.html ? this.htmlText : this.$plain(); $.lastVar = toStr(r.obj[r.key]); }
      else this.$syncVar();
    }
    $writeVar() {
      const $ = this.$;
      if (!$.variable || !$.parent) return;
      const r = F.resolveVar($.parent, $.variable);
      if (r) { r.obj[r.key] = this.$plain(); $.lastVar = r.obj[r.key]; }
    }
    $unload() { this.$.removed = true; }
    // AS API
    get text() { this.$syncVar(); return this.$plain(); }
    set text(v) { this.$setContent(toStr(v), false); this.$writeVar(); }
    get htmlText() { this.$syncVar(); return this.$.html ? F.text.toHtml(this.$.runs) : this.$plain(); }
    set htmlText(v) { this.$setContent(toStr(v), this.$.html); this.$writeVar(); }
    get html() { return this.$.html; } set html(v) { this.$.html = asBool(v); }
    get length() { return this.$plain().length; }
    get textWidth() { return this.$doLayout().width; }
    get textHeight() { return this.$doLayout().height; }
    get _width() { this.$doLayout(); return super._width; }
    set _width(v) { v = toNum(v); if (!isFinite(v)) return; this.$.w = Math.max(0, v); this.$.layout = null; }
    get _height() { this.$doLayout(); return super._height; }
    set _height(v) { v = toNum(v); if (!isFinite(v)) return; this.$.h = Math.max(0, v); this.$.layout = null; }
    get autoSize() { return this.$.autoSize; }
    set autoSize(v) { const $ = this.$; $.autoSize = v === true ? 'left' : (v === false || v === undefined || v === null) ? 'none' : toStr(v).toLowerCase(); $.layout = null; }
    get wordWrap() { return this.$.wordWrap; } set wordWrap(v) { this.$.wordWrap = asBool(v); this.$.layout = null; }
    get multiline() { return this.$.multiline; } set multiline(v) { this.$.multiline = asBool(v); this.$.layout = null; }
    get selectable() { return this.$.selectable; } set selectable(v) { this.$.selectable = asBool(v); }
    get border() { return this.$.border; } set border(v) { this.$.border = asBool(v); }
    get background() { return this.$.background; } set background(v) { this.$.background = asBool(v); }
    get borderColor() { return this.$.borderColor; } set borderColor(v) { this.$.borderColor = toNum(v) | 0; }
    get backgroundColor() { return this.$.backgroundColor; } set backgroundColor(v) { this.$.backgroundColor = toNum(v) | 0; }
    get textColor() { return this.$.fmt.color; } set textColor(v) { const c = toNum(v) | 0; this.$.fmt.color = c; for (const r of this.$.runs) r.fmt.color = c; this.$.layout = null; }
    get embedFonts() { return this.$.embedFonts; } set embedFonts(v) { this.$.embedFonts = asBool(v); }
    get type() { return this.$.type; } set type(v) { this.$.type = toStr(v) === 'input' ? 'input' : 'dynamic'; }
    get variable() { return this.$.variable || null; } set variable(v) { this.$.variable = v ? toStr(v) : null; this.$bindInit(); }
    get password() { return this.$.password; } set password(v) { this.$.password = asBool(v); }
    get maxChars() { return this.$.maxChars; } set maxChars(v) { this.$.maxChars = v === null ? null : toNum(v) | 0; }
    get condenseWhite() { return this.$.condenseWhite; } set condenseWhite(v) { this.$.condenseWhite = asBool(v); }
    get antiAliasType() { return 'normal'; } set antiAliasType(v) { }
    get gridFitType() { return 'none'; } set gridFitType(v) { }
    get sharpness() { return 0; } set sharpness(v) { }
    get thickness() { return 0; } set thickness(v) { }
    get scroll() { return 1; } set scroll(v) { }
    get maxscroll() { return 1; }
    get hscroll() { return 0; } set hscroll(v) { }
    get maxhscroll() { return 0; }
    get bottomScroll() { return 1; }
    get mouseWheelEnabled() { return false; } set mouseWheelEnabled(v) { }
    get restrict() { return this.$.restrict || null; } set restrict(v) { this.$.restrict = v ? toStr(v) : null; }
    get styleSheet() { return undefined; } set styleSheet(v) { }
    get tabEnabled() { return false; } set tabEnabled(v) { }
    getTextFormat(b, e) {
      const runs = this.$.runs;
      const f = runs.length ? runs[0].fmt : this.$.fmt;
      const tf = new F.TextFormatClass();
      for (const k of ['font', 'size', 'color', 'bold', 'italic', 'underline', 'align', 'leftMargin', 'rightMargin', 'indent', 'leading', 'url', 'target']) tf[k] = f[k];
      return tf;
    }
    getNewTextFormat() { return this.getTextFormat(); }
    setTextFormat(a, b, c) {
      let fmt = a, start = 0, end = Infinity;
      if (typeof a === 'number') { start = a; if (typeof b === 'number') { end = b; fmt = c; } else { end = a + 1; fmt = b; } }
      if (!fmt || typeof fmt !== 'object') return;
      const $ = this.$;
      const apply1 = (f) => { for (const k of ['font', 'size', 'color', 'bold', 'italic', 'underline', 'align', 'leftMargin', 'rightMargin', 'indent', 'leading', 'url', 'target']) if (fmt[k] !== null && fmt[k] !== undefined) f[k] = (k === 'size' || k === 'color' || k === 'leftMargin' || k === 'rightMargin' || k === 'indent' || k === 'leading') ? toNum(fmt[k]) : fmt[k]; };
      if (start <= 0 && end === Infinity) { for (const r of $.runs) apply1(r.fmt); if (!$.runs.length || $.plainLen === 0) apply1($.fmt); }
      else {
        // split runs at boundaries
        const out = []; let pos = 0;
        for (const r of $.runs) {
          const s = pos, e = pos + r.text.length; pos = e;
          const cuts = [s, Math.max(s, Math.min(e, start)), Math.max(s, Math.min(e, end)), e];
          for (let i = 0; i < 3; i++) {
            if (cuts[i + 1] <= cuts[i]) continue;
            const nr = { text: r.text.slice(cuts[i] - s, cuts[i + 1] - s), fmt: Object.assign({}, r.fmt) };
            if (i === 1) apply1(nr.fmt);
            out.push(nr);
          }
        }
        $.runs = out;
      }
      $.layout = null;
    }
    setNewTextFormat(fmt) {
      if (!fmt) return; const f = this.$.fmt;
      for (const k of ['font', 'size', 'color', 'bold', 'italic', 'underline', 'align', 'leftMargin', 'rightMargin', 'indent', 'leading', 'url', 'target']) if (fmt[k] !== null && fmt[k] !== undefined) f[k] = (k === 'size' || k === 'color') ? toNum(fmt[k]) : fmt[k];
    }
    replaceSel(s) { this.text = this.$plain() + toStr(s); }
    replaceText(b, e, s) { const t = this.$plain(); this.text = t.slice(0, b) + toStr(s) + t.slice(e); }
    removeTextField() {
      const p = this.$.parent;
      if (!p || this.$.depth < TL_MAX) return;
      p.$removeChild(this);
    }
    getDepth() { return this.$.depth - TL_MAX; }
    addListener() { return true; } removeListener() { return true; }
    getFontList() { return ['_sans', '_serif', '_typewriter', 'Arial', 'Verdana', 'Tahoma']; }
  }
  F.TextField = TextField;

  // mark native methods (bound when accessed through the scope chain)
  for (const C of [DisplayObject, MovieClip, Button, TextField]) {
    for (const k of Object.getOwnPropertyNames(C.prototype)) {
      if (k === 'constructor' || k[0] === '$') continue;
      const d = Object.getOwnPropertyDescriptor(C.prototype, k);
      if (typeof d.value === 'function') d.value.$native = true;
    }
  }

  // ---------------------------------------------------------------- paths
  function child(obj, name) {
    if (!obj) return undefined;
    if (name === '_root' || name === '_level0') return obj.$ ? obj.$.player.root : F.player.root;
    if (name === '_parent') return obj.$ ? obj.$.parent || undefined : undefined;
    if (name === 'this' || name === '') return obj;
    if (name === '_global') return F.GLOBALS;
    let v = obj[name];
    if (v === undefined && obj instanceof MovieClip) v = obj.$childByName(name);
    return v;
  }
  F.resolvePath = function (base, path) {
    path = toStr(path);
    if (path === '') return base;
    let obj = base;
    if (path[0] === '/') { obj = base.$.player.root; path = path.slice(1); if (!path) return obj; }
    const parts = path.split(/[./:]/);
    for (let i = 0; i < parts.length; i++) {
      let p = parts[i];
      if (p === '..') { obj = obj && obj.$ ? obj.$.parent : undefined; continue; }
      if (p === '' && i === 0) continue;
      obj = child(obj, p);
      if (obj === undefined || obj === null) return undefined;
    }
    return obj;
  };
  F.resolveTarget = function (t, base) {
    if (t instanceof DisplayObject) return t;
    if (typeof t === 'string') { const r = F.resolvePath(base, t); return r instanceof DisplayObject ? r : undefined; }
    return undefined;
  };
  F.resolveVar = function (base, path) {
    path = toStr(path);
    let objPath = '', key = path;
    const ci = path.lastIndexOf(':');
    if (ci >= 0) { objPath = path.slice(0, ci); key = path.slice(ci + 1); }
    else { const di = path.lastIndexOf('.'); if (di >= 0) { objPath = path.slice(0, di); key = path.slice(di + 1); } }
    const obj = objPath ? F.resolvePath(base, objPath) : base;
    if (!obj || typeof obj !== 'object') return null;
    return { obj, key };
  };
})();
