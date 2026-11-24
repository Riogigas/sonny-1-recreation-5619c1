// Player: owns the stage, runs the AVM1-style frame loop, action queue and input handling.
'use strict';
(function () {
  const F = window.F;
  const { mul, inv, apply, tBounds } = F.mat;
  const { toStr, toNum } = F;
  const TL_MAX = 16384;

  class Player {
    constructor(movie, scripts, canvas) {
      F.player = this;
      F.startTime = performance.now();
      this.movie = movie;
      this.chars = movie.chars; this.exports = movie.exports || {};
      this.scripts = scripts;
      this.bg = movie.bg || [255, 255, 255, 255];
      this.width = movie.w; this.height = movie.h; this.fps = movie.fps || 30;
      this.url = 'file:///sonny.swf'; this.quality = 'HIGH';
      this.canvas = canvas; this.ctx = canvas.getContext('2d');
      this.mouseX = 0; this.mouseY = 0; this.mouseDown = false;
      this.hovered = null; this.pressed = null; this.focus = null; this.drag = null;
      this.mouseHidden = false; this.caretBlink = 0;
      this.execList = []; this.queueList = []; this.running = false;
      this.errors = new Map();
      this.frameCount = 0;
      this.prepare(movie);
      this.root = new F.MovieClip(this, movie.root, 0);
      this.root.$.name = '';
      this.view = { x: 0, y: 0, w: movie.w, h: movie.h, s: 1 };
      this.resize();
      this.bindInput();
      this.postInstantiate(this.root, true);
      this.runActions();
    }
    prepare(movie) {
      const walk = (sid, tl) => {
        tl.frames.forEach((ops, f) => { for (const op of ops) if (op.op === 'place' && op.actions) op.$akey = `${sid}:${f}:${op.depth}`; });
      };
      walk(0, movie.root);
      for (const id in movie.chars) { const c = movie.chars[id]; if (c.t === 'sprite') walk(id, c); }
    }

    // ------------------------------------------------------------ hooks used by display.js
    instantiate(id) {
      const def = this.chars[id];
      if (!def) return null;
      id = +id;
      switch (def.t) {
        case 'sprite': return new F.MovieClip(this, def, id);
        case 'shape': return new F.Shape(this, def, id);
        case 'stext': return new F.StaticText(this, def, id);
        case 'edit': return new F.TextField(this, def, id);
        case 'button': return new F.Button(this, def, id);
        case 'bitmap': return new F.BitmapObj(this, def, id);
        default: return null;
      }
    }
    postInstantiate(child, runFrame) {
      if (child instanceof F.MovieClip) {
        this.execList.push(child);
        if (runFrame) child.$runFrameAvm1();
      } else if (child instanceof F.TextField) child.$bindInit();
      else if (child instanceof F.Button) child.$setState(0);
    }
    frameScript(sid, f, idx) { return this.scripts.frame[`${sid}:${f}:${idx}`]; }
    clipScripts(akey) { return this.scripts.clip[akey] || null; }
    buttonScripts(id) { return this.scripts.button[id] || null; }
    queue(clip, fn, isUnload, tag) { this.queueList.push({ clip, fn, isUnload, tag }); }
    queueMethod(clip, name, isUnload) { if (typeof clip[name] === 'function' || isUnload) this.queueList.push({ clip, method: name, isUnload }); else this.queueList.push({ clip, method: name, isUnload }); }
    queueFn(clip, js) { this.queueList.push({ clip, js, isUnload: true }); }
    onClipRemoved(obj) {
      if (this.drag && (this.drag.t === obj)) this.drag = null;
      if (this.hovered === obj) this.hovered = null;
      if (this.pressed === obj) this.pressed = null;
      if (this.focus === obj) this.focus = null;
    }
    runActions() {
      if (this.running) return;
      this.running = true;
      try {
        let guard = 0;
        while (this.queueList.length) {
          const a = this.queueList.shift();
          if (++guard > 200000) { console.warn('action queue overflow'); this.queueList.length = 0; break; }
          if (a.clip && a.clip.$ && a.clip.$.removed && !a.isUnload) continue;
          try {
            if (a.fn) a.fn.call(a.clip, a.clip.$scope());
            else if (a.method) { const f = a.clip[a.method]; if (typeof f === 'function') f.call(a.clip); }
            else if (a.js) a.js();
          } catch (e) { this.reportError(e, a); }
        }
      } finally { this.running = false; }
    }
    reportError(e, a) {
      const key = (a.tag || a.method || 'js') + ':' + (e && e.message);
      const n = (this.errors.get(key) || 0) + 1; this.errors.set(key, n);
      if (n <= 2) console.warn('[AS error]', a.tag || a.method || '', a.clip && a.clip.$ ? a.clip.$path() : '', e && e.stack || e);
    }

    // ------------------------------------------------------------ frame loop
    tick() {
      this.frameCount++;
      const list = this.execList.slice();
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i];
        if (c.$.removed) continue;
        c.$runFrameAvm1();
      }
      if (this.execList.some(c => c.$.removed)) this.execList = this.execList.filter(c => !c.$.removed);
      this.runActions();
      if (F.audio && F.audio.streams.size) F.audio.tickStreams(this.frameCount);
      this.updateDrag();
      this.updateHover();
      this.runActions();
      this.caretBlink++;
    }
    start() {
      const step = 1000 / this.fps;
      let last = performance.now(), acc = 0;
      const loop = (now) => {
        acc += Math.min(250, now - last); last = now;
        let n = 0;
        while (acc >= step && n < 4) { acc -= step; n++; this.tickBase = now - acc; this.tickReal = performance.now(); try { this.tick(); } catch (e) { console.error(e); } }
        if (acc > step * 4) acc = 0;
        if (n) this.render();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    render() {
      try { F.render.frame(this.ctx, this, this.view); } catch (e) { console.error('render', e); }
    }
    resize() {
      const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.max(1, Math.round(c.clientWidth * dpr)), ch = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
      const s = Math.min(cw / this.width, ch / this.height);
      const w = this.width * s, h = this.height * s;
      this.view = { x: Math.round((cw - w) / 2), y: Math.round((ch - h) / 2), w: Math.round(w), h: Math.round(h), s };
      this.dpr = dpr;
      this.render();
    }

    // ------------------------------------------------------------ picking
    pick(obj, gx, gy) {
      const $ = obj.$;
      if (!$.visible || $.removed) return null;
      if ($.mask && !$.mask.$hitShape(gx, gy, false)) return null;
      if (obj instanceof F.MovieClip) {
        if ($.enabled && obj.$hasButtonHandlers()) {
          if ($.hitArea && !$.hitArea.$.removed) { if ($.hitArea.$hitShape(gx, gy, false)) return obj; }
          else if (obj.$hitShape(gx, gy, true)) return obj;
          return null;
        }
        return this.pickChildren(obj, gx, gy);
      }
      if (obj instanceof F.Button) return $.enabled && obj.$hitArea(gx, gy) ? obj : null;
      if (obj instanceof F.TextField) return $.type === 'input' && obj.$hitShape(gx, gy) ? obj : null;
      return null;
    }
    pickChildren(obj, gx, gy) {
      const list = obj.$sorted();
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i];
        if (c.$.clipDepth) continue;
        if (!(c instanceof F.MovieClip || c instanceof F.Button || c instanceof F.TextField)) continue;
        const mask = obj.$maskFor(c, list);
        if (mask && !mask.$hitShape(gx, gy, false)) continue;
        const r = this.pick(c, gx, gy);
        if (r) return r;
      }
      return null;
    }
    dropTarget(dragged) {
      const gx = this.mouseX, gy = this.mouseY;
      const find = (obj) => {
        const list = obj.$sorted ? obj.$sorted() : [];
        for (let i = list.length - 1; i >= 0; i--) {
          const c = list[i];
          if (c === dragged || !c.$.visible || c.$.clipDepth) continue;
          if (c instanceof F.MovieClip) { const r = find(c); if (r) return r; }
          else if (c.$hitShape(gx, gy, true)) return c instanceof F.TextField ? c : obj;
        }
        return null;
      };
      const r = find(this.root);
      return r && r !== this.root ? r.$slashPath() : '';
    }

    // ------------------------------------------------------------ events
    fireButtonEvent(obj, ev) {
      if (!obj || obj.$.removed) return;
      if (obj instanceof F.Button) {
        const st = { rollOver: 1, rollOut: 0, press: 2, release: 1, dragOut: 1, dragOver: 2, releaseOutside: 0 }[ev];
        if (st !== undefined) obj.$setState(st);
        const conds = this.buttonScripts(obj.$.id);
        if (conds && obj.$.parent) for (const c of conds) if (c.ev.includes(ev)) this.queue(obj.$.parent, c.fn, false, 'button:' + obj.$.id + ':' + ev);
        const m = F.METHOD_NAMES[ev]; if (m) this.queueMethod(obj, m, false);
      } else if (obj instanceof F.MovieClip) obj.$dispatch(ev);
    }
    broadcast(ev, withMethod) {
      const visit = (obj) => {
        if (!(obj instanceof F.MovieClip)) return;
        const list = obj.$sorted().slice();
        for (let i = list.length - 1; i >= 0; i--) visit(list[i]);
        if (obj.$.removed || obj.$.unloaded) return;
        if (withMethod) obj.$dispatch(ev);
        else if (obj.$.clipEvents && obj.$.clipEvents[ev]) this.queue(obj, obj.$.clipEvents[ev], false, 'clip:' + ev);
      };
      visit(this.root);
    }
    notify(listeners, method, args) {
      for (const l of listeners.slice()) {
        this.queueFn(this.root, () => { const f = l && l[method]; if (typeof f === 'function') f.apply(l, args || []); });
      }
    }
    updateHover() {
      if (this.mouseOutside) { this.setHover(null); return; }
      const hit = this.pick(this.root, this.mouseX, this.mouseY);
      if (this.pressed) {
        const over = hit === this.pressed;
        if (over !== this.pressOver) { this.pressOver = over; this.fireButtonEvent(this.pressed, over ? 'dragOver' : 'dragOut'); }
      } else this.setHover(hit);
      this.updateCursor(hit);
    }
    setHover(hit) {
      if (hit === this.hovered) return;
      const old = this.hovered; this.hovered = hit;
      if (old) this.fireButtonEvent(old, 'rollOut');
      // Flush rollOut actions (and frame scripts they trigger) before rollOver,
      // as happens when the pointer crosses a gap between adjacent buttons.
      if (old && hit) this.runActions();
      if (hit) this.fireButtonEvent(hit, 'rollOver');
    }
    updateCursor(hit) {
      let cur = 'default';
      if (this.mouseHidden) cur = 'none';
      else if (hit instanceof F.TextField) cur = 'text';
      else if (hit && hit.$.hand) cur = 'pointer';
      if (this.canvas.style.cursor !== cur) this.canvas.style.cursor = cur;
    }
    setMouseHidden(h) { this.mouseHidden = h; this.updateCursor(this.hovered); }
    setFocus(t) {
      if (typeof t === 'string') t = F.resolvePath(this.root, t);
      this.focus = t instanceof F.TextField ? t : null;
      this.caretBlink = 0; this.selAll = !!this.focus && this.focus.$plain().length > 0;
      if (this.focus) this.ensureKeyboard();
    }
    startDrag(t, lock, rect) {
      const p = t.$.parent;
      let ox = 0, oy = 0;
      if (!lock && p) { const m = apply(inv(p.$world()), this.mouseX, this.mouseY); ox = t.$.m[4] - m[0]; oy = t.$.m[5] - m[1]; }
      this.drag = { t, ox, oy, rect };
      this.updateDrag();
    }
    stopDrag() { this.drag = null; }
    updateDrag() {
      const d = this.drag; if (!d) return;
      const t = d.t; if (t.$.removed) { this.drag = null; return; }
      const p = t.$.parent;
      const m = p ? apply(inv(p.$world()), this.mouseX, this.mouseY) : [this.mouseX, this.mouseY];
      let x = m[0] + d.ox, y = m[1] + d.oy;
      if (d.rect) { const [l, tp, r, b] = d.rect; x = Math.max(Math.min(l, r), Math.min(Math.max(l, r), x)); y = Math.max(Math.min(tp, b), Math.min(Math.max(tp, b), y)); }
      t.$.m[4] = x; t.$.m[5] = y; t.$.transformed = true;
    }

    // ------------------------------------------------------------ input
    stagePoint(e) {
      const r = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) * this.dpr - this.view.x) / this.view.s;
      const y = ((e.clientY - r.top) * this.dpr - this.view.y) / this.view.s;
      return [x, y];
    }
    bindInput() {
      const c = this.canvas;
      window.addEventListener('resize', () => this.resize());
      c.addEventListener('contextmenu', (e) => e.preventDefault());
      c.addEventListener('pointermove', (e) => this.onMove(e));
      c.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.preventDefault(); try { c.setPointerCapture(e.pointerId); } catch (_) { } this.onDown(e); });
      c.addEventListener('pointerup', (e) => { if (e.button !== 0) return; this.onUp(e); });
      c.addEventListener('pointerleave', () => { if (!this.mouseDown) { this.mouseOutside = true; this.updateHover(); this.runActions(); } });
      c.addEventListener('pointerenter', () => { this.mouseOutside = false; });
      window.addEventListener('keydown', (e) => this.onKey(e, true));
      window.addEventListener('keyup', (e) => this.onKey(e, false));
      window.addEventListener('blur', () => F.clearKeys());
    }
    onMove(e) {
      const [x, y] = this.stagePoint(e);
      this.mouseOutside = false;
      if (x === this.mouseX && y === this.mouseY) return;
      this.mouseX = x; this.mouseY = y;
      this.updateDrag();
      this.broadcast('mouseMove', true);
      this.notify(F.Mouse.$listeners, 'onMouseMove');
      this.updateHover();
      this.runActions();
    }
    onDown(e) {
      if (F.audio) F.audio.resume();
      const [x, y] = this.stagePoint(e);
      this.mouseX = x; this.mouseY = y; this.mouseDown = true;
      this.updateHover();
      this.broadcast('mouseDown', true);
      this.notify(F.Mouse.$listeners, 'onMouseDown');
      const hit = this.pick(this.root, x, y);
      if (hit instanceof F.TextField) this.setFocus(hit);
      else if (this.focus) this.setFocus(null);
      if (hit && !(hit instanceof F.TextField)) {
        if (hit !== this.hovered) this.setHover(hit);
        this.pressed = hit; this.pressOver = true;
        this.fireButtonEvent(hit, 'press');
      }
      this.runActions();
      this.render();
    }
    onUp(e) {
      const [x, y] = this.stagePoint(e);
      this.mouseX = x; this.mouseY = y; this.mouseDown = false;
      this.broadcast('mouseUp', true);
      this.notify(F.Mouse.$listeners, 'onMouseUp');
      const hit = this.pick(this.root, x, y);
      const p = this.pressed; this.pressed = null;
      if (p) {
        if (hit === p) this.fireButtonEvent(p, 'release');
        else { this.fireButtonEvent(p, 'releaseOutside'); if (this.hovered === p) this.hovered = null; }
      }
      this.runActions();
      this.updateHover();
      this.runActions();
      this.render();
    }
    flashKey(e) {
      const k = e.key;
      const map = { Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, CapsLock: 20, Escape: 27, ' ': 32, PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Insert: 45, Delete: 46 };
      let code = map[k] !== undefined ? map[k] : (e.keyCode || 0);
      if (!code && k.length === 1) code = k.toUpperCase().charCodeAt(0);
      let ascii = k.length === 1 ? k.charCodeAt(0) : ({ Backspace: 8, Tab: 9, Enter: 13, Escape: 27, Delete: 127 }[k] || 0);
      return [code, ascii];
    }
    onKey(e, down) {
      if (e.target && e.target.tagName === 'INPUT' && e.target !== this.kbInput) return;
      if (F.audio) F.audio.resume();
      const [code, ascii] = this.flashKey(e);
      if (e.ctrlKey || e.metaKey) { if (!down) F.keyUp(code); return; }
      if (down) {
        if (this.focus && this.focus.$.type === 'input' && !this.focus.$.removed) this.editText(e, ascii);
        F.keyDown(code, ascii);
        this.broadcast('keyDown', false);
        this.notify(F.Key.$listeners, 'onKeyDown');
      } else {
        F.keyUp(code);
        this.broadcast('keyUp', false);
        this.notify(F.Key.$listeners, 'onKeyUp');
      }
      if ([8, 9, 32, 37, 38, 39, 40].includes(code) || (this.focus && down)) e.preventDefault();
      this.runActions();
    }
    editText(e, ascii) {
      const tf = this.focus; const $ = tf.$;
      let t = tf.$plain();
      const k = e.key;
      if (this.selAll && (k === 'Backspace' || k === 'Delete')) { t = ''; this.selAll = false; }
      else if (this.selAll && k.length === 1) { t = ''; this.selAll = false; if ($.restrict && !restrictOk($.restrict, k)) return; t = k; }
      else if (k === 'Backspace') t = t.slice(0, -1);
      else if (k === 'Enter') { if ($.multiline) t += '\r'; else return; }
      else if (k.length === 1) {
        if ($.maxChars && t.length >= $.maxChars) return;
        if ($.restrict && !restrictOk($.restrict, k)) return;
        t += k;
      } else return;
      const lastFmt = $.runs.length ? $.runs[$.runs.length - 1].fmt : $.fmt;
      $.runs = [{ text: t.replace(/\r\n?/g, '\n'), fmt: Object.assign({}, lastFmt) }];
      $.layout = null;
      tf.$writeVar();
      this.caretBlink = 0;
      if (typeof tf.onChanged === 'function') this.queueFn(tf, () => tf.onChanged(tf));
    }
    ensureKeyboard() {
      // Allows on-screen keyboards to appear on touch devices.
      if (!('ontouchstart' in window)) return;
      if (!this.kbInput) {
        const i = this.kbInput = document.createElement('input');
        i.style.cssText = 'position:fixed;left:-1000px;top:0;opacity:0;';
        document.body.appendChild(i);
      }
      this.kbInput.focus();
    }
  }
  function restrictOk(r, ch) {
    let neg = false, ok = r[0] === '^', i = 0;
    while (i < r.length) {
      let c = r[i];
      if (c === '^') { neg = !neg; i++; continue; }
      if (c === '\\' && i + 1 < r.length) { c = r[++i]; }
      let lo = c, hi = c;
      if (r[i + 1] === '-' && i + 2 < r.length) { hi = r[i + 2]; i += 2; }
      if (ch >= lo && ch <= hi) ok = !neg;
      i++;
    }
    return ok;
  }
  F.Player = Player;
})();
