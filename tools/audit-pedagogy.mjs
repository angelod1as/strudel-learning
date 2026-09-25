#!/usr/bin/env node
/**
 * Pedagogy audit. The exercise QA harness proves checks are well-formed; this
 * checks whether the exercises actually teach.
 *
 *   node tools/audit-pedagogy.mjs
 *
 * Reports three things:
 *   1. steps that retype the editor instead of changing it
 *   2. steps that make the learner type a function taught in a later chapter
 *   3. steps that introduce several new functions at once
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const consts = fs.readFileSync(path.join(root, 'src/consts.ts'), 'utf8');
const order = [...consts.matchAll(/slug:\s*'([a-z-]+)'/g)].map((m) => m[1]);
const idx = Object.fromEntries(order.map((c, i) => [c, i]));

/**
 * Find the end of a JSX opening tag, skipping over `>` that appears inside
 * quotes, template literals, or braces — an arrow function in a prop (`x => x`)
 * or an <L> inside a hint would otherwise cut the tag short and swallow the
 * next exercise's steps.
 */
function openTagEnd(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      for (i++; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === quote) break;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return i;
  }
  return -1;
}

/** Every <Tag ...> or <Tag ... /> block, with its attribute text and body. */
function blocks(src, tag) {
  const out = [];
  const open = new RegExp(`<${tag}\\b`, 'g');
  let m;
  while ((m = open.exec(src))) {
    const gt = openTagEnd(src, m.index + tag.length + 1);
    if (gt === -1) break;
    const attrs = src.slice(m.index + tag.length + 1, gt);
    const selfClosing = src[gt - 1] === '/';
    let body = '';
    if (!selfClosing) {
      const close = src.indexOf(`</${tag}>`, gt);
      body = close === -1 ? '' : src.slice(gt + 1, close);
    }
    out.push({ attrs: selfClosing ? attrs.slice(0, -1) : attrs, body });
    open.lastIndex = gt;
  }
  return out;
}
const FN = /\.([a-zA-Z][a-zA-Z0-9_]*)\s*\(|(?<![.\w])([a-z][a-zA-Z0-9_]*)\s*\(/g;

const SKIP = new Set(['x','y','map','filter','fill','join','sort','toFixed','Array','Set','from','keys','split','replace','push','concat','reduce','round','floor','random','min','max','abs','pow','sqrt','String','Number','JSON','stringify','parse','values','slice','some']);

const attr = (blob, name) => {
  const m = blob.match(new RegExp(name + '=\\{`([\\s\\S]*?)`\\}')) || blob.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : '';
};
const fnsIn = (code) => new Set([...(code || '').matchAll(FN)].map((m) => m[1] || m[2]).filter((n) => n && !SKIP.has(n) && n.length > 1));
/** How much of `a` survives into `b`, 0..1. */
const kept = (a, b) => {
  if (!a) return 1;
  const A = new Set(a.split(/\s+/)), B = new Set(b.split(/\s+/));
  const shared = [...A].filter((t) => B.has(t)).length;
  return A.size ? shared / A.size : 1;
};

const read = (ch) => {
  const f = path.join(root, 'src/pages/tutorial', `${ch}.mdx`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
};

// where a function is first *practised* (a check requires typing it)
const taught = {};
for (const ch of order) {
  const s = read(ch);
  if (!s) continue;
  for (const m of s.matchAll(/check=\{\{([\s\S]*?)\}\}/g)) {
    const lits = [...m[1].matchAll(/(?:includes|code):\s*'([^']*)'/g)].map((x) => x[1]);
    for (const lit of lits)
      for (const n of [...lit.matchAll(/\.?([a-zA-Z][a-zA-Z0-9_]{1,})\(/g)].map((x) => x[1]))
        taught[n] = Math.min(taught[n] ?? 99, idx[ch]);
  }
}

const retype = [], premature = [], dumps = [];
for (const ch of order) {
  const s = read(ch);
  if (!s) continue;
  for (const ex of blocks(s, 'Exercise')) {
    const id = (ex.attrs.match(/id="([^"]+)"/) || [, '?'])[1];
    const start = attr(ex.attrs, 'start');
    let prev = start;
    const startFns = fnsIn(start);
    let i = 0;
    for (const st of blocks(ex.body || '', 'Step')) {
      i++;
      const sol = attr(st.attrs, 'solution');
      if (!sol) continue;
      const newFns = [...fnsIn(sol)].filter((n) => !fnsIn(prev).has(n));
      if (prev.trim()) {
        const k = kept(prev, sol);
        if (k < 0.55) retype.push({ ch, id, step: i, kept: k.toFixed(2) });
        if (newFns.length >= 3) dumps.push({ ch, id, step: i, added: newFns.join(' ') });
      }
      for (const n of newFns) {
        if (startFns.has(n)) continue;
        const t = taught[n];
        if (t !== undefined && t > idx[ch]) premature.push({ ch, id, step: i, fn: n, taughtIn: order[t] });
      }
      prev = sol;
    }
  }
}

const table = (title, rows) => {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  for (const r of rows) console.log('  ' + Object.entries(r).map(([k, v]) => `${k}=${v}`).join('  '));
};
table('steps that retype instead of change', retype);
table('functions typed before they are taught', premature);
table('steps introducing 3+ new functions at once', dumps);
const total = retype.length + premature.length + dumps.length;
console.log(`\n${total} finding(s)`);
process.exit(total ? 1 : 0);
