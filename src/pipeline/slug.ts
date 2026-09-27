/**
 * GitHub-parity slugs (spec §6.4). Documents are authored against GitHub's
 * anchor behaviour, so the app must match it exactly:
 *
 *   lowercase → drop everything GitHub drops → each space becomes `-`.
 *
 * GitHub's removal set is punctuation and symbols, but it *keeps* letters,
 * numbers, combining marks, spaces, hyphens and underscores. It does not
 * collapse runs of spaces: `a & b` becomes `a--b`, not `a-b`. It also does not
 * re-trim after removal, which is why a leading emoji leaves a leading hyphen
 * (`🚀 Launch` → `-launch`). The trim below happens *before* removal, matching
 * that ordering; markdown heading text is already trimmed by the parser, so the
 * two are indistinguishable for real documents.
 *
 * Duplicates get `-1`, `-2`, … in document order. A `Slugger` instance is
 * stateful: one document, one instance, so counters never leak between
 * documents.
 */

/** Everything GitHub keeps: letters, marks, numbers, spaces, `-`, `_`. */
const KEEP = /[^\p{L}\p{N}\p{M}\s_-]/gu


export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(KEEP, '')
    .replace(/\s/gu, '-')
}

export class Slugger {
  private readonly counts = new Map<string, number>()

  /** Slug a heading, applying the duplicate suffix for this document. */
  slug(text: string): string {
    const base = slugify(text)
    const seen = this.counts.get(base) ?? 0
    this.counts.set(base, seen + 1)
    return seen === 0 ? base : `${base}-${seen}`
  }

  /** Forget every counter. */
  reset(): void {
    this.counts.clear()
  }
}

/** Standalone helper for one-off slugs that need no duplicate tracking. */
export function uniqueSlugFactory(): (text: string) => string {
  const slugger = new Slugger()
  return (text: string) => slugger.slug(text)
}
