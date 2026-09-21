export type Chapter = {
  slug: string;
  title: string;
  blurb: string;
  part: string;
};

/** The guided track, in order. `slug` maps to /tutorial/<slug>. */
export const CHAPTERS: Chapter[] = [
  {
    part: 'Foundations',
    slug: 'getting-started',
    title: 'Getting Started',
    blurb: 'The REPL, evaluating code, stacking patterns with $:.',
  },
  {
    part: 'Foundations',
    slug: 'sounds',
    title: 'Picking Sounds',
    blurb: 's, n, bank, drum machines, synth waveforms.',
  },
  {
    part: 'Foundations',
    slug: 'mini-notation',
    title: 'Mini-Notation',
    blurb: 'The rhythm language: [] <> * / @ ! ~ ? | (3,8) {}%.',
  },
  {
    part: 'Foundations',
    slug: 'tempo',
    title: 'Tempo & Cycles',
    blurb: 'cps, cpm, bars, time signatures, metric modulation.',
  },
  {
    part: 'Foundations',
    slug: 'notes',
    title: 'Notes, Scales & Chords',
    blurb: 'note, n + scale, chord + voicing, transpose, arp.',
  },
  {
    part: 'Shaping Sound',
    slug: 'envelopes',
    title: 'Envelopes',
    blurb: 'ADSR, clip, pitch envelopes — how a sound starts and ends.',
  },
  {
    part: 'Shaping Sound',
    slug: 'filters',
    title: 'Filters',
    blurb: 'lpf, hpf, bpf, resonance, filter envelopes, djf, vowel.',
  },
  {
    part: 'Shaping Sound',
    slug: 'signals',
    title: 'Signals',
    blurb: 'sine, saw, perlin, rand — pattern-level modulation.',
  },
  {
    part: 'Shaping Sound',
    slug: 'lfo',
    title: 'LFOs & Modulators',
    blurb: 'Audio-rate modulation with lfo() and env().',
  },
  {
    part: 'Shaping Sound',
    slug: 'synths',
    title: 'Synths',
    blurb: 'Waveforms, FM, vibrato, supersaw, wavetables, ZZFX.',
  },
  {
    part: 'Shaping Sound',
    slug: 'samples',
    title: 'Samples',
    blurb: 'Loading, chopping, slicing, stretching, time-stretching.',
  },
  {
    part: 'Patterning',
    slug: 'pattern-functions',
    title: 'Pattern Functions',
    blurb: 'rev, jux, off, ply, every, sometimes, struct, and friends.',
  },
  {
    part: 'The Mix',
    slug: 'space',
    title: 'Delay & Reverb',
    blurb: 'The two global send effects, and their parameters.',
  },
  {
    part: 'The Mix',
    slug: 'orbits',
    title: 'Orbits',
    blurb: 'Strudel’s bus system — the key to a clean mix.',
  },
  {
    part: 'The Mix',
    slug: 'ducking',
    title: 'Ducking (Sidechain)',
    blurb: 'duckorbit, duckattack, duckonset, duckdepth.',
  },
  {
    part: 'The Mix',
    slug: 'dynamics',
    title: 'Dynamics & Distortion',
    blurb: 'gain, postgain, compressor, distort, crush, tremolo, phaser.',
  },
  {
    part: 'Performing',
    slug: 'performing',
    title: 'Putting It Together',
    blurb: 'Arranging, visual feedback, and building a track live.',
  },
];

export const REFERENCE = [
  { slug: 'cheatsheet', title: 'Cheat Sheet', blurb: 'Everything on one page.' },
  { slug: 'signal-chain', title: 'Signal Chain', blurb: 'The exact order effects are applied.' },
];

export const SITE_TITLE = 'Strudel, Properly';

/**
 * Prefix a root-relative path with the configured base, so links keep working
 * when the site is served from a subdirectory (e.g. GitHub Pages project sites).
 * Links written inside MDX content are handled by a rehype plugin instead.
 */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path}` || '/';
}
