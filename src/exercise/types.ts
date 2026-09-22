/**
 * Exercise API — the contract between chapter content (MDX), the Astro
 * components (Exercise.astro, Step.astro) and the client runtime
 * (src/scripts/exercise.ts).
 *
 * An exercise is one editor the learner types into, plus an ordered list of
 * steps. Each step names what to do, and a `check` decides when it is done.
 * Steps are revealed one at a time; the current step's check runs
 * automatically after every evaluation (ctrl+enter / play) and on [check].
 *
 * A step with no `check` is a "listen" step: it advances with a button.
 * An exercise with no steps uses its own `check` (a single "goal" task).
 */

/** A value constraint for `has`: exact match, or an inclusive [min, max] range. */
export type ValueRule = number | string | [number, number];

/**
 * Every field is optional; all present fields must pass (logical AND).
 * Prefer checks on the *musical result* (`match`, `events`, `has`) over checks
 * on the *spelling* (`includes`, `code`), unless the step is specifically about
 * using a given operator or function — then `includes` is the right tool.
 */
export interface Check {
  /** Code must contain every one of these substrings (plain text, not regex). */
  includes?: string | string[];
  /** Code must contain none of these substrings. */
  excludes?: string | string[];
  /** Regex source, tested against the code. Use sparingly. */
  code?: string;

  /**
   * The learner's events must equal the target's events over `cycles`.
   * Compared on onset time plus `keys` (default: every key present in the
   * target's event values, ignoring visual-only keys such as `color`).
   * Note names and MIDI numbers are normalised, so `note("c3")` === `note(48)`.
   * Onsets only: event durations are not compared.
   * Compares against the Step's own `target` when it has one, otherwise the
   * Exercise's `target`; one of the two is required.
   */
  match?: boolean | { keys?: string[] };

  /** Number of events with an onset, per `cycles`. Exact, or [min, max]. */
  events?: number | [number, number];

  /** Every event must have these keys, each equal to / within the given value. */
  has?: Record<string, ValueRule>;

  /** How many cycles to query for `match`, `events` and `has`. Default 1. */
  cycles?: number;

  /**
   * Escape hatch: JS source of `(haps, code) => true | string`, where a string
   * is the failure message. Evaluated as `new Function('return (' + fn + ')')()`.
   * `haps` are the onset events of `queryArc(0, cycles)` (events nudged into
   * the window from outside count), each `{ t: number, dur: number, value: object }`
   * with `t` = onset and `dur` = whole length, both raw floats in cycles
   * (e.g. 0.25). Sorted by `t`, then by `JSON.stringify(value)`.
   */
  fn?: string;

  /** Replaces the generated failure message(s). */
  message?: string;
}
