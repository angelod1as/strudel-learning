#!/usr/bin/env node
/**
 * Static check audit: every step's `check` tested against that step's own
 * `solution`, and every challenge's against its `target`.
 *
 *   node tools/audit-checks.mjs [chapter ...]
 *
 * The browser QA harness does this too, by evaluating patterns for real — but it
 * needs a page with 25 live editors on it and takes minutes. This covers the
 * failure that actually happens while authoring (a check its own answer cannot
 * satisfy) in milliseconds, and runs in CI. It only reads `includes`, `excludes`
 * and `code`; `has`/`events`/`fn` need a real Pattern, so they are counted and
 * skipped.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const consts = fs.readFileSync(path.join(root, 'src/consts.ts'), 'utf8');
const order = [...consts.matchAll(/slug:\s*'([a-z-]+)'/g)].map((m) => m[1]);

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
    out.push({ attrs: selfClosing ? attrs.slice(0, -1) : attrs, body, at: m.index });
    open.lastIndex = gt;
  }
  return out;
}

const attr = (blob, name) => {
  const m =
    blob.match(new RegExp(name + '=\\{`([\\s\\S]*?)`\\}')) || blob.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : '';
};

/** The `check={{ ... }}` object source, if present. */
const checkSrc = (blob) => {
  const i = blob.indexOf('check={{');
  if (i === -1) return null;
  let depth = 0;
  for (let j = i + 7; j < blob.length; j++) {
    const c = blob[j];
    if (c === '\\') { j++; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      for (j++; j < blob.length; j++) {
        if (blob[j] === '\\') { j++; continue; }
        if (blob[j] === q) break;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return blob.slice(i + 7, j + 1); }
  }
  return null;
};

/** String literals for one field, handling `x: 'a'` and `x: ['a', 'b']`. */
function literals(src, field) {
  const m = src.match(new RegExp(`(?<![a-zA-Z])${field}:\\s*(\\[[^\\]]*\\]|'(?:[^'\\\\]|\\\\.)*')`));
  if (!m) return [];
  const raw = m[1];
  return [...raw.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
}

const problems = [];
let checked = 0;
let skipped = 0;
const only = process.argv.slice(2);
const chapters = only.length ? order.filter((c) => only.includes(c)) : order;

for (const ch of chapters) {
  const file = path.join(root, 'src/pages/tutorial', `${ch}.mdx`);
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, 'utf8');

  for (const ex of blocks(src, 'Exercise')) {
    const id = (ex.attrs.match(/id="([^"]+)"/) || [, '?'])[1];
    const steps = blocks(ex.body, 'Step');

    // A challenge: no steps, so its own check must match its target.
    const cases = steps.length
      ? steps.map((st, i) => ({
          label: `step ${i + 1}`,
          check: checkSrc(st.attrs),
          answer: attr(st.attrs, 'solution'),
          answerName: 'solution',
        }))
      : [{ label: 'challenge', check: checkSrc(ex.attrs), answer: attr(ex.attrs, 'target'), answerName: 'target' }];

    for (const c of cases) {
      if (!c.check) continue;
      if (!c.answer) {
        problems.push(`${id} ${c.label}: has a check but no ${c.answerName}`);
        continue;
      }
      checked++;
      for (const lit of literals(c.check, 'includes'))
        if (!c.answer.includes(lit))
          problems.push(`${id} ${c.label}: includes '${lit}' — its own ${c.answerName} does not contain it`);
      for (const lit of literals(c.check, 'excludes'))
        if (c.answer.includes(lit))
          problems.push(`${id} ${c.label}: excludes '${lit}' — but its own ${c.answerName} contains it`);
      for (const rx of literals(c.check, 'code')) {
        let re;
        try {
          re = new RegExp(rx);
        } catch (e) {
          problems.push(`${id} ${c.label}: code /${rx}/ is not a valid regex (${e.message})`);
          continue;
        }
        if (!re.test(c.answer))
          problems.push(`${id} ${c.label}: code /${rx}/ does not match its own ${c.answerName}`);
      }
      if (/(?<![a-zA-Z])(has|events|fn|match):/.test(c.check)) skipped++;
    }
  }
}

console.log(`checked ${checked} check(s) against their own answers`);
if (skipped) console.log(`${skipped} also use has/events/fn/match, which need a real Pattern (browser QA covers those)`);
if (!problems.length) {
  console.log('no check contradicts its own answer');
  process.exit(0);
}
console.log(`\n${problems.length} problem(s):`);
for (const p of problems) console.log('  ' + p);
process.exit(1);
