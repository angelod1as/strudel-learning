#!/usr/bin/env node
/**
 * Syntax-prerequisite audit.
 *
 * audit-pedagogy.mjs tracks FUNCTION names. It cannot see notation — the
 * colon-packed argument form (`lpf("1000:20")`, `delay(".5:.125:.8")`) is a
 * syntax the learner has to be told about, and a challenge demanded it in the
 * Filters chapter with the only explanation buried in an opt-in hint.
 *
 * This reports, per chapter in order: where a packed-colon argument is first
 * USED in code the learner must produce, and whether any prose before that
 * point explains it.
 *
 *   node tools/audit-syntax.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const order = [...fs.readFileSync(path.join(root, 'src/consts.ts'), 'utf8')
  .matchAll(/slug:\s*'([a-z-]+)'/g)].map((m) => m[1]);

// controls where `a:b` packs several values; `s`/`n`/`scale`/`chord`/`bank`
// also use a colon but mean something else and are taught early.
const PACKED = /\.(lpf|hpf|bpf|lpq|hpq|bpq|cutoff|delay|room|adsr|vib|vibmod|distort|shape|compressor|duckorbit|duckdepth|duckattack|duckonset|phaser|tremolo|scrub|pw|speed|gain)\(\s*(["'`])([^"'`]*:[^"'`]*)\2/g;
const CODE = /(?:start|target|solution|answer)=\{`([\s\S]*?)`\}/g;
const EXPLAINS = /colon|shorthand|packed|separated by|one string|`?[a-z]+:[a-z]+`?\s*(form|shape|syntax)/i;

let taught = null;           // first chapter whose PROSE explains the form
const uses = [];

for (const ch of order) {
  const f = path.join(root, 'src/pages/tutorial', `${ch}.mdx`);
  if (!fs.existsSync(f)) continue;
  const src = fs.readFileSync(f, 'utf8');

  // prose = everything outside code attributes and outside check/hints props
  const prose = src.replace(CODE, ' ').replace(/check=\{\{[\s\S]*?\}\}/g, ' ').replace(/hints=\{\[[\s\S]*?\]\}/g, ' ');
  const explainsHere = EXPLAINS.test(prose) && /colon|shorthand|one string/i.test(prose);

  for (const m of src.matchAll(CODE)) {
    for (const p of m[1].matchAll(PACKED)) {
      uses.push({ ch, control: p[1], value: p[3].slice(0, 28) });
    }
  }
  if (explainsHere && taught === null) taught = ch;
}

const firstUse = uses[0];
console.log('packed-colon argument form');
console.log('  first taught in prose :', taught ?? 'NEVER');
console.log('  first used in code    :', firstUse ? `${firstUse.ch} (${firstUse.control} "${firstUse.value}")` : 'never');

const seen = new Map();
for (const u of uses) if (!seen.has(u.ch)) seen.set(u.ch, []);
for (const u of uses) seen.get(u.ch).push(`${u.control}("${u.value}")`);

console.log('\nused in these chapters, in order:');
let problems = 0;
for (const ch of order) {
  if (!seen.has(ch)) continue;
  const before = taught === null || order.indexOf(ch) < order.indexOf(taught);
  if (before) problems += seen.get(ch).length;
  console.log(`  ${before ? 'BEFORE IT IS TAUGHT →' : '                    '} ${ch.padEnd(18)} ${[...new Set(seen.get(ch))].slice(0, 6).join('  ')}`);
}
console.log(`\n${problems} use(s) before any prose explains the form`);
process.exit(problems ? 1 : 0);
