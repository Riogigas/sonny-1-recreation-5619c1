// Text field layout, HTML subset parsing and drawing for EditText / createTextField.
'use strict';
(function () {
  const F = window.F;
  const { toNum, toStr } = F;
  const mctx = document.createElement('canvas').getContext('2d');

  const FAMILY = { _sans: 'Arial, Helvetica, sans-serif', _serif: '"Times New Roman", Times, serif', _typewriter: '"Courier New", Courier, monospace' };
  function family(name) {
    name = toStr(name || '_sans');
    if (FAMILY[name]) return FAMILY[name];
    const base = name.replace(/_\d+pt.*$/i, '').replace(/_st$/i, '');
    return `"${base}", Arial, Helvetica, sans-serif`;
  }
  function fontCss(f) { return `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${Math.max(1, toNum(f.size) || 12)}px ${family(f.font)}`; }
  const metricCache = new Map();
  function metrics(f) {
    const css = fontCss(f);
    let m = metricCache.get(css);
    if (!m) {
      mctx.font = css;
      const t = mctx.measureText('Hg');
      const size = Math.max(1, toNum(f.size) || 12);
      const asc = t.fontBoundingBoxAscent || size * 0.905, desc = t.fontBoundingBoxDescent || size * 0.212;
      m = { css, asc, desc, w: new Map() };
      metricCache.set(css, m);
    }
    return m;
  }
  function width(m, s) {
    let w = m.w.get(s);
    if (w === undefined) { mctx.font = m.css; w = mctx.measureText(s).width; if (m.w.size < 5000) m.w.set(s, w); }
    return w;
  }

  const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: '\u00a0' };
  function decode(s) { return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => { if (e[0] === '#') return String.fromCharCode(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)); return ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : m; }); }
  function attrs(s) { const o = {}; s.replace(/([\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|(\S+))/g, (m, k, _, a, b, c) => { o[k.toLowerCase()] = a !== undefined ? a : b !== undefined ? b : c; }); return o; }

  function parseHtml(src, base, condense) {
    const runs = [];
    const stack = [Object.assign({}, base)];
    let cur = () => stack[stack.length - 1];
    const push = (text) => { if (!text) return; const f = cur(); const last = runs[runs.length - 1]; if (last && sameFmt(last.fmt, f)) last.text += text; else runs.push({ text, fmt: Object.assign({}, f) }); };
    const re = /<(\/?)([a-zA-Z]+)([^>]*)>|([^<]+)/g; let m; let pOpen = 0; let anyText = false;
    src = src.replace(/\r\n?/g, '\n');
    if (condense) src = src.replace(/\s+/g, ' ');
    while ((m = re.exec(src))) {
      if (m[4] !== undefined) { push(decode(m[4])); anyText = true; continue; }
      const close = !!m[1], tag = m[2].toLowerCase(), a = attrs(m[3] || '');
      if (tag === 'br') { push('\n'); continue; }
      if (close) {
        if (tag === 'p' || tag === 'li') { push('\n'); pOpen--; }
        if (['p', 'font', 'b', 'i', 'u', 'a', 'textformat', 'li', 'span'].includes(tag) && stack.length > 1) stack.pop();
        continue;
      }
      const f = Object.assign({}, cur());
      if (tag === 'p') { if (a.align) f.align = a.align.toLowerCase(); pOpen++; }
      else if (tag === 'b') f.bold = true;
      else if (tag === 'i') f.italic = true;
      else if (tag === 'u') f.underline = true;
      else if (tag === 'font') {
        if (a.face) f.font = a.face;
        if (a.size) { const s = a.size.trim(); f.size = /^[+-]/.test(s) ? toNum(f.size) + toNum(s) : toNum(s); }
        if (a.color) f.color = parseInt(a.color.replace('#', ''), 16) || 0;
      } else if (tag === 'textformat') {
        if (a.leading) f.leading = toNum(a.leading); if (a.leftmargin) f.leftMargin = toNum(a.leftmargin); if (a.rightmargin) f.rightMargin = toNum(a.rightmargin); if (a.indent) f.indent = toNum(a.indent);
      } else if (tag === 'a') { f.url = a.href || ''; }
      else if (tag === 'li') { push('\u2022 '); }
      stack.push(f);
    }
    // a trailing paragraph close produces a final newline that Flash does not display
    const last = runs[runs.length - 1];
    if (last && last.text.endsWith('\n')) { last.text = last.text.slice(0, -1); if (!last.text) runs.pop(); }
    if (!runs.length) runs.push({ text: '', fmt: Object.assign({}, base) });
    return runs;
  }
  function sameFmt(a, b) { return a.font === b.font && a.size === b.size && a.color === b.color && a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.align === b.align && a.url === b.url && a.leading === b.leading; }
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function toHtml(runs) {
    const paras = [[]];
    for (const r of runs) { const parts = r.text.split('\n'); parts.forEach((p, i) => { if (i > 0) paras.push([]); if (p) paras[paras.length - 1].push({ text: p, fmt: r.fmt }); }); }
    return paras.map(p => {
      const al = ((p[0] && p[0].fmt.align) || 'left').toUpperCase();
      const inner = p.map(r => { let t = esc(r.text); if (r.fmt.bold) t = `<B>${t}</B>`; if (r.fmt.italic) t = `<I>${t}</I>`; if (r.fmt.underline) t = `<U>${t}</U>`; return `<FONT FACE="${r.fmt.font}" SIZE="${r.fmt.size}" COLOR="#${(r.fmt.color >>> 0).toString(16).padStart(6, '0').toUpperCase()}" LETTERSPACING="0" KERNING="0">${t}</FONT>`; }).join('');
      return `<P ALIGN="${al}">${inner}</P>`;
    }).join('');
  }

  // Lays out text runs into lines. Returns {lines, width, height}
  function layout(tf) {
    const $ = tf.$;
    const pw = $.password;
    const maxW = Math.max(1, $.w - 4);
    const lines = [];
    let line = null;
    const newLine = (fmt) => { line = { frags: [], w: 0, asc: 0, desc: 0, lead: 0, fmt, x: 0 }; lines.push(line); return line; };
    const addFrag = (text, fmt, m, w) => {
      const last = line.frags[line.frags.length - 1];
      if (last && last.fmt === fmt) { last.text += text; last.w += w; }
      else line.frags.push({ text, fmt, m, w, x: line.w });
      line.w += w;
      if (m.asc > line.asc) line.asc = m.asc; if (m.desc > line.desc) line.desc = m.desc;
      const ld = toNum(fmt.leading) || 0; if (ld > line.lead) line.lead = ld;
    };
    newLine($.runs[0] ? $.runs[0].fmt : $.fmt);
    for (const r of $.runs) {
      const m = metrics(r.fmt);
      if (m.asc > line.asc) line.asc = m.asc; if (m.desc > line.desc) line.desc = m.desc;
      const text = pw ? r.text.replace(/[^\n]/g, '*') : r.text;
      const paras = text.split('\n');
      for (let pi = 0; pi < paras.length; pi++) {
        if (pi > 0) { newLine(r.fmt); if (m.asc > line.asc) line.asc = m.asc; if (m.desc > line.desc) line.desc = m.desc; }
        const p = paras[pi];
        if (!p) continue;
        if (!$.wordWrap) { addFrag(p, r.fmt, m, width(m, p)); continue; }
        const words = p.match(/\S+\s*|\s+/g) || [];
        for (const word of words) {
          const avail = maxW - (toNum(r.fmt.leftMargin) || 0) - (toNum(r.fmt.rightMargin) || 0);
          let ww = width(m, word);
          const trimmed = word.replace(/\s+$/, '');
          const tw = trimmed === word ? ww : width(m, trimmed);
          if (line.w + tw > avail && line.w > 0) { newLine(r.fmt); if (m.asc > line.asc) line.asc = m.asc; if (m.desc > line.desc) line.desc = m.desc; }
          if (tw > avail && line.w === 0) {
            // break very long words by characters
            let chunk = '';
            for (const ch of word) {
              const cw = width(m, chunk + ch);
              if (cw > avail && chunk) { addFrag(chunk, r.fmt, m, width(m, chunk)); newLine(r.fmt); chunk = ch; }
              else chunk += ch;
            }
            if (chunk) addFrag(chunk, r.fmt, m, width(m, chunk));
            continue;
          }
          addFrag(word, r.fmt, m, ww);
        }
      }
    }
    let y = 2, maxw = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      // trailing whitespace doesn't count for alignment
      let tw = l.w;
      const lf = l.frags[l.frags.length - 1];
      if (lf) { const t = lf.text.replace(/\s+$/, ''); if (t !== lf.text) tw -= lf.w - width(lf.m, t); }
      l.tw = tw;
      const f = l.fmt; const lm = toNum(f.leftMargin) || 0, rm = toNum(f.rightMargin) || 0;
      const avail = $.w - 4 - lm - rm;
      const al = f.align;
      l.x = 2 + lm + (al === 'center' ? (avail - tw) / 2 : al === 'right' ? (avail - tw) : 0);
      l.y = y + l.asc;
      y += l.asc + l.desc + (i < lines.length - 1 ? l.lead : 0);
      if (tw + lm + rm > maxw) maxw = tw + lm + rm;
    }
    return { lines, width: maxw, height: y - 2 };
  }

  function colorStr(c, cx, alpha) {
    let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255, a = 255 * alpha;
    if (cx) { r = r * cx[0] + cx[4]; g = g * cx[1] + cx[5]; b = b * cx[2] + cx[6]; a = a * cx[3] + cx[7]; }
    const cl = (v) => v < 0 ? 0 : v > 255 ? 255 : v | 0;
    return `rgba(${cl(r)},${cl(g)},${cl(b)},${Math.max(0, Math.min(1, a / 255))})`;
  }

  function draw(ctx, tf, cx, caret, selAll) {
    const $ = tf.$;
    tf.$syncVar();
    const L = tf.$doLayout();
    const x0 = $.x0, y0 = $.y0, w = $.w, h = $.h;
    if ($.background) { ctx.fillStyle = colorStr($.backgroundColor, cx, 1); ctx.fillRect(x0, y0, w, h); }
    if ($.border) { ctx.strokeStyle = colorStr($.borderColor, cx, 1); ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1); }
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
    ctx.textBaseline = 'alphabetic';
    if (selAll) {
      ctx.fillStyle = 'rgba(80,120,200,0.55)';
      for (const l of L.lines) if (l.tw > 0) ctx.fillRect(x0 + l.x, y0 + l.y - l.asc, l.tw, l.asc + l.desc);
      caret = false;
    }
    let lastLine = null;
    for (const l of L.lines) {
      for (const fr of l.frags) {
        if (!fr.text) continue;
        ctx.font = fr.m.css;
        ctx.fillStyle = colorStr(toNum(fr.fmt.color) | 0, cx, $.textAlpha);
        ctx.fillText(fr.text, x0 + l.x + fr.x, y0 + l.y);
        if (fr.fmt.underline) ctx.fillRect(x0 + l.x + fr.x, y0 + l.y + 1, fr.w, Math.max(1, fr.m.asc / 12));
      }
      lastLine = l;
    }
    if (caret && lastLine) {
      ctx.fillStyle = colorStr(toNum($.fmt.color) | 0, cx, 1);
      ctx.fillRect(x0 + lastLine.x + lastLine.w + 1, y0 + lastLine.y - lastLine.asc, 1, lastLine.asc + lastLine.desc);
    } else if (caret) {
      const m = metrics($.fmt);
      ctx.fillStyle = colorStr(toNum($.fmt.color) | 0, cx, 1);
      ctx.fillRect(x0 + 3, y0 + 2, 1, m.asc + m.desc);
    }
    ctx.restore();
  }

  F.text = { parseHtml, toHtml, layout, draw, fontCss, family, metrics };
  F.measureText = function (s, fmt) {
    const f = { font: fmt.font || '_sans', size: toNum(fmt.size) || 12, bold: !!fmt.bold, italic: !!fmt.italic };
    const m = metrics(f);
    let w = 0; const lines = toStr(s).split(/\r\n?|\n/);
    for (const l of lines) w = Math.max(w, width(m, l));
    return { w, h: lines.length * (m.asc + m.desc) };
  };
})();
