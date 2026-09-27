/**
 * The search index the palette queries (spec §6.6).
 *
 * The index is compiled once per document inside a `useMemo`, because the
 * palette is the one interaction that has to feel instant: a keystroke may
 * never trigger a rebuild. `createSearchIndex` is pure and was written in M0
 * for exactly this.
 */

import { useMemo } from 'react'
import { createSearchIndex, snippetAround, type Snippet } from '../../pipeline/indexes'
import { SNIPPET_WINDOW } from '../../pipeline/constants'
import type { Doc, SearchRecord, Section } from '../../pipeline/types'
import type { ViewName } from '../routing'
import type { ReadingMode } from '../modes/reading-mode'

/** One palette result, already resolved to something navigable. */
export type SearchHit = {
  /** Stable key for React, and for cmdk's value-based selection. */
  id: string
  /** Which group renders it. A group appears only when its data exists. */
  group: 'section' | 'file' | 'glossary'
  /** The line the palette shows. */
  title: string
  /** Second line: the ±45-char window, or nothing. */
  snippet: Snippet | null
  /**
   * Where a click goes.
   *
   * A glossary hit carries the slug of the term's own heading, so an alias hit
   * lands on the parent term rather than nowhere: aliases are search keys for
   * their term, not places in their own right (§6.6).
   */
  target: { kind: 'section' | 'file' | 'glossary'; slug: string }
}

export type SearchIndex = {
  /** Run a query. Returns at most `limit` hits, best first. */
  search: (query: string, limit?: number) => SearchHit[]
  /** Every section title, for the empty-query state. */
  sections: { title: string; slug: string }[]
}

const NO_RESULTS: SearchHit[] = []

function sectionTitles(sections: readonly Section[]): { title: string; slug: string }[] {
  const out: { title: string; slug: string }[] = []
  const visit = (list: readonly Section[]): void => {
    for (const section of list) {
      out.push({ title: section.title, slug: section.slug })
      visit(section.children)
    }
  }
  visit(sections)
  return out
}

/** The ±45-char window for a hit, when the hit points at a section. */
function snippetFor(
  record: SearchRecord,
  query: string,
  sectionText: Doc['indexes']['sectionText'],
): Snippet | null {
  if (record.kind !== 'body') return null
  const text = sectionText[record.slug]
  // The introduction's body record has no slug and therefore no section text;
  // a row with no second line is honest, a fabricated one is not.
  if (text === undefined || text === '') return null
  return snippetAround(text, query, SNIPPET_WINDOW)
}

/**
 * Term heading slugs, so an alias hit can land on its parent term.
 *
 * A glossary entry is an H3 under a candidate section (§6.6), so the term has a
 * real anchor in the document. An entry whose heading is missing is simply not
 * reachable, and its hit is dropped rather than pointed at a neighbour.
 */
function glossarySlugs(doc: Doc): Map<string, string> {
  const out = new Map<string, string>()
  for (const section of doc.sections) {
    for (const child of section.children) {
      out.set(child.title.trim().toLowerCase(), child.slug)
    }
  }
  return out
}

/**
 * The group a stored record belongs in, or null when it is not a palette row.
 *
 * A `body` record is a *hit*, not a place: §6.6 keeps one per section so that
 * prose is findable at all. It therefore belongs to the section group and
 * collapses onto the section's own row — see the dedupe in `search`.
 */
function groupOf(record: SearchRecord): SearchHit['group'] | null {
  if (record.kind === 'section' || record.kind === 'body') return 'section'
  if (record.kind === 'file') return 'file'
  if (record.kind === 'glossary') return 'glossary'
  return null
}

/** Compile the document's search records once, and query them. */
export function useSearchIndex(doc: Doc): SearchIndex {
  return useMemo(() => {
    const sections = sectionTitles(doc.sections)
    const terms = glossarySlugs(doc)
    const miniSearch = createSearchIndex(doc.indexes.records)

    const search = (query: string, limit = 12): SearchHit[] => {
      const trimmed = query.trim()

      // An empty query lists sections. This is the group that is always
      // available, so a document with sections is never empty (§7.4).
      if (trimmed === '') {
        if (sections.length > 0) {
          return sections.slice(0, limit).map((section) => ({
            id: `section:${section.slug}`,
            group: 'section' as const,
            title: section.title,
            snippet: null,
            target: { kind: 'section' as const, slug: section.slug },
          }))
        }
        // A document with no H2s at all has nothing to jump to. An empty list
        // with the empty state beside it is honest; inventing a row for the
        // document's own title would be a target that goes nowhere (§1.1).
        return NO_RESULTS
      }

      // Title boost lives on the index (spec §6.6). MiniSearch has already
      // applied it, so the order below must not second-guess it.
      const hits: SearchHit[] = []
      for (const result of miniSearch.search(trimmed)) {
        const record = result as unknown as SearchRecord
        const group = groupOf(record)
        if (group === null) continue

        if (group === 'glossary') {
          // A glossary record carries no slug of its own — a term is an H3, and
          // the H3's slug is what an alias hit must land on (§6.6).
          const slug = terms.get(record.title.trim().toLowerCase())
          if (slug === undefined) continue
          if (hits.some((hit) => hit.id === slug)) continue
          hits.push({ id: slug, group, title: record.title, snippet: null, target: { kind: 'glossary', slug } })
        } else {
          // A record with no slug is not a place. The pipeline gives the
          // introduction `intro`, so this only catches a record that genuinely
          // has nowhere to go.
          if (record.slug === '') continue
          // One row per place. A section's title record and its body record are
          // the same place, so whichever MiniSearch ranked first wins — and
          // when that is the body record, the row carries the snippet.
          if (hits.some((hit) => hit.id === `${group}:${record.slug}`)) continue
          hits.push({
            id: `${group}:${record.slug}`,
            group,
            title: record.title === '' ? record.slug : record.title,
            snippet: snippetFor(record, trimmed, doc.indexes.sectionText),
            target: { kind: group, slug: record.slug },
          })
        }
        if (hits.length >= limit) break
      }
      return hits.length === 0 ? NO_RESULTS : hits
    }

    return { search, sections }
  }, [doc])
}

/**
 * Which palette groups this document can show (§7.4). A group with no data is
 * not rendered at all — the genericity contract, applied to the palette.
 */
export function paletteGroups(doc: Doc): SearchHit['group'][] {
  const groups: SearchHit['group'][] = ['section']
  if (doc.capabilities.entities && doc.indexes.filePaths.length > 0) groups.push('file')
  if (doc.capabilities.glossary) groups.push('glossary')
  return groups
}

/** The display label for a group heading. */
export const GROUP_LABEL: Record<SearchHit['group'], string> = {
  section: 'Sections',
  file: 'Files',
  glossary: 'Glossary',
}

/** Group order: document structure first, then the reference material. */
export const GROUP_ORDER: SearchHit['group'][] = ['section', 'file', 'glossary']

/* ------------------------------------------------------------------ *
 * §7.4 static actions — the palette's switch-view and reading-mode rows
 * ------------------------------------------------------------------ */

/** One static row. These are not search hits: they are commands. */
export type PaletteAction = {
  /** Stable key for React, and the `data-action` value the tests read. */
  id: string
  label: string
  /**
   * What the row does. A `view` row is capability-gated above; a `mode` row is
   * not, because the reading mode is Tier 0 — §7.8 gives it to every document,
   * including one with no sections at all.
   */
  kind: 'view' | 'mode'
  /** The view this row opens, for a `view` row. Never the one already open. */
  view?: ViewName
  /** The mode this row switches to, for a `mode` row. Never the current one. */
  mode?: ReadingMode
  /** The heading the rows sit under. */
  group: 'Views' | 'Reading mode'
}

const ACTION_LABEL: Record<ViewName, string> = {
  reader: 'Open the reader',
  graph: 'Open the visual graph',
  stepper: 'Open the stepper',
}

const VIEW_ORDER: ViewName[] = ['reader', 'graph', 'stepper']

/**
 * The switch-view rows a document can honestly offer (spec §7.4).
 *
 * Capability-gated with the same `capabilities` the router and the header
 * switcher use. A view the document cannot render is absent rather than
 * disabled: `resolveRoute` would turn the click into the reader, so a row for it
 * would promise a view and deliver a different one — which is the dead UI the
 * M2 review named, not a control.
 *
 * `current` is excluded here rather than at the call site so the rule lives in
 * one place: a palette listing the view you are already in has nothing to switch
 * to.
 */
export function paletteActions(doc: Doc, current: ViewName): PaletteAction[] {
  const capable: ViewName[] = ['reader']
  if (doc.capabilities.graph) capable.push('graph')
  if (doc.capabilities.stepper) capable.push('stepper')

  return VIEW_ORDER.filter((view) => capable.includes(view) && view !== current).map((view) => ({
    id: `view:${view}`,
    label: ACTION_LABEL[view],
    kind: 'view' as const,
    view,
    group: 'Views' as const,
  }))
}

/**
 * The reading-mode row (§7.4: "static actions: … toggle reading mode").
 *
 * M2 shipped the palette with no static rows at all, on the A4 rule that a row
 * for a view that does not exist is a control that does nothing. M4.1 is the
 * milestone that builds the mode, so that is where the rule stops applying.
 *
 * It offers the mode the reader is *not* in, for the same reason the view rows
 * omit the current view: a "Switch to executive mode" row sitting in the palette
 * while executive mode is already on is a row that does nothing. Unlike the view
 * rows this one is not capability-gated — the reading mode is not a view, and
 * §7.8 gives it to every document including one with no sections.
 */
export function paletteModeAction(current: ReadingMode): PaletteAction[] {
  const next: ReadingMode = current === 'executive' ? 'reference' : 'executive'
  return [
    {
      id: `mode:${next}`,
      label: next === 'executive' ? 'Switch to executive mode' : 'Switch to reference mode',
      kind: 'mode' as const,
      mode: next,
      group: 'Reading mode' as const,
    },
  ]
}

/** The order the action groups sit in: where you can go, then how you read. */
export const ACTION_GROUP_ORDER: PaletteAction['group'][] = ['Views', 'Reading mode']