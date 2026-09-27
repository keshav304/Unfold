import { useCallback, useEffect, useMemo, useState } from 'react'
import { readStoredMode, writeStoredMode, type ReadingMode } from './reading-mode'

export type UseReadingMode = {
  mode: ReadingMode
  setMode: (mode: ReadingMode) => void
  toggle: () => void
  /** §7.8's per-section "show all" override: slugs the reader has expanded. */
  expanded: ReadonlySet<string>
  isExpanded: (slug: string) => boolean
  toggleSection: (slug: string) => void
}

/**
 * The reading mode, persisted (§7.8), plus the per-section override.
 *
 * **The initial value is read from storage inside a `useState` initialiser, not
 * in an effect.** An effect would render the document in reference mode first
 * and then re-render it in whatever the reader last chose — a full second parse
 * of the section tree and, worse, a visible flash of the long version of a
 * document the reader deliberately shortened. §7.8 says the mode *persists*,
 * and persisting means the first paint is already in the right mode.
 *
 * The overrides are deliberately **not** persisted. "Show all" is a decision
 * about one section in one sitting; carrying a page of expansions into the next
 * visit would make executive mode progressively less executive, and there is no
 * way for a returning reader to tell which sections were theirs.
 */
export function useReadingMode(): UseReadingMode {
  const [mode, setModeState] = useState<ReadingMode>(readStoredMode)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>())

  // Every write goes through here, so persistence cannot be forgotten at a call
  // site — the mode has three triggers (header, palette, and the initial
  // restore) and only one of them is a "set the mode" button.
  const setMode = useCallback((next: ReadingMode) => {
    setModeState(next)
    writeStoredMode(next)
  }, [])

  // Leaving executive mode clears the overrides: they are indices into a
  // reduced document, and in reference mode every section is already showing
  // everything, so an override is a control that reveals nothing (A4).
  useEffect(() => {
    if (mode === 'reference') setExpanded(new Set<string>())
  }, [mode])

  const toggle = useCallback(() => {
    setMode(mode === 'executive' ? 'reference' : 'executive')
  }, [mode, setMode])

  const toggleSection = useCallback((slug: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(slug)) next.add(slug)
      return next
    })
  }, [])

  const isExpanded = useCallback((slug: string) => expanded.has(slug), [expanded])

  return useMemo(
    () => ({ mode, setMode, toggle, expanded, isExpanded, toggleSection }),
    [mode, setMode, toggle, expanded, isExpanded, toggleSection],
  )
}
