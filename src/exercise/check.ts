/**
 * The check engine behind <Exercise>/<Step>. Pure: it knows nothing about the
 * DOM or about editors. It receives the learner's code, the Pattern that code
 * evaluated to, and a way to get the target's Pattern, and returns one
 * `{ ok, message }` per condition of a `Check` (see ./types.ts).
 *
 * The UI (src/scripts/exercise.ts) and the QA harness both call `runCheck`,
 * so what QA proves is exactly what the learner gets.
 */
import type { Check, ValueRule } from './types';

export interface Result {
  ok: boolean;
  /** Markdown-ish: backtick spans are rendered as code. */
  message: string;
}

/** An onset event, as handed to `fn` checks. `t` and `dur` are in cycles. */
export interface Ev {
  t: number;
  dur: number;
  value: Record<string, unknown>;
}

/** The minimal slice of a Strudel Pattern this module relies on. */
export interface PatternLike {
  queryArc(begin: number, end: number): Array<{
    hasOnset(): boolean;
    whole?: { begin: { valueOf(): number }; end: { valueOf(): number } } | null;
    value: unknown;
  }>;
}

export interface CheckContext {
  code: string;
  /** null = nothing evaluated (empty editor): treated as silence. */
  pattern: PatternLike | null;
  /** Resolves to the target's Pattern, or throws with a readable message. */
  target?: () => Promise<PatternLike | null>;
}

const EPS = 1e-6;

/** Keys that change how a pattern looks, not how it sounds. */
const META_KEYS = new Set(['color', 'markcss', 'label', 'id', 'analyze', 'fft', 'scope']);

// ---------------------------------------------------------------- events

export function eventsOf(pattern: PatternLike | null, cycles: number): Ev[] {
  if (!pattern) return [];
  return pattern
    .queryArc(0, cycles)
    .filter((h) => h.hasOnset())
    .map((h) => ({
      t: Number(h.whole!.begin.valueOf()),
      dur: Number(h.whole!.end.valueOf()) - Number(h.whole!.begin.valueOf()),
      value:
        h.value !== null && typeof h.value === 'object'
          ? (h.value as Record<string, unknown>)
          : { value: h.value },
    }))
    .map((e) => ({ e, k: JSON.stringify(e.value) }))
    // by onset, then by value: a stable order `fn` checks can rely on
    .sort((a, b) => a.e.t - b.e.t || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .map(({ e }) => e);
}

// ---------------------------------------------------------------- time, musically

/** Best small fraction for x in [0, 1): "1/3", "5/12". */
function fraction(x: number): string {
  for (let d = 2; d <= 96; d++) {
    const n = Math.round(x * d);
    if (Math.abs(n / d - x) < EPS) {
      let a = n,
        b = d;
      while (b) [a, b] = [b, a % b];
      return `${n / a}/${d / a}`;
    }
  }
  return x.toFixed(3);
}

const SUBDIVISION = ['', 'e', '&', 'a'];

/**
 * "beat 2", "the & of 3 (16th 11)", "1/3 of the way through the cycle",
 * prefixed with "cycle 2, " once past the first cycle.
 */
export function describeTime(t: number, cycles = 1): string {
  const cycle = Math.floor(t + EPS);
  const f = Math.max(0, t - cycle);
  const prefix = cycles > 1 || cycle > 0 ? `cycle ${cycle + 1}, ` : '';
  const sixteenth = f * 16;
  const s = Math.round(sixteenth);
  if (Math.abs(sixteenth - s) < 1e-4 && s < 16) {
    const beat = Math.floor(s / 4) + 1;
    const sub = s % 4;
    if (sub === 0) return `${prefix}beat ${beat}`;
    return `${prefix}the ${SUBDIVISION[sub]} of ${beat} (16th ${s + 1})`;
  }
  return `${prefix}${fraction(f)} of the way through the cycle`;
}

// ---------------------------------------------------------------- values

const NOTE_RE = /^([a-g])([#bsf]*)(-?\d+)?$/i;
const PITCH: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

function fallbackNoteToMidi(name: string): number | undefined {
  const m = NOTE_RE.exec(name.trim());
  if (!m) return undefined;
  let acc = 0;
  for (const ch of m[2].toLowerCase()) acc += ch === '#' || ch === 's' ? 1 : -1;
  const octave = m[3] === undefined ? 3 : Number(m[3]);
  return (octave + 1) * 12 + PITCH[m[1].toLowerCase()] + acc;
}

function toMidi(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return undefined;
  if (/^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  const g = (globalThis as { noteToMidi?: (s: string) => number }).noteToMidi;
  if (typeof g === 'function') {
    try {
      const n = g(v);
      if (typeof n === 'number' && Number.isFinite(n)) return n;
    } catch {
      /* fall through */
    }
  }
  return fallbackNoteToMidi(v);
}

const NOTE_KEYS = new Set(['note']);

/** A comparable form of a control value: numbers for pitches and numeric strings. */
function normalise(key: string, v: unknown): unknown {
  if (NOTE_KEYS.has(key)) {
    const m = toMidi(v);
    if (m !== undefined) return m;
  }
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return v;
}

function same(key: string, a: unknown, b: unknown): boolean {
  const x = normalise(key, a);
  const y = normalise(key, b);
  if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) < 1e-4;
  if (x === y) return true;
  // arrays / objects (rare): structural
  return typeof x === 'object' && JSON.stringify(x) === JSON.stringify(y);
}

function show(v: unknown): string {
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/** How to name an event in a message: "`cp`", "`c3 piano`", "`bd` n=3". */
function label(value: Record<string, unknown>, keys: string[]): string {
  const main: string[] = [];
  for (const k of ['s', 'note', 'n', 'value']) {
    if (keys.includes(k) && value[k] !== undefined) main.push(show(value[k]));
  }
  const rest = keys.filter((k) => !['s', 'note', 'n', 'value'].includes(k) && value[k] !== undefined);
  const head = main.length ? `\`${main.join(' ')}\`` : 'an event';
  if (!rest.length || rest.length > 3) return head;
  return `${head} (${rest.map((k) => `${k} ${show(value[k])}`).join(', ')})`;
}

// ---------------------------------------------------------------- control aliases

// Strudel stores controls under their canonical name: `.lpf(800)` yields
// `{ cutoff: 800 }`, `.hpf()` → `hcutoff`, `.lpq()` → `resonance`. Checks are
// written with the names the learner types, so resolve them the same way
// Strudel does: call the global control function and read the key it sets.
const FALLBACK_ALIASES: Record<string, string> = {
  lpf: 'cutoff', lp: 'cutoff', ctf: 'cutoff',
  hpf: 'hcutoff', hp: 'hcutoff',
  lpq: 'resonance', hpq: 'hresonance', bpf: 'bandf', bp: 'bandf', bpq: 'bandq',
  sound: 's', lpe: 'lpenv', hpe: 'hpenv', bpe: 'bpenv',
  att: 'attack', dec: 'decay', sus: 'sustain', rel: 'release',
  size: 'roomsize', sz: 'roomsize', dt: 'delaytime', dfb: 'delayfeedback',
};
const aliasCache = new Map<string, string>();

export function canonicalKey(key: string): string {
  const hit = aliasCache.get(key);
  if (hit) return hit;
  let out = FALLBACK_ALIASES[key] ?? key;
  try {
    const f = (globalThis as Record<string, unknown>)[key];
    if (typeof f === 'function') {
      const pat = (f as (v: number) => { firstCycle?: () => Array<{ value: unknown }> })(1);
      const v = pat?.firstCycle?.()[0]?.value;
      if (v && typeof v === 'object') {
        const keys = Object.keys(v);
        if (keys.length === 1) out = keys[0];
      }
    }
  } catch {
    /* not a control function */
  }
  aliasCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------- conditions

const list = (x: string | string[] | undefined): string[] =>
  x === undefined ? [] : Array.isArray(x) ? x : [x];

function countPhrase(n: number, cycles: number): string {
  const unit = n === 1 ? 'event' : 'events';
  return cycles === 1 ? `${n} ${unit} per cycle` : `${n} ${unit} over ${cycles} cycles`;
}

function checkEvents(rule: number | [number, number], evs: Ev[], cycles: number): Result {
  const got = evs.length;
  if (typeof rule === 'number') {
    return got === rule
      ? { ok: true, message: countPhrase(got, cycles) }
      : { ok: false, message: `Expected ${countPhrase(rule, cycles)}, got ${got}` };
  }
  const [min, max] = rule;
  const where = cycles === 1 ? 'per cycle' : `over ${cycles} cycles`;
  return got >= min && got <= max
    ? { ok: true, message: countPhrase(got, cycles) }
    : { ok: false, message: `Expected between ${min} and ${max} events ${where}, got ${got}` };
}

function ruleText(rule: ValueRule): string {
  return Array.isArray(rule) ? `between ${rule[0]} and ${rule[1]}` : `\`${show(rule)}\``;
}

function fits(key: string, v: unknown, rule: ValueRule): boolean {
  if (v === undefined) return false;
  if (Array.isArray(rule)) {
    const n = normalise(key, v);
    return typeof n === 'number' && n >= rule[0] - 1e-9 && n <= rule[1] + 1e-9;
  }
  return same(key, v, rule);
}

function checkHas(rules: Record<string, ValueRule>, evs: Ev[], cycles: number): Result[] {
  return Object.entries(rules).map(([key, rule]) => {
    const want = `\`${key}\` ${Array.isArray(rule) ? ruleText(rule) : `= ${ruleText(rule)}`}`;
    if (!evs.length) {
      return {
        ok: false,
        message: `Every event should have ${want}, but the pattern makes no events${cycles === 1 ? ' in the first cycle' : ''}`,
      };
    }
    const ck = canonicalKey(key);
    const bad = evs.filter((e) => !fits(ck, e.value[ck], rule));
    if (!bad.length) return { ok: true, message: `Every event has ${want}` };
    const missing = bad.filter((e) => e.value[ck] === undefined).length;
    const wrong = bad.filter((e) => e.value[ck] !== undefined);
    const parts: string[] = [];
    if (missing) {
      parts.push(
        missing === evs.length
          ? `no event has \`${key}\` yet`
          : `${missing} of ${evs.length} events have no \`${key}\``
      );
    }
    if (wrong.length) {
      const seen = [...new Set(wrong.map((e) => show(e.value[ck])))].slice(0, 4);
      parts.push(`${wrong.length} of ${evs.length} have \`${key}\` ${seen.join(', ')}`);
    }
    return { ok: false, message: `Every event should have ${want}: ${parts.join('; ')}` };
  });
}

function keysOf(evs: Ev[]): string[] {
  const keys = new Set<string>();
  for (const e of evs) for (const k of Object.keys(e.value)) if (!META_KEYS.has(k)) keys.add(k);
  return [...keys];
}

const MAX_DIFFS = 6;

function checkMatch(mine: Ev[], theirs: Ev[], keys: string[] | undefined, cycles: number): Result {
  const k = keys ? keys.map(canonicalKey) : keysOf(theirs);
  const equal = (a: Ev, b: Ev) => k.every((key) => {
    const x = a.value[key];
    const y = b.value[key];
    if (x === undefined || y === undefined) return x === y;
    return same(key, x, y);
  });
  const near = (a: Ev, b: Ev) => Math.abs(a.t - b.t) < EPS;

  const leftMine = [...mine];
  const leftTheirs: Ev[] = [];
  for (const t of theirs) {
    const i = leftMine.findIndex((m) => near(m, t) && equal(m, t));
    if (i === -1) leftTheirs.push(t);
    else leftMine.splice(i, 1);
  }
  if (!leftMine.length && !leftTheirs.length) {
    return {
      ok: true,
      message: `Matches the target (${countPhrase(theirs.length, cycles)})`,
    };
  }

  // Pair what is left at the same moment: that is "right hit, wrong settings".
  const diffs: { t: number; text: string }[] = [];
  for (const t of [...leftTheirs]) {
    const i = leftMine.findIndex((m) => near(m, t));
    if (i === -1) continue;
    const m = leftMine[i];
    leftMine.splice(i, 1);
    leftTheirs.splice(leftTheirs.indexOf(t), 1);
    const wrong = k
      .filter((key) => {
        const x = m.value[key];
        const y = t.value[key];
        if (x === undefined || y === undefined) return x !== y;
        return !same(key, x, y);
      })
      .map((key) =>
        m.value[key] === undefined
          ? `no \`${key}\` (expected ${show(t.value[key])})`
          : t.value[key] === undefined
            ? `unexpected \`${key}\` ${show(m.value[key])}`
            : `\`${key}\` is ${show(m.value[key])}, expected ${show(t.value[key])}`
      );
    diffs.push({ t: t.t, text: `on ${describeTime(t.t, cycles)}: ${wrong.join(', ')}` });
  }
  for (const t of leftTheirs) {
    diffs.push({ t: t.t, text: `missing ${label(t.value, k)} on ${describeTime(t.t, cycles)}` });
  }
  for (const m of leftMine) {
    diffs.push({ t: m.t, text: `extra ${label(m.value, k)} on ${describeTime(m.t, cycles)}` });
  }
  diffs.sort((a, b) => a.t - b.t);
  const shown = diffs.slice(0, MAX_DIFFS).map((d) => d.text);
  if (diffs.length > MAX_DIFFS) shown.push(`… and ${diffs.length - MAX_DIFFS} more`);
  return { ok: false, message: `Not the target yet: ${shown.join(' · ')}` };
}

function checkFn(src: string, evs: Ev[], code: string): Result {
  let fn: unknown;
  try {
    fn = new Function('return (' + src + ')')();
  } catch (e) {
    return { ok: false, message: `This step's custom check doesn't compile: ${(e as Error).message}` };
  }
  if (typeof fn !== 'function') return { ok: false, message: "This step's custom check isn't a function" };
  try {
    const out = fn(
      evs.map((e) => ({ t: e.t, dur: e.dur, value: e.value })),
      code
    );
    if (out === true) return { ok: true, message: 'Custom check passed' };
    if (typeof out === 'string' && out) return { ok: false, message: out };
    return { ok: false, message: 'Not quite yet' };
  } catch (e) {
    return { ok: false, message: `This step's custom check threw: ${(e as Error).message}` };
  }
}

/**
 * Evaluate every condition in `check`. All present fields must pass.
 * If `check.message` is set, it replaces the generated failure messages
 * (passing conditions are still listed).
 */
export async function runCheck(check: Check, ctx: CheckContext): Promise<Result[]> {
  const cycles = check.cycles && check.cycles > 0 ? check.cycles : 1;
  const out: Result[] = [];

  for (const s of list(check.includes)) {
    out.push(
      ctx.code.includes(s)
        ? { ok: true, message: `Contains \`${s}\`` }
        : { ok: false, message: `Your code should contain \`${s}\`` }
    );
  }
  for (const s of list(check.excludes)) {
    out.push(
      ctx.code.includes(s)
        ? { ok: false, message: `Your code should not contain \`${s}\` any more` }
        : { ok: true, message: `No \`${s}\`` }
    );
  }
  if (check.code !== undefined) {
    let ok = false;
    try {
      ok = new RegExp(check.code).test(ctx.code);
    } catch {
      /* a broken regex is a content bug: fail, and QA will flag it */
    }
    out.push(
      ok
        ? { ok: true, message: 'Code has the expected shape' }
        : { ok: false, message: "Your code doesn't have the expected shape yet" }
    );
  }

  const needsEvents =
    check.match !== undefined && check.match !== false ||
    check.events !== undefined ||
    check.has !== undefined ||
    check.fn !== undefined;
  const evs = needsEvents ? eventsOf(ctx.pattern, cycles) : [];

  if (check.events !== undefined) out.push(checkEvents(check.events, evs, cycles));
  if (check.has) out.push(...checkHas(check.has, evs, cycles));
  if (check.match) {
    if (!ctx.target) {
      out.push({ ok: false, message: 'This exercise has no target to compare against' });
    } else {
      try {
        const tp = await ctx.target();
        const keys = typeof check.match === 'object' ? check.match.keys : undefined;
        out.push(checkMatch(evs, eventsOf(tp, cycles), keys, cycles));
      } catch (e) {
        out.push({ ok: false, message: `The target couldn't be evaluated: ${(e as Error).message}` });
      }
    }
  }
  if (check.fn !== undefined) out.push(checkFn(check.fn, evs, ctx.code));

  if (check.message && out.some((r) => !r.ok)) {
    return [...out.filter((r) => r.ok), { ok: false, message: check.message }];
  }
  return out;
}

export const passed = (results: Result[]) => results.every((r) => r.ok);
