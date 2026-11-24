// Transpiles the decompiled ActionScript 2 (exported by JPEXS FFDec) into
// JavaScript functions that run on the JS Flash runtime in game/engine.
//   node tools/transpile.js <ffdec-script-export-dir>
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const astring = require('astring');
const { parseSwf } = require('./swf.js');

const ROOT = path.resolve(__dirname, '..');
const SRC = process.argv[2];
const SWF = process.argv[3] || path.join(ROOT, 'uploads', 'f616dd60-9405-45fa-8658-68be5564e862.swf');
if (!SRC) { console.error('usage: node tools/transpile.js <ffdec scripts dir> [swf]'); process.exit(1); }

// ---------------- AST helpers ----------------
const id = (name) => ({ type: 'Identifier', name });
const lit = (value) => ({ type: 'Literal', value, raw: JSON.stringify(value) });
const call = (callee, args) => ({ type: 'CallExpression', callee: typeof callee === 'string' ? id(callee) : callee, arguments: args, optional: false });
const member = (object, property, computed, optional = false) => ({ type: 'MemberExpression', object, property, computed, optional });
const chain = (expression) => ({ type: 'ChainExpression', expression });
const isNumLit = (n) => n.type === 'Literal' && typeof n.value === 'number';

const SKIP = new Set(['type', 'start', 'end', 'loc', 'range', 'raw']);

function wrapObj(o) {
  if (o.type === 'ThisExpression') return o;
  return call('$$o', [o]);
}

function keyOf(m) { return m.computed ? t(m.property) : lit(m.property.name); }

function t(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(t);
  switch (node.type) {
    case 'Identifier': case 'Literal': case 'ThisExpression': case 'Super': return node;
    case 'FunctionDeclaration': case 'FunctionExpression':
      return { ...node, body: t(node.body) };
    case 'VariableDeclarator': return { ...node, init: t(node.init) };
    case 'Property': return { ...node, key: node.computed ? t(node.key) : node.key, value: t(node.value) };
    case 'LabeledStatement': return { ...node, body: t(node.body) };
    case 'BreakStatement': case 'ContinueStatement': return node;
    case 'CatchClause': return { ...node, body: t(node.body) };
    case 'ForInStatement': {
      let left = node.left;
      if (left.type === 'MemberExpression') left = member(wrapObj(t(left.object)), left.computed ? t(left.property) : left.property, left.computed);
      // AS2 enumerates newest properties first; $$keys snapshots keys in that order.
      return { type: 'ForOfStatement', await: false, left, right: call('$$keys', [t(node.right)]), body: t(node.body) };
    }
    case 'MemberExpression':
      return chain(member(t(node.object), node.computed ? t(node.property) : node.property, node.computed, true));
    case 'ChainExpression': return t(node.expression);
    case 'CallExpression': {
      const c = node.callee;
      if (c.type === 'Literal') return c; // FFDec artefact: `false()`
      if (c.type === 'MemberExpression') {
        const m = member(t(c.object), c.computed ? t(c.property) : c.property, c.computed, true);
        return chain({ type: 'CallExpression', callee: m, arguments: t(node.arguments), optional: true });
      }
      if (c.type === 'Identifier') {
        return chain({ type: 'CallExpression', callee: c, arguments: t(node.arguments), optional: true });
      }
      return { ...node, callee: t(c), arguments: t(node.arguments) };
    }
    case 'NewExpression': {
      let c = node.callee;
      // keep plain member access for constructors (e.g. flash.geom.Transform)
      const plain = (n) => n.type === 'MemberExpression' ? member(plain(n.object), n.computed ? t(n.property) : n.property, n.computed) : t(n);
      return { ...node, callee: plain(c), arguments: t(node.arguments) };
    }
    case 'BinaryExpression': {
      const l = t(node.left), r = t(node.right);
      if (node.operator === '+' && !(isNumLit(node.left) && isNumLit(node.right))) return call('$$add', [l, r]);
      return { ...node, left: l, right: r };
    }
    case 'AssignmentExpression': {
      const L = node.left, R = t(node.right);
      if (L.type === 'Identifier') {
        if (node.operator === '+=') return { type: 'AssignmentExpression', operator: '=', left: L, right: call('$$add', [L, R]) };
        return { ...node, right: R };
      }
      if (L.type === 'MemberExpression') {
        const obj = t(L.object);
        if (node.operator === '+=') return call('$$adds', [obj, keyOf(L), R]);
        return { ...node, left: member(wrapObj(obj), L.computed ? t(L.property) : L.property, L.computed), right: R };
      }
      return { ...node, right: R };
    }
    case 'UpdateExpression': {
      const A = node.argument;
      if (A.type === 'MemberExpression') return { ...node, argument: member(wrapObj(t(A.object)), A.computed ? t(A.property) : A.property, A.computed) };
      return node;
    }
    case 'UnaryExpression': {
      const A = node.argument;
      if (node.operator === 'delete' && A.type === 'MemberExpression') return { ...node, argument: member(wrapObj(t(A.object)), A.computed ? t(A.property) : A.property, A.computed) };
      return { ...node, argument: t(A) };
    }
    default: {
      const out = {};
      for (const k in node) out[k] = SKIP.has(k) ? node[k] : t(node[k]);
      return out;
    }
  }
}

// Display object properties are case-insensitive in AVM1 regardless of SWF
// version (e.g. `_X` == `_x`), so canonicalise them to the runtime's names.
const DISPLAY_PROPS = new Map(['_x', '_y', '_xscale', '_yscale', '_currentframe', '_totalframes', '_alpha', '_visible', '_width', '_height', '_rotation', '_target', '_framesloaded', '_name', '_droptarget', '_url', '_highquality', '_focusrect', '_soundbuftime', '_quality', '_xmouse', '_ymouse'].map(n => [n, n]));
function canonName(n) { return typeof n === 'string' && n[0] === '_' ? DISPLAY_PROPS.get(n.toLowerCase()) || n : n; }
function canon(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(canon); return; }
  if (node.type === 'Identifier') node.name = canonName(node.name);
  else if (node.type === 'Literal' && typeof node.value === 'string' && node.value[0] === '_') {
    const c = canonName(node.value); if (c !== node.value) { node.value = c; node.raw = JSON.stringify(c); }
  }
  for (const k in node) if (!SKIP.has(k) && node[k] && typeof node[k] === 'object') canon(node[k]);
}

function compileBody(src, where) {
  // Rename identifiers that are reserved in JS but legal in AS2.
  let ast;
  try {
    ast = acorn.parse(src, { ecmaVersion: 2020, sourceType: 'script', allowReturnOutsideFunction: true });
  } catch (e) {
    throw new Error(`Parse error in ${where}: ${e.message}\n` + src.split('\n').slice(Math.max(0, e.loc.line - 3), e.loc.line + 2).join('\n'));
  }
  canon(ast);
  const hoisted = []; const body = [];
  for (const st of ast.body) {
    if (st.type === 'FunctionDeclaration') {
      hoisted.push({ type: 'ExpressionStatement', expression: { type: 'AssignmentExpression', operator: '=', left: id(st.id.name), right: { ...st, type: 'FunctionExpression' } } });
    } else body.push(st);
  }
  const prog = { type: 'Program', body: t([...hoisted, ...body]), sourceType: 'script' };
  const code = astring.generate(prog, { indent: ' ', lineEnd: '\n' });
  return `function(__s){with(__s){\n${code}}}`;
}

function stripHandler(src) {
  // "onClipEvent(load){ ... }" or "on(release){ ... }"
  const m = /^\s*(onClipEvent|on)\s*\(([^)]*)\)\s*\{([\s\S]*)\}\s*$/.exec(src);
  if (!m) throw new Error('Cannot parse handler: ' + src.slice(0, 80));
  return { kind: m[1], events: m[2].split(',').map(s => s.trim()), body: m[3] };
}

// ---------------- collect files ----------------
const movie = parseSwf(SWF);
const out = { frame: {}, clip: {}, button: {} };
let count = 0;
const problems = [];

function walk(dir, f) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, f); else f(p); } }

const frameFiles = {}; // key sprite:frame -> [{idx, src, file}]
walk(SRC, (file) => {
  const rel = path.relative(SRC, file).split(path.sep);
  let sprite = 0; let i = 0;
  let m = /^DefineSprite_(\d+)/.exec(rel[0]);
  if (m) { sprite = +m[1]; i = 1; }
  const bm = /^DefineButton2_(\d+)/.exec(rel[0]);
  const src = fs.readFileSync(file, 'utf8');
  if (bm) {
    const h = stripHandler(src);
    const key = bm[1];
    (out.button[key] = out.button[key] || []).push({ ev: h.events, src: compileBody(h.body, rel.join('/')) });
    count++; return;
  }
  const fm = /^frame_(\d+)$/.exec(rel[i]);
  if (!fm) { problems.push('unknown file ' + rel.join('/')); return; }
  const frame = +fm[1] - 1;
  const leaf = rel[i + 1];
  const dm = /^DoAction(?:_(\d+))?\.as$/.exec(leaf);
  if (dm) {
    const idx = dm[1] ? +dm[1] - 1 : 0;
    const k = sprite + ':' + frame;
    (frameFiles[k] = frameFiles[k] || []).push({ idx, src, file: rel.join('/') });
    return;
  }
  const pm = /^PlaceObject\d?_(\d+)(?:_.*)?_(\d+)$/.exec(leaf);
  if (pm) {
    const depth = +pm[2];
    const h = stripHandler(src);
    const key = `${sprite}:${frame}:${depth}`;
    const o = out.clip[key] = out.clip[key] || {};
    for (const ev of h.events) {
      if (o[ev]) problems.push('duplicate clip event ' + key + ' ' + ev);
      o[ev] = compileBody(h.body, rel.join('/'));
    }
    count++; return;
  }
  problems.push('unknown file ' + rel.join('/'));
});

// Verify DoAction ordering against constant pools in the SWF.
function timeline(sprite) { return sprite === 0 ? movie.root : movie.chars[sprite]; }
for (const k in frameFiles) {
  const [sprite, frame] = k.split(':').map(Number);
  const tl = timeline(sprite);
  const acts = (tl && tl.frames[frame] || []).filter(o => o.op === 'action');
  const files = frameFiles[k].sort((a, b) => a.idx - b.idx);
  if (acts.length !== files.length) problems.push(`action count mismatch ${k}: swf ${acts.length} files ${files.length}`);
  const score = (f, a) => { const pool = a.pool || []; if (!pool.length) return f.src.trim().length === 0 ? 1 : 0; let s = 0; for (const p of pool.slice(0, 30)) if (f.src.includes(p)) s++; return s / Math.min(30, pool.length); };
  // greedy assignment by best score
  const used = new Set();
  for (const a of acts) {
    let best = null, bs = -1;
    for (const f of files) { if (used.has(f)) continue; const s = score(f, a); if (s > bs) { bs = s; best = f; } }
    if (!best) continue;
    used.add(best);
    if (best.idx !== a.idx) problems.push(`reordered ${k}: file ${best.file} -> action ${a.idx} (score ${bs.toFixed(2)})`);
    if (bs < 0.5) problems.push(`low match ${k} action ${a.idx} ${best.file} score ${bs.toFixed(2)}`);
    out.frame[`${k}:${a.idx}`] = compileBody(best.src, best.file);
    count++;
  }
}

let js = '// Generated by tools/transpile.js from the decompiled ActionScript of the original SWF.\n';
js += 'var SWF_SCRIPTS = {frame:{\n';
js += Object.entries(out.frame).map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(',\n');
js += '},\nclip:{\n';
js += Object.entries(out.clip).map(([k, o]) => `${JSON.stringify(k)}:{` + Object.entries(o).map(([e, v]) => `${JSON.stringify(e)}:${v}`).join(',\n') + '}').join(',\n');
js += '},\nbutton:{\n';
js += Object.entries(out.button).map(([k, a]) => `${JSON.stringify(k)}:[` + a.map(x => `{ev:${JSON.stringify(x.ev)},fn:${x.src}}`).join(',\n') + ']').join(',\n');
js += '}};\n';
fs.mkdirSync(path.join(ROOT, 'game', 'js'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'game', 'js', 'scripts.js'), js);
try { new Function(js); } catch (e) { problems.push('generated JS invalid: ' + e.message); }
console.log('scripts:', count, 'size', (js.length / 1024).toFixed(0) + 'KB');
if (problems.length) console.log(problems.join('\n'));
