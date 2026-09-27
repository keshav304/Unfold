/**
 * Derived indexes (spec §6.6):
 *   - search records for MiniSearch (title-boosted sections, body text, file
 *     paths, glossary terms + aliases)
 *   - backlinks: file path → slugs of the sections mentioning it
 *   - per-section plain text for ±45-char snippet windows
 *
 * Indexes are data, not behaviour: `createSearchIndex` compiles the records and
 * the app never has to know how they were produced.
 */

import MiniSearch from 'minisearch'
import { INTRO_SLUG, SNIPPET_WINDOW } from './constants'
import type { FileRef, SearchRecord, Section, TestRef } from './types'

/** Collect every section, depth-first, in document order. */
export function flattenSections(sections: readonly Section[]): Section[] {
  const out: Section[] = []
  const visit = (section: Section) => {
    out.push(section)
    for (const child of section.children) visit(child)
  }
  for (const section of sections) visit(section)
  return out
}

export function buildSearchRecords(input: {
  sections: readonly Section[]
  intro: readonly { text: string }[]
  /** Shown as the row title for an introduction hit; the doc title by default. */
  introTitle?: string
  filesBySection: ReadonlyMap<string, FileRef[]>
  testsBySection?: ReadonlyMap<string, TestRef[]>
  glossary: readonly { term: string; aliases: string[]; definition: string }[]
}): SearchRecord[] {
  const records: SearchRecord[] = []
  let id = 0

  const introText = input.intro.map((block) => block.text).filter((text) => text !== '').join('\n\n')

  for (const section of input.sections) {
    // Title record — boosted at query time via MiniSearch's `boost` field.
    records.push({
      id: String(id++),
      kind: 'section',
      title: section.title,
      slug: section.slug,
      text: section.title,
      keywords: [section.title],
    })

    records.push({
      id: String(id++),
      kind: 'body',
      title: section.title,
      slug: section.slug,
      text: section.text,
      keywords: [],
    })

    for (const file of input.filesBySection.get(section.slug) ?? []) {
      records.push({
        id: String(id++),
        kind: 'file',
        title: file.path,
        slug: section.slug,
        text: file.symbol === undefined ? file.path : `${file.path}::${file.symbol}`,
        keywords: file.symbol === undefined ? [] : [file.symbol],
      })
    }

    // A test id is a file reference too, and is searchable by its own name.
    for (const test of input.testsBySection?.get(section.slug) ?? []) {
      records.push({
        id: String(id++),
        kind: 'file',
        title: test.testId,
        slug: section.slug,
        text: test.id,
        keywords: [test.path, test.testId],
      })
    }
  }

  if (introText !== '') {
    // The introduction is real, findable content, so it gets a real slug
    // rather than the empty string it had when nothing could navigate to it.
    // A body hit on it scrolls to the top of the document.
    records.push({
      id: String(id++),
      kind: 'body',
      title: input.introTitle ?? '',
      slug: INTRO_SLUG,
      text: introText,
      keywords: [],
    })
  }

  for (const entry of input.glossary) {
    records.push({
      id: String(id++),
      kind: 'glossary',
      title: entry.term,
      slug: '',
      text: entry.definition,
      keywords: [entry.term, ...entry.aliases],
    })
  }

  return records
}

export function buildBacklinks(
  filesBySection: ReadonlyMap<string, FileRef[]>,
): Record<string, string[]> {
  const backlinks: Record<string, string[]> = {}
  for (const [slug, files] of filesBySection) {
    for (const file of files) {
      const key = file.path.toLowerCase()
      const bucket = backlinks[key] ?? []
      if (!bucket.includes(slug)) bucket.push(slug)
      backlinks[key] = bucket
    }
  }
  return backlinks
}

/** Compile the records into a MiniSearch index. */
export function createSearchIndex(records: readonly SearchRecord[]): MiniSearch<SearchRecord> {
  const miniSearch = new MiniSearch<SearchRecord>({
    fields: ['title', 'text', 'keywords'],
    storeFields: ['kind', 'title', 'slug', 'text', 'keywords'],
    // Section titles and file paths outrank a passing body mention (spec §6.6).
    searchOptions: { boost: { title: 4, keywords: 2, text: 1 }, prefix: true, fuzzy: 0.2 },
  })
  miniSearch.addAll([...records])
  return miniSearch
}

export type Snippet = {
  text: string
  /** Index of `text` within the section's plain text, for highlighting. */
  start: number
  end: number
}

/**
 * A ±SNIPPET_WINDOW-character window around the first case-insensitive match of
 * `query` in `text`. Returns a leading-anchored window when there is no match,
 * so a result is never blank.
 */
export function snippetAround(text: string, query: string, window: number = SNIPPET_WINDOW): Snippet {
  if (text === '') return { text: '', start: 0, end: 0 }

  const index = query.trim() === '' ? -1 : text.toLowerCase().indexOf(query.trim().toLowerCase())
  if (index === -1) {
    const end = Math.min(text.length, window)
    return { text: text.slice(0, end).trim(), start: 0, end }
  }

  const start = Math.max(0, index - window)
  const end = Math.min(text.length, index + query.length + window)
  return { text: text.slice(start, end), start, end }
}
