// AS2 semantics helpers and global objects for the transpiled game scripts.
'use strict';
(function () {
  const F = window.F = window.F || {};

  // ---------- value conversion (AS2 rules) ----------
  function numStr(n) {
    if (n !== n) return 'NaN';
    if (n === Infinity) return 'Infinity';
    if (n === -Infinity) return '-Infinity';
    if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
    let s = String(+n.toPrecision(15));
    if (s.includes('e')) s = s.replace(/e\+?/, 'e+').replace('e+-', 'e-');
    return s;
  }
  function toStr(v) {
    switch (typeof v) {
      case 'string': return v;
      case 'number': return numStr(v);
      case 'undefined': return 'undefined';
      case 'boolean': return v ? 'true' : 'false';
      case 'function': return '[type Function]';
    }
    if (v === null) return 'null';
    if (v instanceof F.DisplayObject) return v.$path();
    if (Array.isArray(v)) return v.map(x => (x === undefined || x === null) ? '' : toStr(x)).join(',');
    try { return String(v); } catch (e) { return '[object Object]'; }
  }
  function toNum(v) {
    if (typeof v === 'number') return v;
    if (v === undefined || v === null) return NaN;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') { const s = v.trim(); if (s === '') return NaN; return Number(s); }
    return Number(v);
  }
  F.numStr = numStr; F.toStr = toStr; F.toNum = toNum;

  window.$$add = function (a, b) {
    const ta = typeof a, tb = typeof b;
    if (ta === 'number' && tb === 'number') return a + b;
    if (ta === 'string' || tb === 'string') return toStr(a) + toStr(b);
    if ((ta === 'object' || ta === 'function') && a !== null) { if (a instanceof F.DisplayObject || Array.isArray(a)) return toStr(a) + toStr(b); a = a.valueOf(); if (typeof a === 'string') return a + toStr(b); }
    if ((tb === 'object' || tb === 'function') && b !== null) { if (b instanceof F.DisplayObject || Array.isArray(b)) return toStr(a) + toStr(b); b = b.valueOf(); if (typeof b === 'string') return toStr(a) + b; }
    return toNum(a) + toNum(b);
  };
  window.$$adds = function (o, k, v) {
    if (o === undefined || o === null) return $$add(undefined, v);
    return (o[k] = $$add(o[k], v));
  };
  const SINK = new Proxy({}, { set() { return true; }, get() { return undefined; } });
  window.$$o = function (o) { return (o === undefined || o === null) ? SINK : o; };
  // AS2 for..in enumerates the most recently added properties first.
  window.$$keys = function (o) {
    if (o === undefined || o === null || typeof o !== 'object') return [];
    return Object.keys(o).reverse();
  };

  // ---------- scope chain ----------
  const GLOBALS = F.GLOBALS = Object.create(null);
  const scopeHandler = {
    has(t, k) { return typeof k === 'string' && k.charCodeAt(0) !== 36; /* '$' */ },
    get(t, k) {
      if (typeof k !== 'string') return undefined;
      if (k in t) {
        const v = t[k];
        if (typeof v === 'function' && v.$native) {
          const b = t.$.bound || (t.$.bound = Object.create(null));
          return b[k] || (b[k] = v.bind(t));
        }
        return v;
      }
      if (k in GLOBALS) return GLOBALS[k];
      return undefined;
    },
    set(t, k, v) { t[k] = v; return true; },
  };
  F.makeScope = (obj) => new Proxy(obj, scopeHandler);

  // ---------- Array additions ----------
  const AFLAGS = { CASEINSENSITIVE: 1, DESCENDING: 2, UNIQUESORT: 4, RETURNINDEXEDARRAY: 8, NUMERIC: 16 };
  for (const k in AFLAGS) Object.defineProperty(Array, k, { value: AFLAGS[k] });
  function cmpWith(opts) {
    return (x, y) => {
      let r;
      if (opts & 16) { const a = toNum(x), b = toNum(y); r = a < b ? -1 : a > b ? 1 : 0; if (a !== a || b !== b) r = (a !== a ? 1 : 0) - (b !== b ? 1 : 0); }
      else { let a = toStr(x), b = toStr(y); if (opts & 1) { a = a.toLowerCase(); b = b.toLowerCase(); } r = a < b ? -1 : a > b ? 1 : 0; }
      return (opts & 2) ? -r : r;
    };
  }
  const nativeSort = Array.prototype.sort;
  function finishSort(arr, sorted, opts) {
    if (opts & 8) return sorted.map(e => e.i);
    for (let i = 0; i < sorted.length; i++) arr[i] = sorted[i].v;
    return arr;
  }
  Object.defineProperty(Array.prototype, 'sort', {
    configurable: true, writable: true, value: function (a, b) {
      if (typeof a === 'function') {
        if (typeof b === 'number') { const w = this.map((v, i) => ({ v, i })); nativeSort.call(w, (x, y) => (b & 2 ? -1 : 1) * (toNum(a(x.v, y.v)) || 0)); return finishSort(this, w, b); }
        return nativeSort.call(this, (x, y) => toNum(a(x, y)) || 0);
      }
      const opts = typeof a === 'number' ? a : 0;
      const c = cmpWith(opts);
      const w = this.map((v, i) => ({ v, i }));
      nativeSort.call(w, (x, y) => c(x.v, y.v));
      return finishSort(this, w, opts);
    }
  });
  Object.defineProperty(Array.prototype, 'sortOn', {
    configurable: true, writable: true, value: function (names, options) {
      if (!Array.isArray(names)) names = [names];
      const opts = names.map((_, i) => Array.isArray(options) ? (options[i] | 0) : (options | 0));
      const cs = opts.map(cmpWith);
      const w = this.map((v, i) => ({ v, i }));
      nativeSort.call(w, (x, y) => {
        for (let i = 0; i < names.length; i++) {
          const r = cs[i](x.v == null ? undefined : x.v[names[i]], y.v == null ? undefined : y.v[names[i]]);
          if (r) return r;
        }
        return 0;
      });
      return finishSort(this, w, opts[0] || 0);
    }
  });

  // ---------- Key ----------
  const keysDown = new Set();
  let lastKey = 0, lastAscii = 0;
  const Key = {
    BACKSPACE: 8, CAPSLOCK: 20, CONTROL: 17, DELETEKEY: 46, DOWN: 40, END: 35, ENTER: 13, ESCAPE: 27, HOME: 36, INSERT: 45, LEFT: 37, PGDN: 34, PGUP: 33, RIGHT: 39, SHIFT: 16, SPACE: 32, TAB: 9, UP: 38,
    $listeners: [],
    isDown(c) { return keysDown.has(toNum(c)); },
    isToggled() { return false; },
    getCode() { return lastKey; },
    getAscii() { return lastAscii; },
    addListener(o) { if (!Key.$listeners.includes(o)) Key.$listeners.push(o); },
    removeListener(o) { const i = Key.$listeners.indexOf(o); if (i >= 0) { Key.$listeners.splice(i, 1); return true; } return false; },
  };
  F.keyDown = (code, ascii) => { keysDown.add(code); lastKey = code; lastAscii = ascii; };
  F.keyUp = (code) => { keysDown.delete(code); lastKey = code; };
  F.clearKeys = () => keysDown.clear();
  F.Key = Key;

  const Mouse = {
    $listeners: [],
    addListener(o) { if (!Mouse.$listeners.includes(o)) Mouse.$listeners.push(o); },
    removeListener(o) { const i = Mouse.$listeners.indexOf(o); if (i >= 0) { Mouse.$listeners.splice(i, 1); return true; } return false; },
    hide() { F.player && F.player.setMouseHidden(true); return 1; },
    show() { F.player && F.player.setMouseHidden(false); return 0; },
  };
  F.Mouse = Mouse;

  const Stage = {
    get width() { return F.player.width; }, get height() { return F.player.height; },
    scaleMode: 'showAll', align: '', showMenu: true,
    $listeners: [], addListener(o) { Stage.$listeners.push(o); }, removeListener(o) { const i = Stage.$listeners.indexOf(o); if (i >= 0) Stage.$listeners.splice(i, 1); },
  };

  // ---------- SharedObject (localStorage) ----------
  const soCache = {};
  const SharedObject = {
    getLocal(name) {
      name = toStr(name);
      if (soCache[name]) return soCache[name];
      const key = 'sonny.so.' + name;
      let data = {};
      try { const s = localStorage.getItem(key); if (s) data = JSON.parse(s) || {}; } catch (e) { }
      const so = {
        data,
        flush() { try { localStorage.setItem(key, JSON.stringify(so.data)); } catch (e) { console.warn('flush failed', e); } return true; },
        clear() { for (const k in so.data) delete so.data[k]; try { localStorage.removeItem(key); } catch (e) { } },
        getSize() { try { return (localStorage.getItem(key) || '').length; } catch (e) { return 0; } },
        close() { },
      };
      return (soCache[name] = so);
    }
  };

  // ---------- Color / geom / filters ----------
  function Color(target) { this.$t = target; }
  Color.prototype.$clip = function () { const t = this.$t; return t instanceof F.DisplayObject && !t.$.removed ? t : (typeof t === 'string' ? F.resolvePath(F.player.root, t) : undefined); };
  Color.prototype.setRGB = function (rgb) {
    const c = this.$clip(); if (!c) return; rgb = toNum(rgb) | 0;
    const cx = c.$cx();
    c.$setCx([0, 0, 0, cx[3], (rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, cx[7]]);
  };
  Color.prototype.getRGB = function () { const c = this.$clip(); if (!c) return 0; const x = c.$cx(); return ((x[4] & 255) << 16) | ((x[5] & 255) << 8) | (x[6] & 255); };
  Color.prototype.setTransform = function (o) {
    const c = this.$clip(); if (!c || !o) return; const x = c.$cx().slice();
    if (o.ra !== undefined) x[0] = toNum(o.ra) / 100; if (o.ga !== undefined) x[1] = toNum(o.ga) / 100; if (o.ba !== undefined) x[2] = toNum(o.ba) / 100; if (o.aa !== undefined) x[3] = toNum(o.aa) / 100;
    if (o.rb !== undefined) x[4] = toNum(o.rb); if (o.gb !== undefined) x[5] = toNum(o.gb); if (o.bb !== undefined) x[6] = toNum(o.bb); if (o.ab !== undefined) x[7] = toNum(o.ab);
    c.$setCx(x);
  };
  Color.prototype.getTransform = function () { const c = this.$clip(); const x = c ? c.$cx() : [1, 1, 1, 1, 0, 0, 0, 0]; return { ra: x[0] * 100, ga: x[1] * 100, ba: x[2] * 100, aa: x[3] * 100, rb: x[4], gb: x[5], bb: x[6], ab: x[7] }; };

  class ColorTransform {
    constructor(rm = 1, gm = 1, bm = 1, am = 1, ro = 0, go = 0, bo = 0, ao = 0) {
      this.redMultiplier = rm; this.greenMultiplier = gm; this.blueMultiplier = bm; this.alphaMultiplier = am;
      this.redOffset = ro; this.greenOffset = go; this.blueOffset = bo; this.alphaOffset = ao;
    }
    get rgb() { return ((this.redOffset & 255) << 16) | ((this.greenOffset & 255) << 8) | (this.blueOffset & 255); }
    set rgb(v) { v = toNum(v) | 0; this.redMultiplier = this.greenMultiplier = this.blueMultiplier = 0; this.redOffset = (v >> 16) & 255; this.greenOffset = (v >> 8) & 255; this.blueOffset = v & 255; }
    concat(o) { this.redOffset += o.redOffset * this.redMultiplier; this.greenOffset += o.greenOffset * this.greenMultiplier; this.blueOffset += o.blueOffset * this.blueMultiplier; this.alphaOffset += o.alphaOffset * this.alphaMultiplier; this.redMultiplier *= o.redMultiplier; this.greenMultiplier *= o.greenMultiplier; this.blueMultiplier *= o.blueMultiplier; this.alphaMultiplier *= o.alphaMultiplier; }
    toString() { return `(redMultiplier=${this.redMultiplier}, greenMultiplier=${this.greenMultiplier}, blueMultiplier=${this.blueMultiplier}, alphaMultiplier=${this.alphaMultiplier}, redOffset=${this.redOffset}, greenOffset=${this.greenOffset}, blueOffset=${this.blueOffset}, alphaOffset=${this.alphaOffset})`; }
    $arr() { return [toNum(this.redMultiplier), toNum(this.greenMultiplier), toNum(this.blueMultiplier), toNum(this.alphaMultiplier), toNum(this.redOffset), toNum(this.greenOffset), toNum(this.blueOffset), toNum(this.alphaOffset)]; }
  }
  class Matrix {
    constructor(a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0) { this.a = a; this.b = b; this.c = c; this.d = d; this.tx = tx; this.ty = ty; }
    clone() { return new Matrix(this.a, this.b, this.c, this.d, this.tx, this.ty); }
    identity() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.tx = 0; this.ty = 0; }
    translate(x, y) { this.tx += x; this.ty += y; }
    scale(x, y) { this.a *= x; this.b *= y; this.c *= x; this.d *= y; this.tx *= x; this.ty *= y; }
    rotate(r) { const c = Math.cos(r), s = Math.sin(r); const m = [this.a, this.b, this.c, this.d, this.tx, this.ty]; this.a = m[0] * c - m[1] * s; this.b = m[0] * s + m[1] * c; this.c = m[2] * c - m[3] * s; this.d = m[2] * s + m[3] * c; this.tx = m[4] * c - m[5] * s; this.ty = m[4] * s + m[5] * c; }
  }
  class Transform {
    constructor(mc) { this.$mc = mc; }
    get colorTransform() { const mc = this.$mc; const x = mc && mc.$ ? mc.$cx() : [1, 1, 1, 1, 0, 0, 0, 0]; return new ColorTransform(...x); }
    set colorTransform(ct) { const mc = this.$mc; if (!mc || !mc.$ || !ct) return; mc.$setCx(ct.$arr ? ct.$arr() : [1, 1, 1, 1, 0, 0, 0, 0]); }
    get concatenatedColorTransform() { return this.colorTransform; }
    get matrix() { const m = this.$mc && this.$mc.$ ? this.$mc.$.m : [1, 0, 0, 1, 0, 0]; return new Matrix(...m); }
    set matrix(v) { if (this.$mc && this.$mc.$ && v) this.$mc.$setMatrix([v.a, v.b, v.c, v.d, v.tx, v.ty]); }
  }
  class Point { constructor(x = 0, y = 0) { this.x = x; this.y = y; } }
  class Rectangle { constructor(x = 0, y = 0, w = 0, h = 0) { this.x = x; this.y = y; this.width = w; this.height = h; } }

  class BitmapFilter { clone() { return Object.assign(Object.create(Object.getPrototypeOf(this)), this); } }
  class GlowFilter extends BitmapFilter {
    constructor(color = 0xFF0000, alpha = 1, blurX = 6, blurY = 6, strength = 2, quality = 1, inner = false, knockout = false) {
      super(); Object.assign(this, { color, alpha, blurX, blurY, strength, quality, inner, knockout });
    }
  }
  class BlurFilter extends BitmapFilter { constructor(blurX = 4, blurY = 4, quality = 1) { super(); Object.assign(this, { blurX, blurY, quality }); } }
  class DropShadowFilter extends BitmapFilter {
    constructor(distance = 4, angle = 45, color = 0, alpha = 1, blurX = 4, blurY = 4, strength = 1, quality = 1, inner = false, knockout = false, hideObject = false) {
      super(); Object.assign(this, { distance, angle, color, alpha, blurX, blurY, strength, quality, inner, knockout, hideObject });
    }
  }
  class BevelFilter extends BitmapFilter { constructor() { super(); } }
  class ColorMatrixFilter extends BitmapFilter { constructor(matrix) { super(); this.matrix = matrix ? matrix.slice() : [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]; } }

  // Converts AS filter objects to the internal representation used by the renderer.
  F.toInternalFilters = function (arr) {
    if (!Array.isArray(arr)) return null;
    const out = [];
    for (const f of arr) {
      if (f instanceof GlowFilter) { const c = toNum(f.color) | 0; out.push({ t: 'glow', c: [(c >> 16) & 255, (c >> 8) & 255, c & 255, Math.round(Math.max(0, Math.min(1, toNum(f.alpha))) * 255)], bx: toNum(f.blurX), by: toNum(f.blurY), str: toNum(f.strength), inner: !!f.inner, knockout: !!f.knockout, passes: toNum(f.quality) | 0 }); }
      else if (f instanceof BlurFilter) out.push({ t: 'blur', bx: toNum(f.blurX), by: toNum(f.blurY), passes: toNum(f.quality) | 0 });
      else if (f instanceof DropShadowFilter) { const c = toNum(f.color) | 0; out.push({ t: 'shadow', c: [(c >> 16) & 255, (c >> 8) & 255, c & 255, Math.round(toNum(f.alpha) * 255)], bx: toNum(f.blurX), by: toNum(f.blurY), angle: toNum(f.angle) * Math.PI / 180, dist: toNum(f.distance), str: toNum(f.strength), inner: !!f.inner, knockout: !!f.knockout, hide: !!f.hideObject, passes: toNum(f.quality) | 0 }); }
      else if (f instanceof ColorMatrixFilter) out.push({ t: 'cmatrix', m: f.matrix.map(toNum) });
    }
    return out.length ? out : null;
  };
  F.fromInternalFilters = function (list) {
    if (!list) return [];
    return list.map(f => {
      const col = f.c ? (f.c[0] << 16) | (f.c[1] << 8) | f.c[2] : 0;
      if (f.t === 'glow') return new GlowFilter(col, f.c[3] / 255, f.bx, f.by, f.str, f.passes, f.inner, f.knockout);
      if (f.t === 'blur') return new BlurFilter(f.bx, f.by, f.passes);
      if (f.t === 'shadow') return new DropShadowFilter(f.dist, f.angle * 180 / Math.PI, col, f.c[3] / 255, f.bx, f.by, f.str, f.passes, f.inner, f.knockout, f.hide);
      if (f.t === 'cmatrix') return new ColorMatrixFilter(f.m);
      return new BevelFilter();
    });
  };

  function TextFormat(font, size, color, bold, italic, underline, url, target, align, leftMargin, rightMargin, indent, leading) {
    this.font = font === undefined ? null : font; this.size = size === undefined ? null : size; this.color = color === undefined ? null : color;
    this.bold = bold === undefined ? null : bold; this.italic = italic === undefined ? null : italic; this.underline = underline === undefined ? null : underline;
    this.url = url === undefined ? null : url; this.target = target === undefined ? null : target; this.align = align === undefined ? null : align;
    this.leftMargin = leftMargin === undefined ? null : leftMargin; this.rightMargin = rightMargin === undefined ? null : rightMargin;
    this.indent = indent === undefined ? null : indent; this.leading = leading === undefined ? null : leading;
    this.blockIndent = null; this.bullet = null; this.tabStops = null; this.letterSpacing = null; this.kerning = null;
  }
  TextFormat.prototype.getTextExtent = function (s) { const m = F.measureText ? F.measureText(toStr(s), this) : { w: 0, h: 0 }; return { width: m.w, height: m.h, textFieldWidth: m.w + 4, textFieldHeight: m.h + 4, ascent: m.h * 0.8, descent: m.h * 0.2 }; };

  const timers = new Map(); let timerId = 1;
  function asSetInterval(a, b, c, ...rest) {
    let fn, ms, args;
    if (typeof a === 'function') { fn = a; ms = b; args = c === undefined ? [] : [c, ...rest]; }
    else { const obj = a, name = b; ms = c; args = rest; fn = function () { const f = obj && obj[name]; if (typeof f === 'function') return f.apply(obj, arguments); }; }
    const idn = timerId++;
    const h = setInterval(() => { try { fn.apply(null, args); } catch (e) { console.error(e); } F.player && F.player.runActions(); }, Math.max(10, toNum(ms) || 10));
    timers.set(idn, h); return idn;
  }
  function asClearInterval(i) { const h = timers.get(i); if (h !== undefined) { clearInterval(h); timers.delete(i); } }

  Object.assign(GLOBALS, {
    Math, Array, Object, String, Number, Boolean, Date, Function, Error, RegExp,
    isNaN: (v) => isNaN(toNum(v)), isFinite: (v) => isFinite(toNum(v)), parseInt, parseFloat, escape, unescape, NaN, Infinity, undefined: undefined,
    trace: (...a) => { if (F.traceEnabled) console.log('[trace]', ...a.map(toStr)); },
    random: (n) => { n = toNum(n) | 0; return n > 0 ? Math.floor(Math.random() * n) : 0; },
    int: (v) => { const n = toNum(v); return n === n && isFinite(n) ? Math.trunc(n) | 0 : 0; },
    chr: (n) => String.fromCharCode(toNum(n)), ord: (s) => toStr(s).charCodeAt(0) || 0, mbchr: (n) => String.fromCharCode(toNum(n)), mbord: (s) => toStr(s).charCodeAt(0) || 0,
    length: (s) => toStr(s).length, substring: (s, i, n) => toStr(s).substr(toNum(i) - 1, toNum(n)),
    getTimer: () => {
      // Ticks run back-to-back when catching up; report each tick's scheduled
      // time so frame-rate measurements in game code stay sane.
      const p = F.player, now = performance.now();
      let t = (p && p.tickBase !== undefined ? p.tickBase + (now - p.tickReal) : now) - F.startTime;
      t = Math.max(F.$lastTimer || 0, t); F.$lastTimer = t;
      return Math.floor(t);
    },
    getVersion: () => 'WIN 8,0,0,0',
    getURL: (url) => { url = toStr(url); if (/^https?:/i.test(url)) window.open(url, '_blank', 'noopener'); },
    fscommand: () => { }, stopAllSounds: () => F.audio && F.audio.stopAll(),
    setInterval: asSetInterval, clearInterval: asClearInterval,
    setTimeout: (fn, ms, ...args) => { if (typeof fn !== 'function') return 0; return setTimeout(() => { try { fn(...args); } catch (e) { console.error(e); } F.player && F.player.runActions(); }, toNum(ms) || 0); },
    clearTimeout: (h) => clearTimeout(h),
    updateAfterEvent: () => { }, ASSetPropFlags: () => { }, ASnative: () => () => { },
    Key, Mouse, Stage, SharedObject, Color, TextFormat,
    Sound: function (t) { return new F.ASSound(t); },
    System: { security: { allowDomain() { }, allowInsecureDomain() { }, loadPolicyFile() { } }, capabilities: { version: 'WIN 8,0,0,0', os: 'Windows', playerType: 'PlugIn', screenResolutionX: 1920, screenResolutionY: 1080, language: 'en' }, useCodepage: false, showSettings() { }, setClipboard() { } },
    Selection: { setFocus(t) { F.player && F.player.setFocus(t); return true; }, getFocus() { return null; }, getBeginIndex: () => -1, getEndIndex: () => -1, getCaretIndex: () => -1, setSelection() { }, addListener() { }, removeListener() { } },
    LoadVars: function () { this.load = () => false; this.sendAndLoad = () => false; this.send = () => false; },
    XML: function () { this.load = () => false; this.ignoreWhite = false; },
    flash: { geom: { ColorTransform, Transform, Matrix, Point, Rectangle }, filters: { GlowFilter, BlurFilter, DropShadowFilter, BevelFilter, ColorMatrixFilter, BitmapFilter }, external: { ExternalInterface: { available: false, call() { }, addCallback() { return false; } } } },
  });
  Object.defineProperty(GLOBALS, '_global', { get() { return GLOBALS; } });
  Object.defineProperty(GLOBALS, '_level0', { get() { return F.player && F.player.root; } });
  F.ColorTransform = ColorTransform; F.TextFormatClass = TextFormat;
  F.Stage = Stage; F.Matrix = Matrix;
})();
