#!/usr/bin/env node
/**
 * "Does this challenge test what the chapter actually taught?"
 *
 * A challenge is an <Exercise> with no <Step> children. It should practise
 * something the learner has just been walked through. The Filters chapter
 * demanded the packed-colon form `lpf("1000:20")` in a challenge without one
 * step ever showing it - the only explanation was an opt-in hint.
 *
 *   node tools/audit-challenges.mjs [firstChapterSlug]
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const order = [...fs.readFileSync(path.join(root, 'src/consts.ts'), 'utf8')
  .matchAll(/slug:\s*'([a-z-]+)'/g)].map((m) => m[1]);
const from = process.argv[2] ? order.indexOf(process.argv[2]) : 0;

function openTagEnd(src, i) {
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (c === '"' || c === "'" || c === '`') { const q = c; for (i++; i < src.length; i++) { if (src[i] === '\\') { i++; continue; } if (src[i] === q) break; } continue; }
    if (c === '{') depth++; else if (c === '}') depth--; else if (c === '>' && depth === 0) return i;
  }
  return -1;
}
function blocks(src, tag) {
  const out = []; const open = new RegExp(`<${tag}\\b`, 'g'); let m;
  while ((m = open.exec(src))) {
    const gt = openTagEnd(src, m.index + tag.length + 1); if (gt === -1) break;
    const attrs = src.slice(m.index + tag.length + 1, gt);
    const self = src[gt - 1] === '/';
    const close = self ? -1 : src.indexOf(`</${tag}>`, gt);
    out.push({ attrs: self ? attrs.slice(0, -1) : attrs, body: close === -1 ? '' : src.slice(gt + 1, close), self });
    open.lastIndex = gt;
  }
  return out;
}
const attr = (b, n) => {
  const m = b.match(new RegExp(n + '=\\{`([\\s\\S]*?)`\\}')) || b.match(new RegExp(n + '="([^"]*)"'));
  return m ? m[1] : '';
};
/** Notations a learner must be shown, not left to infer. */
const NOTATION = [
  [/\.(?!s|n|scale|chord|bank)[a-z]+\(\s*(["'`])[^"'`]*:[^"'`]*\1/, 'packed-colon argument, e.g. lpf("freq:q")'],
  [/\{[^}]*\}%\d/, 'polymeter {…}%n'],
  [/\.\.\s/, 'range ..'],
  [/\(\d+,\s*\d+(,\s*\d+)?\)/, 'euclid (p,s,r)'],
  [/=>/, 'arrow function'],
  [/\$:|^\w+:/m, 'lane label'],
];
const fns = (c) => new Set([...(c || '').matchAll(/\.([a-zA-Z][a-zA-Z0-9_]*)\s*\(/g)].map((m) => m[1]));

// what every EARLIER chapter has already practised (a check requires typing it,
// or a step solution contains it) - a challenge may lean on those freely.
const earlier = new Map();
{
  const fnsSeen = new Set(); const notSeen = new Set();
  for (const ch of order) {
    earlier.set(ch, { fns: new Set(fnsSeen), notation: new Set(notSeen) });
    const f = path.join(root, 'src/pages/tutorial', `${ch}.mdx`);
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    for (const ex of blocks(src, 'Exercise')) {
      for (const st of blocks(ex.body || '', 'Step')) {
        const sol = attr(st.attrs, 'solution');
        for (const fn of fns(sol)) fnsSeen.add(fn);
        for (const [re, label] of NOTATION) if (re.test(sol)) notSeen.add(label);
      }
      const st0 = attr(ex.attrs, 'start');
      for (const fn of fns(st0)) fnsSeen.add(fn);
      for (const [re, label] of NOTATION) if (re.test(st0)) notSeen.add(label);
    }
  }
}

let problems = 0;
for (let i = from; i < order.length; i++) {
  const ch = order[i];
  const f = path.join(root, 'src/pages/tutorial', `${ch}.mdx`);
  if (!fs.existsSync(f)) continue;
  const src = fs.readFileSync(f, 'utf8');
  const exs = blocks(src, 'Exercise');

  // what the chapter has demonstrated in a step, in order
  const shownFns = new Set(); const shownNotation = new Set();
  const found = [];
  for (const ex of exs) {
    const id = (ex.attrs.match(/id="([^"]+)"/) || [, '?'])[1];
    const steps = blocks(ex.body || '', 'Step');
    if (steps.length === 0) {
      const target = attr(ex.attrs, 'target') || attr(ex.attrs, 'answer');
      const prior = earlier.get(ch) || { fns: new Set(), notation: new Set() };
      for (const [re, label] of NOTATION)
        if (re.test(target) && !shownNotation.has(label) && !prior.notation.has(label)) found.push({ id, need: label });
      for (const fn of fns(target))
        if (!shownFns.has(fn) && !prior.fns.has(fn) && !['s','n','note','scale','chord'].includes(fn)) found.push({ id, need: `${fn}()` });
    } else {
      for (const st of steps) {
        const sol = attr(st.attrs, 'solution');
        for (const fn of fns(sol)) shownFns.add(fn);
        for (const [re, label] of NOTATION) if (re.test(sol)) shownNotation.add(label);
      }
      for (const fn of fns(attr(ex.attrs, 'start'))) shownFns.add(fn);
      for (const [re, label] of NOTATION) if (re.test(attr(ex.attrs, 'start'))) shownNotation.add(label);
    }
  }
  if (found.length) {
    console.log(`\n${ch}`);
    for (const x of found) console.log(`  ${x.id.padEnd(34)} needs ${x.need}, never shown in a step first`);
    problems += found.length;
  }
}
console.log(`\n${problems} challenge requirement(s) the chapter never demonstrated`);
process.exit(problems ? 1 : 0);
