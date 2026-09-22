# Strudel, Properly

An interactive tutorial for [Strudel](https://strudel.cc/) — live-codeable music in the browser.

Seventeen chapters that go from "what is a cycle" to orbits, ducking and a finished patch, plus a
cheat sheet and a signal-chain reference. Every code block on the site is a real, editable,
playable Strudel REPL (the `@strudel/repl` web component), so you can change a number and hear the
difference immediately.

## Running it

```sh
pnpm install
pnpm dev
```

Then open http://localhost:4321.

```sh
pnpm build     # static site into dist/
pnpm preview   # serve the built site
```

## Layout

```
src/
  consts.ts              chapter list — drives the nav, the pager and the home page
  layouts/
    Base.astro           HTML shell, sidebar, loads @strudel/repl, wires the play buttons
    Chapter.astro        tutorial page wrapper (eyebrow, title, prev/next)
    Reference.astro      reference page wrapper
  components/
    Strudel.astro        one embedded, playable REPL
    Box.astro            callout — kind="note" | "try" | "warn"
    QA.astro             collapsible question
  pages/
    index.astro
    tutorial/*.mdx       the guided track
    reference/*.mdx      cheat sheet + signal chain
```

To add a chapter: create `src/pages/tutorial/<slug>.mdx` with `layout` and `slug` in its
frontmatter, then add an entry to `CHAPTERS` in `src/consts.ts`.

## Writing exercises

Chapters are built from exercises the learner types into, not finished examples to read. The
format was piloted on **Mini-Notation** and **Writing in Time**.

```mdx
import Exercise from '../../components/Exercise.astro';
import Step from '../../components/Step.astro';

<Exercise id="mini/subdivide" title="Split a slot"
  goal="Two hats in the space of one." start={`s("bd hh sd hh")`}
  target={`s("bd [hh hh] sd hh")`}>
  <Step check={{ includes: '[hh hh]', match: { keys: ['s'] } }}
        hints={['Square brackets squeeze a group into one slot.']}
        solution={`s("bd [hh hh] sd hh")`}>
    Replace the first `hh` with `[hh hh]`. Press ctrl+enter and listen.
  </Step>
</Exercise>
```

- An `<Exercise>` with no `<Step>` children is a **challenge**: it uses its own `check`, usually
  `{ match: ... }` against its `target`, with an empty `start`.
- The current step is checked automatically after every ctrl+enter. `src/exercise/types.ts` is the
  full `Check` reference (`includes`, `excludes`, `code`, `match`, `events`, `has`, `cycles`, `fn`).
- A `<Step>` may have its own `target`. `match` then compares against it, which beats writing an
  `fn` for intermediate steps.
- Every step needs a `solution`: the full editor contents once that step is done.
- Name functions and operators literally in the step text (`` `.lpf()` ``, `` `*4` ``). The learner
  types them; the vocabulary is the lesson.

### Rules the checks must follow

1. A step's check **passes** on its own `solution` and **fails** on the previous state (the prior
   step's `solution`, or `start`). Otherwise it completes itself on arrival.
2. It accepts every reasonable answer: check the musical result (`match`, `events`, `has`) and use
   `includes` only when the step is about typing that operator.
3. Strudel stores some controls under canonical names (`.lpf()` becomes `cutoff`). `has` and
   `match.keys` translate for you; `fn` sees the raw values.
4. `note(...).s(...)` takes its rhythm from the notes; `s(...).note(...)` takes it from `s`.

### QA

With `pnpm dev` running, open a chapter and run this in the browser console:

```js
await window.__exerciseQA()
```

It proves rule 1 for every step and challenge on the page, and reports any code that fails to
evaluate. It only exists in dev builds.

Learner progress is saved in `localStorage`: `strudel-tutorial:exercises` (code, step, done per
exercise) and `strudel-tutorial:progress` (completed chapters).

## Keyboard shortcuts inside a code box

| Key | Action |
| --- | --- |
| `ctrl+enter` | evaluate |
| `ctrl+.` | stop |
| `ctrl+/` | toggle comment |

Only one box plays at a time — the web component runs with `solo` enabled.

## Deploying

Pushing to `main` publishes to GitHub Pages via `.github/workflows/deploy.yml`.

The site lives under `https://<owner>.github.io/<repo>/`, so the build needs a
matching base path. The workflow sets it from the repo name:

```sh
BASE_PATH=/strudel-learning SITE_URL=https://angelod1as.github.io pnpm build
```

Internal links must stay base-aware, or they will 404 in production:

- in `.astro` files, wrap paths in `withBase()` from `src/consts.ts`
- in `.mdx` content, use `<L to="/tutorial/orbits">Orbits</L>` instead of a
  plain markdown link

(Astro 7 uses Sätteri for Markdown, whose pipeline does not take the rehype
plugin that would rewrite these automatically.)

To serve from a domain root instead, drop `BASE_PATH` — `withBase()` and `L`
both become no-ops.

## Notes

- The REPL bundle is loaded from unpkg at a pinned version (`@strudel/repl@1.3.0`) in
  `src/layouts/Base.astro`. Bump it there.
- Sounds are lazy-loaded, so the first trigger of a new sample can be silent while it downloads.
- Content is based on the official Strudel documentation and source
  ([codeberg.org/uzu/strudel](https://codeberg.org/uzu/strudel)). The official docs are the source
  of truth for the full function reference.
