// Client runtime for <Exercise>/<Step>. The contract is src/exercise/types.ts;
// the check engine is src/exercise/check.ts (shared with the QA harness).
import type { Check } from '../exercise/types';
import { passed, runCheck, type PatternLike, type Result, malformedValues, unknownSounds } from '../exercise/check';

// ---------------------------------------------------------------- strudel glue

interface Repl {
  evaluate(code: string, autostart?: boolean): Promise<PatternLike | undefined>;
  scheduler: { started: boolean };
  state: { evalError?: unknown };
}
interface Mirror {
  code: string;
  repl: Repl;
  setCode(code: string): void;
  toggle(): Promise<void>;
  stop(): Promise<void>;
  clear?(): void;
}
type EditorEl = HTMLElement & { editor?: Mirror };

type Evaluated = { pattern: PatternLike | null; error?: undefined } | { pattern?: undefined; error: string };

// Strudel's evaluate swaps a global (`Pattern.prototype.p`, used by `$:`)
// before awaiting, so two evaluations must never interleave.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

const errText = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === 'string' ? e : String(e ?? 'unknown error');

/**
 * Evaluate an editor's OWN text (never anything else: its highlighting maps
 * positions from the evaluated code onto its document). Empty code is silence.
 */
function evaluateOwn(el: EditorEl, autostart?: boolean): Promise<Evaluated> {
  return serial(async () => {
    const ed = el.editor!;
    if (!ed.code.trim()) return { pattern: null };
    try {
      const p = await ed.repl.evaluate(ed.code, autostart ?? ed.repl.scheduler.started);
      if (p) return { pattern: p };
      return { error: errText(ed.repl.state.evalError) };
    } catch (e) {
      return { error: errText(e) };
    }
  });
}

/** A hidden <strudel-editor>: plays and evaluates without being seen. */
function hiddenEditor(host: HTMLElement, code: string): EditorEl {
  const box = document.createElement('div');
  box.hidden = true;
  box.className = 'exercise-hidden-editor';
  const el = document.createElement('strudel-editor') as EditorEl;
  el.setAttribute('code', code);
  box.append(el);
  host.append(box);
  return el;
}

// ---------------------------------------------------------------- storage

const KEY = 'strudel-tutorial:exercises';
interface Saved {
  code?: string;
  step?: number;
  done?: boolean;
  /** Fingerprint of the exercise this draft was written against. */
  fp?: string;
}

/** Stable short hash (djb2) — used to notice that an exercise was edited. */
function fingerprint(parts: (string | undefined)[]): string {
  let h = 5381;
  const text = parts.filter(Boolean).join('\u0000');
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function readAll(): Record<string, Saved> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && raw.v === 1 && raw.items && typeof raw.items === 'object') return raw.items;
  } catch {
    /* unavailable or corrupt: start fresh */
  }
  return {};
}

function writeOne(id: string, entry: Saved | null) {
  try {
    const items = readAll();
    if (entry) items[id] = entry;
    else delete items[id];
    localStorage.setItem(KEY, JSON.stringify({ v: 1, items }));
  } catch {
    /* storage is a convenience */
  }
}

// ---------------------------------------------------------------- markdown-lite

/** Fill `el` with text where `backtick` spans become <code>. No HTML parsing. */
function renderInline(el: HTMLElement, text: string) {
  el.textContent = '';
  text.split('`').forEach((part, i) => {
    if (!part) return;
    if (i % 2) {
      const c = document.createElement('code');
      c.textContent = part;
      el.append(c);
    } else el.append(part);
  });
}

function parseJSON<T>(s: string | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------- one exercise

interface StepInfo {
  el: HTMLElement;
  check?: Check;
  hints: string[];
  solution: string;
  /** Overrides the exercise target for this step's `match` and [▶ target]. */
  target?: string;
}

interface Target {
  el: EditorEl;
  pattern?: Promise<PatternLike | null>;
}

class ExerciseUI {
  readonly id: string;
  readonly start: string;
  readonly targetCode?: string;
  readonly check?: Check;
  /** Exercise-level hints, used by [hint] when there are no steps. */
  readonly hints: string[];
  readonly steps: StepInfo[];
  readonly editorEl: EditorEl;
  step = 0;
  done = false;
  private hintsShown = 0;
  /** Hidden editors, one per distinct target code, created on first use. */
  private targets = new Map<string, Target>();
  private busy = false;
  private wasPending = false;
  private saveTimer?: number;

  private q = <T extends Element>(sel: string) => this.root.querySelector<T>(sel);
  private feedback: HTMLElement;
  private status: HTMLElement | null;

  constructor(readonly root: HTMLElement) {
    this.id = root.dataset.exercise!;
    this.start = root.dataset.start ?? '';
    this.targetCode = root.dataset.target || undefined;
    this.check = parseJSON<Check | undefined>(root.dataset.check, undefined);
    this.hints = parseJSON<string[]>(root.dataset.hints, []);
    this.editorEl = root.querySelector('.exercise-editor strudel-editor') as EditorEl;
    this.feedback = this.q<HTMLElement>('[data-exercise-feedback]')!;
    this.status = this.q<HTMLElement>('[data-exercise-status]');
    this.steps = [...root.querySelectorAll<HTMLElement>('[data-step]')].map((el) => ({
      el,
      check: parseJSON<Check | undefined>(el.dataset.check, undefined),
      hints: parseJSON<string[]>(el.dataset.hints, []),
      solution: el.dataset.solution ?? '',
      target: el.dataset.target || undefined,
    }));
    this.steps.forEach((s, i) => {
      const num = s.el.querySelector('[data-step-num]');
      if (num) num.textContent = String(i + 1);
    });

    this.fp = fingerprint([
      this.start,
      this.targetCode,
      ...this.steps.map((st) => st.solution),
      ...this.steps.map((st) => st.target),
    ]);

    const saved = readAll()[this.id];
    if (saved) {
      // The exercise changed since this draft was written (a fixed bug, new
      // steps). Their code is kept; they are offered the new version.
      this.outdated = saved.fp !== this.fp;
      this.done = !!saved.done;
      this.step = Math.min(Math.max(0, saved.step ?? 0), this.steps.length);
      if (this.done) this.step = this.steps.length;
      if (typeof saved.code === 'string' && saved.code !== this.editor.code) {
        this.editor.setCode(saved.code);
      }
    }
    this.wire();
    this.render();
  }

  private fp = '';
  private outdated = false;

  get editor() {
    return this.editorEl.editor!;
  }

  get current(): StepInfo | undefined {
    return this.steps[this.step];
  }

  /** The check that decides "done right now": the current step's, or the exercise's. */
  get activeCheck(): Check | undefined {
    if (!this.steps.length) return this.check;
    return (this.current ?? this.steps[this.steps.length - 1]).check;
  }

  // -------------------------------------------------------------- target

  /** The step whose target applies: the current one, or the last once done. */
  private get targetStep(): StepInfo | undefined {
    return this.current ?? this.steps[this.steps.length - 1];
  }

  /** Target code for a step (its own, else the exercise's). */
  targetFor(step?: StepInfo): string | undefined {
    return step?.target ?? this.targetCode;
  }

  ensureTarget(code: string): Target {
    let t = this.targets.get(code);
    if (!t) {
      t = { el: hiddenEditor(this.root, code) };
      this.targets.set(code, t);
      t.el.addEventListener('update', () => this.renderTargetButton());
    }
    return t;
  }

  private renderTargetButton() {
    const btn = this.q<HTMLButtonElement>('[data-ex-target]');
    if (!btn) return;
    const started = [...this.targets.values()].some((t) => t.el.editor?.repl.scheduler.started);
    btn.textContent = started ? '■ target' : '▶ target';
    btn.classList.toggle('is-playing', started);
    btn.setAttribute('aria-pressed', String(started));
    btn.hidden = !started && !this.targetFor(this.targetStep);
  }

  private toggleTarget() {
    const playing = [...this.targets.values()].find((t) => t.el.editor?.repl.scheduler.started);
    if (playing) {
      playing.el.editor!.stop();
      return;
    }
    const code = this.targetFor(this.targetStep);
    if (code) void this.ensureTarget(code).el.editor!.toggle();
  }

  /** A target's Pattern, evaluated once. Throws with a readable message. */
  targetPattern(code: string): Promise<PatternLike | null> {
    const t = this.ensureTarget(code);
    if (!t.pattern) {
      t.pattern = evaluateOwn(t.el).then((r) => {
        if (r.error !== undefined) {
          t.pattern = undefined;
          throw new Error(r.error);
        }
        return r.pattern;
      });
    }
    return t.pattern;
  }

  // -------------------------------------------------------------- checking

  /**
   * Shared by UI and QA: evaluate `check` for a given code + pattern, with
   * `match` comparing against `step`'s target (or the exercise's).
   */
  results(check: Check, code: string, pattern: PatternLike | null, step?: StepInfo): Promise<Result[]> {
    const target = this.targetFor(step);
    return runCheck(check, {
      code,
      pattern,
      target: target ? () => this.targetPattern(target) : undefined,
    });
  }

  /** [check] button: evaluate the editor, then check. */
  async checkNow() {
    const r = await this.withBusy(() => evaluateOwn(this.editorEl));
    await this.afterEvaluate(r, this.editor.code);
  }

  private async withBusy<T>(job: () => Promise<T>): Promise<T> {
    this.busy = true;
    try {
      return await job();
    } finally {
      this.busy = false;
    }
  }

  async afterEvaluate(r: Evaluated, code: string) {
    this.saveNow();
    if (r.error !== undefined) {
      this.showError(r.error);
      return;
    }
    const check = this.activeCheck;
    const step = this.targetStep;
    if (this.done || !check) {
      if (check) this.showResults(await this.results(check, code, r.pattern, step), false);
      return;
    }
    const res = await this.results(check, code, r.pattern, step);
    if (!passed(res)) {
      this.showResults(res, false);
      return;
    }
    // Passed. Advance, and keep going while the learner is already ahead.
    const cleared: number[] = [];
    if (!this.steps.length) {
      this.done = true;
    } else {
      do {
        cleared.push(this.step);
        this.step++;
        const next = this.current;
        if (!next || !next.check) break;
        if (!passed(await this.results(next.check, code, r.pattern, next))) break;
      } while (true);
      this.hintsShown = 0;
      if (this.step >= this.steps.length) this.done = true;
    }
    this.saveNow();
    this.render();
    this.showSuccess(res, cleared);
  }

  // -------------------------------------------------------------- feedback

  private clearFeedback() {
    this.feedback.textContent = '';
    this.feedback.removeAttribute('data-state');
  }

  private showError(msg: string) {
    this.clearFeedback();
    this.feedback.dataset.state = 'error';
    const p = document.createElement('p');
    p.className = 'exercise-feedback-title';
    p.textContent = "✗ Your code didn't run";
    const pre = document.createElement('pre');
    pre.className = 'exercise-error';
    pre.textContent = msg;
    const tip = document.createElement('p');
    tip.className = 'exercise-feedback-note';
    tip.textContent = 'Fix the error and press ctrl+enter again. Nothing was checked.';
    this.feedback.append(p, pre, tip);
  }

  private showResults(res: Result[], ok: boolean, title?: string) {
    this.clearFeedback();
    this.feedback.dataset.state = ok || passed(res) ? 'ok' : 'fail';
    if (title) {
      const p = document.createElement('p');
      p.className = 'exercise-feedback-title';
      renderInline(p, title);
      this.feedback.append(p);
    }
    const ul = document.createElement('ul');
    ul.className = 'exercise-results';
    for (const r of res) {
      const li = document.createElement('li');
      li.dataset.ok = String(r.ok);
      const mark = document.createElement('span');
      mark.className = 'exercise-result-mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = r.ok ? '✓' : '✗';
      const sr = document.createElement('span');
      sr.className = 'sr-only';
      sr.textContent = r.ok ? 'passed: ' : 'not yet: ';
      const text = document.createElement('span');
      renderInline(text, r.message);
      li.append(mark, sr, text);
      ul.append(li);
    }
    if (res.length) this.feedback.append(ul);
  }

  private showSuccess(res: Result[], cleared: number[]) {
    let title: string;
    if (!this.steps.length) title = '✓ Goal reached.';
    else {
      const names = cleared.map((i) => i + 1).join(', ');
      title = `✓ Step${cleared.length > 1 ? 's' : ''} ${names} done.`;
      if (!this.done) title += ` On to step ${this.step + 1}.`;
    }
    if (this.done) title += ' Exercise complete!';
    this.showResults(res, true, title);
  }

  // -------------------------------------------------------------- render

  render() {
    const n = this.steps.length;
    this.renderOutdated();
    this.root.toggleAttribute('data-done', this.done);
    this.steps.forEach((s, i) => {
      const state = this.done || i < this.step ? 'done' : i === this.step ? 'current' : 'todo';
      s.el.dataset.state = state;
      s.el.hidden = state === 'todo';
      if (state === 'current') s.el.setAttribute('aria-current', 'step');
      else s.el.removeAttribute('aria-current');
      const label = s.el.querySelector('[data-step-label]');
      if (label) label.textContent = `Step ${i + 1} of ${n}`;
      const st = s.el.querySelector('[data-step-state]');
      if (st) st.textContent = state === 'done' ? ' · done' : s.check ? ' · your turn' : ' · listen';
      const cont = s.el.querySelector<HTMLButtonElement>('[data-step-continue]');
      if (cont) cont.hidden = state !== 'current';
      // The step's answer is its own always-available control while the step is
      // current, so that [hint] never has to reveal it.
      const sol = s.el.querySelector<HTMLDetailsElement>('[data-step-solution]');
      if (state === 'current') {
        if (sol) sol.hidden = false;
      } else {
        s.el.querySelector<HTMLElement>('[data-step-hints]')?.setAttribute('hidden', '');
        if (sol) {
          sol.hidden = true;
          sol.open = false;
        }
      }
    });
    const doneEl = this.q<HTMLElement>('[data-exercise-done]');
    if (doneEl) doneEl.hidden = !this.done;
    if (this.status) {
      this.status.textContent = this.done
        ? '✓ done'
        : n
          ? `step ${this.step + 1} of ${n}`
          : 'your turn';
    }
    const hint = this.q<HTMLButtonElement>('[data-ex-hint]');
    if (hint) hint.disabled = this.done;
    this.renderTargetButton();
  }

  // -------------------------------------------------------------- hints

  /**
   * [hint] reveals one hint per click and NEVER the answer. Hints come from the
   * current step, or from the exercise itself when it has no steps. Once they
   * run out it says so and points at the answer's own explicit reveal.
   */
  private hint() {
    const s = this.current;
    const hints = s ? s.hints : this.hints;
    const list = s
      ? s.el.querySelector<HTMLOListElement>('[data-step-hints]')
      : this.q<HTMLOListElement>('[data-exercise-hints]');
    const reveal = s ? '“Show this step’s answer”' : '“Show answer”';
    const where = s ? 'this step’s answer' : 'the answer';
    const tail =
      s || this.q('details.exercise-answer')
        ? `To see ${where}, open ${reveal} below — [hint] never gives it away.`
        : '[hint] never gives the answer away.';
    if (list && this.hintsShown < hints.length) {
      const li = document.createElement('li');
      renderInline(li, hints[this.hintsShown]);
      list.append(li);
      list.hidden = false;
      this.hintsShown++;
      if (this.hintsShown === hints.length) this.feedbackNote(`That was the last hint. ${tail}`);
      return;
    }
    this.feedbackNote(hints.length ? `No more hints for this one. ${tail}` : `No hints for this one. ${tail}`);
  }

  private feedbackNote(text: string) {
    this.clearFeedback();
    const p = document.createElement('p');
    p.className = 'exercise-feedback-note';
    p.textContent = text;
    this.feedback.append(p);
  }

  private resetHints() {
    this.hintsShown = 0;
    const own = this.q<HTMLElement>('[data-exercise-hints]');
    if (own) {
      own.textContent = '';
      own.hidden = true;
    }
    for (const s of this.steps) {
      const list = s.el.querySelector<HTMLElement>('[data-step-hints]');
      if (list) {
        list.textContent = '';
        list.hidden = true;
      }
      const sol = s.el.querySelector<HTMLDetailsElement>('[data-step-solution]');
      if (sol) {
        sol.hidden = true;
        sol.open = false;
      }
    }
  }

  /** Back to the start: code, step counter, done state, revealed hints. */
  /**
   * A draft written against an older version of this exercise. The code is
   * kept — it may be their own work — but a fixed exercise would otherwise
   * never reach someone who had already typed in it.
   */
  private renderOutdated() {
    const existing = this.root.querySelector('[data-exercise-outdated]');
    if (!this.outdated) {
      existing?.remove();
      return;
    }
    if (existing) return;

    const box = document.createElement('div');
    box.className = 'exercise-outdated';
    box.setAttribute('data-exercise-outdated', '');
    const text = document.createElement('span');
    text.textContent = 'This exercise was updated since you last worked on it. Your code is still here.';
    const load = document.createElement('button');
    load.type = 'button';
    load.className = 'ex-btn';
    load.textContent = 'load the updated version';
    load.addEventListener('click', () => {
      if (!window.confirm('Replace your code with the updated starting code?')) return;
      this.outdated = false;
      this.reset();
    });
    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'ex-btn';
    keep.textContent = 'keep mine';
    keep.addEventListener('click', () => {
      this.outdated = false;
      this.saveNow();
      this.render();
    });
    box.append(text, load, keep);
    this.root.querySelector('.exercise-editor')?.before(box);
  }

  reset() {
    this.editor.setCode(this.start);
    this.step = 0;
    this.done = false;
    this.resetHints();
    this.clearFeedback();
    writeOne(this.id, null);
    this.render();
  }

  // -------------------------------------------------------------- persistence

  private save = () => {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 400);
  };

  saveNow() {
    window.clearTimeout(this.saveTimer);
    writeOne(this.id, { code: this.editor.code, step: this.step, done: this.done, fp: this.fp });
  }

  // -------------------------------------------------------------- wiring

  private wire() {
    const play = this.q<HTMLButtonElement>('[data-ex-play]');
    play?.addEventListener('click', () => this.editor.toggle());
    this.q('[data-ex-check]')?.addEventListener('click', () => this.checkNow());
    this.q('[data-ex-target]')?.addEventListener('click', () => this.toggleTarget());
    this.q('[data-ex-hint]')?.addEventListener('click', () => this.hint());
    this.q('[data-ex-reset]')?.addEventListener('click', () => {
      if (!window.confirm('Reset this exercise? Your code and step progress will be lost.')) return;
      this.reset();
    });

    for (const s of this.steps) {
      s.el.querySelector('[data-step-continue]')?.addEventListener('click', () => {
        if (this.current !== s) return;
        this.step++;
        this.hintsShown = 0;
        if (this.step >= this.steps.length) this.done = true;
        this.saveNow();
        this.render();
        if (this.done) this.feedbackNote('✓ Exercise complete!');
        else this.clearFeedback();
        // keep keyboard users in the flow: focus the next step's first control
        const next = this.current?.el.querySelector<HTMLElement>('[data-step-continue]');
        next?.focus();
      });
      s.el.querySelector('[data-step-load]')?.addEventListener('click', () => {
        this.editor.setCode(s.solution);
        this.saveNow();
        this.feedbackNote('Loaded this step’s answer. Press ctrl+enter (or check) to run it.');
      });
    }

    // Every state change of the learner's repl: play state, edits, evaluations.
    this.editorEl.addEventListener('update', (e) => {
      const d = (e as CustomEvent).detail ?? {};
      const started = !!d.started;
      if (play) {
        play.textContent = started ? '■ stop' : '▶ play';
        play.classList.toggle('is-playing', started);
        play.setAttribute('aria-pressed', String(started));
      }
      if (typeof d.code === 'string' && d.code !== readAll()[this.id]?.code) this.save();

      const finished = this.wasPending && !d.pending;
      this.wasPending = !!d.pending;
      // Our own [check] handles its result; this is for ctrl+enter / play.
      if (!finished || this.busy) return;
      if (d.evalError) void this.afterEvaluate({ error: errText(d.evalError) }, this.editor.code);
      else if (d.pattern) void this.afterEvaluate({ pattern: d.pattern }, d.activeCode ?? this.editor.code);
    });
  }
}

// ---------------------------------------------------------------- boot

const uis = new Map<HTMLElement, ExerciseUI>();

function boot() {
  document.querySelectorAll<HTMLElement>('section.exercise[data-exercise]').forEach((root) => {
    if (uis.has(root)) return;
    const el = root.querySelector('.exercise-editor strudel-editor') as EditorEl | null;
    if (!el?.editor) return;
    uis.set(root, new ExerciseUI(root));
  });
  wirePageReset();
}

/** Put every exercise on this page back to its start, in place. */
function resetAllOnPage() {
  for (const ui of uis.values()) ui.reset();
}

/**
 * "Reset this page" (in the chapter layout). It stays hidden until there is at
 * least one live exercise to reset, so pages without exercises never show it.
 */
function wirePageReset() {
  const btn = document.querySelector<HTMLButtonElement>('[data-reset-page]');
  if (!btn || !uis.size) return;
  btn.hidden = false;
  if (btn.dataset.wired) return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', () => {
    const n = uis.size;
    const what = n === 1 ? 'the 1 exercise' : `all ${n} exercises`;
    const msg =
      `Reset ${what} on this page?\n\n` +
      `The code you have written ${n === 1 ? 'in it' : 'in them'} goes back to the starting code, ` +
      'and step progress is cleared. This cannot be undone.';
    if (!window.confirm(msg)) return;
    resetAllOnPage();
  });
}

// "Reset everything" (home page) wipes the storage key, then asks any exercise
// on screen to redraw itself from its start code.
window.addEventListener('strudel-tutorial:reset-exercises', resetAllOnPage);

customElements.whenDefined('strudel-editor').then(boot);

// ---------------------------------------------------------------- QA harness

if (import.meta.env.DEV) {
  interface Problem {
    exercise: string;
    where: string;
    problem: string;
  }

  (window as unknown as { __exerciseQA: () => Promise<unknown> }).__exerciseQA = async () => {
    boot();
    const problems: Problem[] = [];
    const exercises: unknown[] = [];
    const host = document.createElement('div');
    document.body.append(host);
    const scratch = hiddenEditor(host, '// qa');
    await customElements.whenDefined('strudel-editor');

    const evalCode = async (code: string): Promise<Evaluated> => {
      scratch.editor!.setCode(code);
      return evaluateOwn(scratch, false);
    };

    const failures = (res: Result[]) => res.filter((r) => !r.ok).map((r) => r.message);

    try {
      for (const ui of uis.values()) {
        const id = ui.id;
        const add = (where: string, problem: string) => problems.push({ exercise: id, where, problem });
        const report: Record<string, unknown> = { id, steps: [] as unknown[] };

        const start = await evalCode(ui.start);
        if (start.error !== undefined) add('start', `start fails to evaluate: ${start.error}`);
        else {
          const bad = malformedValues(start.pattern) ?? unknownSounds(start.pattern, ui.start);
          if (bad) add('start', bad);
        }

        const targets = new Map<string, string>();
        if (ui.targetCode) targets.set(ui.targetCode, 'target');
        ui.steps.forEach((s, i) => s.target && !targets.has(s.target) && targets.set(s.target, `step ${i + 1} target`));
        for (const [code, where] of targets) {
          try {
            const tp = await ui.targetPattern(code);
            const bad = malformedValues(tp) ?? unknownSounds(tp, code);
            if (bad) add(where, bad);
          } catch (e) {
            add(where, `${where} fails to evaluate: ${errText(e)}`);
          }
        }

        if (!ui.steps.length) {
          if (!ui.check) add('exercise', 'no steps and no exercise-level check: it can never complete');
          else {
            const answer =
              ui.root.querySelector('details.exercise-answer code')?.textContent ?? ui.targetCode ?? '';
            const a = await evalCode(answer);
            if (a.error !== undefined) add('answer', `answer fails to evaluate: ${a.error}`);
            else {
              const res = await ui.results(ui.check, answer, a.pattern);
              report.passOnAnswer = passed(res);
              if (!passed(res)) add('answer', `check fails on the answer: ${failures(res).join(' | ')}`);
            }
            if (start.error === undefined) {
              const res = await ui.results(ui.check, ui.start, start.pattern);
              report.failOnStart = !passed(res);
              if (passed(res)) add('start', 'check already passes on `start`: the exercise completes itself');
            }
          }
        } else if (ui.check) {
          add('exercise', 'exercise-level `check` is ignored because the exercise has steps');
        }

        let prevCode = ui.start;
        let prev: Evaluated = start;
        for (const [i, s] of ui.steps.entries()) {
          const where = `step ${i + 1}`;
          const entry: Record<string, unknown> = { step: i + 1, listen: !s.check, ownTarget: !!s.target };
          const sol = await evalCode(s.solution);
          if (!s.solution.trim()) add(where, 'empty data-solution');
          if (sol.error !== undefined) add(where, `solution fails to evaluate: ${sol.error}`);
          else {
            const bad = malformedValues(sol.pattern) ?? unknownSounds(sol.pattern, s.solution);
            if (bad) add(where, bad);
          }
          if (s.check && sol.error === undefined) {
            const res = await ui.results(s.check, s.solution, sol.pattern, s);
            entry.passOnSolution = passed(res);
            if (!passed(res)) add(where, `check fails on its own solution: ${failures(res).join(' | ')}`);
            if (prev.error === undefined) {
              const before = await ui.results(s.check, prevCode, prev.pattern, s);
              entry.failOnPrevious = !passed(before);
              if (passed(before)) {
                add(where, `check already passes on ${i ? `step ${i}'s solution` : '`start`'}: the step completes itself`);
              }
            }
          }
          (report.steps as unknown[]).push(entry);
          prevCode = s.solution;
          prev = sol;
        }
        report.ok = !problems.some((p) => p.exercise === id);
        exercises.push(report);
      }
    } finally {
      scratch.editor?.stop();
      scratch.editor?.clear?.();
      host.remove();
    }

    const result = { ok: problems.length === 0, exercises: exercises.length, problems, details: exercises };
    if (problems.length) console.table(problems);
    else console.info(`[exerciseQA] ${exercises.length} exercise(s), all checks well-formed`);
    return result;
  };
}
