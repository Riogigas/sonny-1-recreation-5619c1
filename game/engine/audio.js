// WebAudio implementation of Flash event sounds and the AS2 Sound class.
'use strict';
(function () {
  const F = window.F;
  const { toNum, toStr } = F;

  const audio = F.audio = {
    ctx: null, master: null, chars: null, data: {}, buffers: {}, instances: new Set(), owners: new Map(), globalVol: 100,
    init(chars) {
      this.chars = chars;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch (e) { this.ctx = null; return; }
      this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
      this.master.gain.value = this.muted ? 0 : 1;
    },
    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => { }); },
    setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : Math.max(0, this.globalVol / 100); },
    // Raw MP3 bytes fetched during loading
    provide(id, arrayBuffer) { this.data[id] = arrayBuffer; },
    buffer(id) {
      const b = this.buffers[id];
      if (b) return b;
      const raw = this.data[id];
      if (!raw || !this.ctx) return null;
      const entry = this.buffers[id] = { buf: null, promise: null };
      entry.promise = this.ctx.decodeAudioData(raw.slice(0)).then(buf => { entry.buf = buf; delete this.data[id]; return buf; }).catch(e => { console.warn('decode failed', id, e); return null; });
      return entry;
    },
    decodeAll() {
      // decode sequentially in the background so first playback is instant
      const ids = Object.keys(this.data).sort((a, b) => (b.startsWith('stream:') ? 1 : 0) - (a.startsWith('stream:') ? 1 : 0));
      let i = 0;
      const next = () => { if (i >= ids.length) return; const e = this.buffer(ids[i++]); if (e && e.promise) e.promise.then(next); else next(); };
      next();
    },
    ownerNode(owner) {
      if (!owner) return this.master;
      let o = this.owners.get(owner);
      if (!o) {
        o = { vol: 100, node: this.ctx.createGain() };
        o.node.connect(this.master);
        this.owners.set(owner, o);
      }
      return o.node;
    },
    setVolume(owner, v) {
      v = toNum(v); if (v !== v) return;
      if (!owner) { this.globalVol = v; if (this.ctx) this.master.gain.value = this.muted ? 0 : Math.max(0, v / 100); return; }
      if (!this.ctx) return;
      this.ownerNode(owner);
      const o = this.owners.get(owner); o.vol = v; o.node.gain.setValueAtTime(Math.max(0, v / 100), this.ctx.currentTime);
    },
    getVolume(owner) { if (!owner) return this.globalVol; const o = this.owners.get(owner); return o ? o.vol : 100; },
    play(id, opts) {
      if (!this.ctx) return null;
      const ch = this.chars[id];
      if (!ch || ch.t !== 'sound') return null;
      const entry = this.buffer(id);
      if (!entry) return null;
      const inst = { id, owner: opts.owner || null, src: null, stopped: false, startTime: 0, onComplete: opts.onComplete };
      this.instances.add(inst);
      const begin = (buf) => {
        if (!buf || inst.stopped) { this.instances.delete(inst); return; }
        const src = this.ctx.createBufferSource(); src.buffer = buf;
        const lead = Math.min(buf.duration, Math.max(0, (ch.seek || 0) / buf.sampleRate));
        let len = ch.samples ? ch.samples / ch.rate : buf.duration - lead;
        if (lead + len > buf.duration) len = buf.duration - lead;
        const loops = Math.max(1, toNum(opts.loops) | 0);
        let offset = lead + Math.max(0, toNum(opts.offset) || 0);
        if (opts.inPoint) offset = lead + opts.inPoint / 44100;
        src.connect(this.ownerNode(inst.owner));
        if (loops > 1) { src.loop = true; src.loopStart = lead; src.loopEnd = lead + len; }
        src.onended = () => { this.instances.delete(inst); if (!inst.stopped && inst.onComplete) inst.onComplete(); };
        if (offset >= lead + len) offset = lead;
        if (loops > 1) src.start(0, offset, Math.max(0.01, loops * len - (offset - lead)));
        else src.start(0, offset, Math.max(0.01, lead + len - offset));
        inst.src = src; inst.startTime = this.ctx.currentTime - (offset - lead);
      };
      if (entry.buf) begin(entry.buf); else entry.promise.then(begin);
      return inst;
    },
    stopInst(inst) { inst.stopped = true; if (inst.src) { try { inst.src.stop(); } catch (e) { } } this.instances.delete(inst); },
    stopWhere(pred) { for (const i of [...this.instances]) if (pred(i)) this.stopInst(i); },
    stopAll() { this.stopWhere(() => true); for (const s of [...this.streams]) this.stopStream(s); },
    // StartSound tag from a timeline
    startSound(id, info) {
      info = info || {};
      if (info.stop) { this.stopWhere(i => i.id === id); return; }
      if (info.noMulti) { for (const i of this.instances) if (i.id === id) return; }
      this.play(id, { loops: info.loops || 1, inPoint: info.inPoint });
    },
    // ---- timeline streaming sound (SoundStreamBlock); audio follows the clip's timeline
    streams: new Set(),
    nodeFor(clip) { let c = clip; while (c) { const o = this.owners.get(c); if (o) return o.node; c = c.$.parent; } return this.master; },
    streamFrame(clip, t) {
      const st = clip.$.tl.stream;
      if (!st || !this.ctx) return;
      const key = 'stream:' + clip.$.id;
      const pos = (t + (st.seek0 || 0)) / st.rate;
      const fc = F.player ? F.player.frameCount : 0;
      let s = clip.$.streamInst;
      if (s && !s.stopped) {
        const cur = s.offset + (this.ctx.currentTime - s.startTime);
        s.lastTick = fc;
        if (Math.abs(cur - pos) < 0.25 || this.ctx.state !== 'running') return;
        this.stopStream(s);
      }
      const entry = this.buffer(key);
      if (!entry || !entry.buf) return;
      if (pos >= entry.buf.duration) return;
      const src = this.ctx.createBufferSource(); src.buffer = entry.buf;
      src.connect(this.nodeFor(clip));
      s = { clip, src, offset: pos, startTime: this.ctx.currentTime, lastTick: fc, stopped: false };
      src.onended = () => { s.stopped = true; this.streams.delete(s); };
      src.start(0, pos);
      clip.$.streamInst = s;
      this.streams.add(s);
    },
    stopStream(s) { s.stopped = true; try { s.src.stop(); } catch (e) { } this.streams.delete(s); if (s.clip.$.streamInst === s) s.clip.$.streamInst = null; },
    stopClipStream(clip) { const s = clip.$.streamInst; if (s) this.stopStream(s); },
    tickStreams(fc) { for (const s of [...this.streams]) if (s.clip.$.removed || s.clip.$.unloaded || fc - s.lastTick > 1) this.stopStream(s); },
  };

  class ASSound {
    constructor(target) {
      Object.defineProperty(this, '$t', { value: target instanceof F.DisplayObject ? target : null, writable: true });
      Object.defineProperty(this, '$id', { value: null, writable: true });
      Object.defineProperty(this, '$last', { value: null, writable: true });
    }
    attachSound(name) {
      const id = F.player.exports[toStr(name)];
      if (id !== undefined && F.player.chars[id] && F.player.chars[id].t === 'sound') this.$id = id;
    }
    start(offset, loops) {
      if (this.$id === null) return;
      const self = this;
      this.$last = audio.play(this.$id, { owner: this.$t, offset: toNum(offset) || 0, loops: loops === undefined ? 1 : toNum(loops), onComplete() { if (typeof self.onSoundComplete === 'function') { F.player.queueFn(self.$t || F.player.root, () => self.onSoundComplete()); } } });
    }
    stop(name) {
      if (name !== undefined) {
        const id = F.player.exports[toStr(name)];
        audio.stopWhere(i => i.id === id && (!this.$t || i.owner === this.$t));
        return;
      }
      if (this.$t) audio.stopWhere(i => i.owner === this.$t); else audio.stopAll();
    }
    setVolume(v) { audio.setVolume(this.$t, v); }
    getVolume() { return audio.getVolume(this.$t); }
    setPan() { } getPan() { return 0; }
    setTransform() { } getTransform() { return { ll: 100, lr: 0, rl: 0, rr: 100 }; }
    loadSound() { }
    getBytesLoaded() { return 1; } getBytesTotal() { return 1; }
    get duration() { const c = this.$id !== null && F.player.chars[this.$id]; return c ? Math.round(c.samples / c.rate * 1000) : 0; }
    get position() { const i = this.$last; if (!i || !audio.ctx) return 0; const c = F.player.chars[i.id]; const len = c.samples / c.rate; let t = audio.ctx.currentTime - i.startTime; if (t < 0) t = 0; return Math.round((t % len) * 1000); }
  }
  F.ASSound = ASSound;
})();
