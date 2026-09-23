# Authoring a chapter as exercises

How every chapter of this tutorial is written. The format was piloted on
`src/pages/tutorial/mini-notation.mdx` and `src/pages/tutorial/time.mdx` — **read both before
writing.** They are the reference implementation.

## Who the learner is

A senior TypeScript/JavaScript developer who plays keyboards and some bass, uses Ableton Live, and
knows music theory (beats, bars, scales, chords). He does **not** know sound design: filters, LFOs,
envelopes, sidechain and the rest are the gap he is here to close.

- Never explain JavaScript, and never explain basic music theory.
- Spend the whole explanation budget on sound: what an effect does to what you hear, and why you'd
  reach for it. Mapping to Ableton is fair game.

## The rule that drives the format

He rejected the first version of this site: *"Instead of showing me the finished code, lead me to
it. Make me write it. And change it. See the changes happening with my own hands. The way it's
today it's just... reading."*

So: **he types everything.** Read-only `<Strudel>` demos should be near zero — only when the point
is to hear something he cannot write yet. Prose between exercises is 1–3 sentences. Understanding
comes from making a change and hearing the result, not from reading a paragraph about it.

## Components

```mdx
import Exercise from '../../components/Exercise.astro';
import Step from '../../components/Step.astro';
import Box from '../../components/Box.astro';
import QA from '../../components/QA.astro';
import L from '../../components/L.astro';
```

`<L to="/tutorial/filters">Filters</L>` for internal links — never a markdown `[x](/y)` link, since
the site is served under a base path.

```mdx
<Exercise id="filters/sweep" title="Open the filter"
  goal="Hear a lowpass go from muffled to bright." start={`s("sawtooth").note("c2*8")`}
  target={`s("sawtooth").note("c2*8").lpf(400)`}
  hints={['`lpf` is the lowpass cutoff, in Hz.', 'Audible range is roughly 20–20000.']}>
  <Step check={{ includes: '.lpf(', has: { lpf: [100, 800] } }}
        hints={['Chain it: `.lpf(400)`.']}
        solution={`s("sawtooth").note("c2*8").lpf(400)`}>
    Add `.lpf(400)` to the end. Everything above 400 Hz is gone: it sounds like it's behind a door.
  </Step>
</Exercise>
```

- An `<Exercise>` **with** `<Step>` children is a guided exercise: 3–7 steps, one change each.
- An `<Exercise>` **without** steps is a **challenge**: `goal` + `target` + its own `check`
  (usually `{ match: ... }`), an empty or minimal `start`, and `hints`.
- Each section = one guided exercise, then a challenge.
- `id` must be unique across the whole site: `<chapter-slug>/<kebab-name>`.

## Steps

- **One change per step**, and name the function or operator literally in backticks: "Add
  `.lpf(400)`", "Replace `*4` with `.beat("0,4,8,12", 16)`". He types it; the vocabulary is the
  lesson.
- Use the **remove → listen → write** rhythm: a step with `excludes`, then one with
  `includes`/`match`. Hearing the thing disappear teaches what it was doing.
- Tell him what to listen for, in the step text.
- `solution` is required: the **full editor contents** once that step is done. The next step builds
  on it. The exercise's `start` is the state before step 1.
- A step with no `check` is a "listen" step with a continue button. Use sparingly.
- A step may carry its own `target`, and then its `match` compares against that. **Prefer this over
  writing an `fn`** for intermediate steps.

## Hints — never the answer

The learner complained that [hint] showed him the answer. It no longer does; the answer has its own
separate reveal. Your job is to write hints worth reading.

Write **2–3 per challenge** (challenges must have them) and 1–2 on any step that isn't obvious,
narrowing in this order:

1. **Vocabulary.** "`bd` is the bass drum, `sd` the snare, `cp` a clap."
2. **The idea.** "Eight slots means eight tokens separated by spaces; `-` is a rest."
3. **The shape**, without the answer. "Start from `s("bd - - bd ...")` and fill the rest."

Never paste the solution into a hint.

## Checks

`src/exercise/types.ts` is the full reference (`includes`, `excludes`, `code`, `match`, `events`,
`has`, `cycles`, `fn`, `message`). Rules:

1. A step's check **passes on its own `solution`** and **fails on the previous state** (the prior
   step's `solution`, or `start` for step 1). Otherwise the step completes itself on arrival.
2. **Accept every reasonable answer.** Check the musical result (`match`, `events`, `has`) rather
   than the spelling. Use `includes` when the step is literally about typing that function, usually
   combined with a result check. Watch for substring false positives: `includes: '*4'` also matches
   `hh*4`, and `includes: '('` matches everything.
3. Narrow `match` with `keys` so you don't force a `.bank()` or an `.lpf()` the step never asked
   for.
4. **Control names:** Strudel stores some controls canonically — `.lpf()` is `cutoff`, `.hpf()` is
   `hcutoff`, `.lpq()` is `resonance`, `.legato()` is `clip`. `has` and `match.keys` translate for
   you; a raw `fn` sees the canonical names.
5. **Rhythm comes from the left:** `note("c e g").s("sawtooth")` has three events;
   `s("sawtooth").note("c e g")` has one.
6. Randomness (`?`, `|`, `degradeBy`, `rand`) can't be matched exactly — use `includes` plus an
   `events` range.
7. Tempo (`setcpm`) doesn't change event positions within a cycle. Check it with `includes`/`code`.
8. `has` on an effect only sees it if the effect is actually on the event, so check ranges like
   `has: { lpf: [100, 800] }` rather than an exact number the learner has to guess.

## Validating before you finish — required

A headless harness runs the real Strudel transpiler:
`/private/tmp/claude-501/-Users-angelodias-Documents-GIT-private-strudel-learning-wt-main/04b05484-f6a0-457f-8ca4-7ca8b3aa91c7/scratchpad/val/`
— `check.mjs` is the original; `mn_validate.mjs` and `time_validate.mjs` already parse MDX
exercises and simulate checks. **Copy one of those to your own filename** (don't modify the
originals; other agents are using them) and point it at your chapter. It must confirm:

- every `start`, `target`, `answer`, step `solution` and step `target` evaluates, and produces
  events (except an intentionally empty `start`);
- every step check passes on its solution and fails on the previous state;
- every challenge check passes on its target and fails on its start;
- ids are unique.

Iterate until clean, then run `pnpm build` in the project root.

There is also a browser harness, `await window.__exerciseQA()`, run by the integrator afterwards.
It proves the same properties against the real runtime.
