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

## Keyboard shortcuts inside a code box

| Key | Action |
| --- | --- |
| `ctrl+enter` | evaluate |
| `ctrl+.` | stop |
| `ctrl+/` | toggle comment |

Only one box plays at a time — the web component runs with `solo` enabled.

## Notes

- The REPL bundle is loaded from unpkg at a pinned version (`@strudel/repl@1.3.0`) in
  `src/layouts/Base.astro`. Bump it there.
- Sounds are lazy-loaded, so the first trigger of a new sample can be silent while it downloads.
- Content is based on the official Strudel documentation and source
  ([codeberg.org/uzu/strudel](https://codeberg.org/uzu/strudel)). The official docs are the source
  of truth for the full function reference.
