/**
 * Matched-substring highlighting (spec §7.4, M2.3).
 *
 * A real `<mark>`, so the highlight is announced as a highlight rather than as
 * a run of unexplained text, and styled from `--accent-wash` in the tokens —
 * never a literal colour.
 *
 * Matching is case-insensitive and every occurrence is marked, not just the
 * first: a result whose second word is the query is still a match, and marking
 * only the first would hide it.
 */

import { Fragment, type ReactNode } from 'react'

/** Split `text` into alternating plain and matched runs, case-insensitively. */
export function highlightRuns(text: string, query: string): { text: string; match: boolean }[] {
  const needle = query.trim().toLowerCase()
  if (needle === '' || text === '') return [{ text, match: false }]

  const haystack = text.toLowerCase()
  const runs: { text: string; match: boolean }[] = []
  let cursor = 0

  for (;;) {
    const at = haystack.indexOf(needle, cursor)
    if (at === -1) break
    if (at > cursor) runs.push({ text: text.slice(cursor, at), match: false })
    runs.push({ text: text.slice(at, at + needle.length), match: true })
    cursor = at + needle.length
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), match: false })
  // A query of only whitespace, or one longer than the text, still shows the text.
  return runs.length === 0 ? [{ text, match: false }] : runs
}

export function HighlightedText({ text, query }: { text: string; query: string }): ReactNode {
  return (
    <>
      {highlightRuns(text, query).map((run, index) =>
        run.match ? (
          <mark key={index} className="search-hit">
            {run.text}
          </mark>
        ) : (
          <Fragment key={index}>{run.text}</Fragment>
        ),
      )}
    </>
  )
}