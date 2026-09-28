/**
 * Delight (spec §7.10). Confetti at reading milestones, an end-of-document
 * celebration, and the Konami code. Behind one flag, in one file.
 *
 * ## The four rules this file exists to hold
 *
 * 1. **The flag is checked before anything else.** `features.delight: false`
 *    must mean the confetti chunk is *never requested*, not merely that nothing
 *    is drawn. So the guard is the first statement in every entry point and the
 *    dynamic `import()` is inside the branch, unreachable when the flag is off.
 * 2. **The library is a dynamic import.** A static one would put confetti in
 *    the entry chunk, and §10's budget would be met by a bundle nobody ships —
 *    the same mistake `budget.test.ts` already documents for `NODE_ENV`.
 * 3. **Reduced motion suppresses all of it.** §8: "confetti/particles never
 *    load". Not *never fire* — never *load*. The check is before the import.
 * 4. **No document strings.** The Konami code is a key sequence, not content,
 *    and every trigger is derived from the reader's own progress.
 */

import { prefersReducedMotion } from '../navigate'

/**
 * The milestone fractions of the document at which confetti fires (§7.10).
 *
 * 25/50/75 rather than 10/20/30/…: a milestone has to feel like an event, and
 * the app's own reading-time estimate assumes ~220 words a minute, so a quarter
 * of a long document is minutes of reading, not seconds. They are also
 * monotonic and non-overlapping, which is what makes "fire once" checkable.
 */
export const MILESTONES = [0.25, 0.5, 0.75] as const

/** Progress at or above which the document is considered finished. */
export const END_AT = 0.98

/** The Konami sequence, as key codes (`KeyboardEvent.key`). */
export const KONAMI = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a',
] as const

export type Delight = {
  /** Milestone fractions already celebrated, so "fire once" is a fact. */
  fired: Set<number>
  /** Call with the document scroll progress, 0–1. */
  progress: (fraction: number) => void
  /** Call with every key the reader presses. */
  key: (key: string) => void
  /** Forget every milestone. Called when the mode or the document changes. */
  reset: () => void
  /** How many times confetti has actually been requested, for tests. */
  count: () => number
}

/** Is delight on at all? The one flag, read once per call. */
function enabled(on: boolean): boolean {
  return on && !prefersReducedMotion()
}

/**
 * Load confetti, once, on demand.
 *
 * The `import()` is the lazy chunk, and its *absence from the entry* is what
 * `budget.test.ts` asserts in the built output. Every caller goes through here
 * so there is one place where "never under reduced motion" can be read.
 */
type Confetti = (options: import('canvas-confetti').Options) => Promise<undefined> | null

let pending: Promise<Confetti> | null = null
function load(): Promise<Confetti> {
  pending ??= import('canvas-confetti').then((module) => {
    // The package is CJS with a `module` build, and `@types` declares it as
    // `export =`, so the namespace is the function on one path and a
    // `{ default }` wrapper on the other depending on which one the bundler
    // picked. One line, and it is the kind of interop that is cheaper to write
    // than to debug from a "confetti is not a function" at 3am.
    const candidate = module as unknown as { default?: Confetti }
    return (candidate.default ?? (module as unknown as Confetti)) as Confetti
  })
  return pending
}

/**
 * The palette, read from the app's own tokens.
 *
 * `canvas-confetti` needs literal colour *strings* — it hands them to a 2D
 * context and never touches the DOM they came from — so the values have to be
 * read out of the cascade at the moment they are needed rather than written
 * here. A hex literal in this file would be exactly what
 * `genericity.test.ts` refuses, and it would be a second place to change when
 * the accent changes; the first draft of this file had three, and the guard
 * caught them.
 *
 * The read happens once per burst, not once per module, so a theme that
 * changed at runtime would be honoured, and the `trim()` is load-bearing:
 * `getPropertyValue` on a custom property returns the token text with its
 * leading whitespace, and the library would parse a padded value as not a
 * colour at all — a failure that looks like "the confetti is invisible" and
 * nothing else.
 */
function tokenColours(): string[] {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return []
  const style = getComputedStyle(document.documentElement)
  return ['--primary', '--secondary', '--tertiary']
    .map((token) => style.getPropertyValue(token).trim())
    .filter((value) => value !== '')
}

export function createDelight(on: boolean): Delight {
  const fired = new Set<number>()
  // The Konami match is a separate cursor, not another member of `fired`:
  // `fired` means "this milestone has been celebrated" and a caller can read it
  // to know how far the reader got. Overloading it for a key sequence would
  // make that number mean two things at once.
  let konamiAt = 0
  let celebrations = 0

  const burst = async (intensity: number): Promise<void> => {
    celebrations += 1
    const confetti = await load()
    confetti({
      particleCount: Math.round(40 * intensity),
      spread: 70,
      origin: { y: 0.6 },
      // `[]` is honest: an environment with no cascade has no tokens to read, and
      // canvas-confetti falls back to its own default palette rather than being
      // handed an empty one.
      colors: tokenColours(),
      // `disableForReducedMotion` is a *second* line of defence, not the first:
      // the guard above means we never get here under reduced motion, and a
      // reader who turns the preference on mid-session should not get a burst
      // from a progress tick queued a moment earlier.
      disableForReducedMotion: true,
    })
  }

  return {
    fired,
    progress(fraction: number): void {
      if (!enabled(on)) return
      if (fraction >= END_AT) {
        // The end celebration, keyed on 1 rather than on `END_AT` so a document
        // scrolled to 98% and one scrolled to 100% are the same event.
        if (fired.has(1)) return
        fired.add(1)
        void burst(2.5)
        return
      }
      for (const milestone of MILESTONES) {
        if (fraction < milestone || fired.has(milestone)) continue
        fired.add(milestone)
        void burst(1)
      }
    },
    key(key: string): void {
      if (!enabled(on)) return
      // Position-matched, and a wrong key restarts from zero rather than
      // sliding a window: the sequence is a deliberate gesture, and a
      // forgiving matcher would fire on a reader who half-remembers it.
      const expected = KONAMI[konamiAt]
      if (key !== expected) {
        konamiAt = 0
        return
      }
      konamiAt += 1
      if (konamiAt < KONAMI.length) return
      konamiAt = 0
      void burst(3)
    },
    reset(): void {
      fired.clear()
      konamiAt = 0
    },
    count(): number {
      return celebrations
    },
  }
}
