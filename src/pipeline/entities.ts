/**
 * Entity extraction (spec §6.5). Generic and configurable: the patterns are
 * driven by an extension list, never by knowledge of any particular document.
 *
 * Rules that hold for every pattern:
 *   - code is never scanned (fenced blocks *and* inline spans)
 *   - link URLs are never scanned, only link labels
 *   - results are deduped per section
 */

import { collectProseRuns } from './mdast-text'
import type { Block, FileRef, TestRef } from './types'

export type EntityOptions = {
  /** Extensions that make a dotted token a file path. */
  fileExtensions?: readonly string[]
  /** Extra named patterns from `unfold.config.json`. */
  extraPatterns?: readonly { name: string; pattern: string }[]
  /** Glossary terms and aliases, matched word-bounded and case-insensitively. */
  glossary?: readonly { term: string; aliases: string[] }[]
}

export type ExtractedEntities = {
  files: FileRef[]
  tests: TestRef[]
  /** Glossary term/alias hits, as written in the text. */
  glossaryHits: { text: string; term: string; isAlias: boolean }[]
  /** Config-defined extra pattern hits. */
  customHits: { name: string; text: string }[]
}

/* Path shape: slash-joined segments, the last carrying a known extension.
 * Windows separators are normalised to `/` before matching. */
const PATH_CORE = '(?:[A-Za-z0-9_.@~-]+[\\\\/])*[A-Za-z0-9_.@~-]+'
/* A `::symbol` suffix, e.g. `src/app.ts::render`. */
const SYMBOL = '(?:::([A-Za-z_$][\\w$]*))?'
/* Left boundary: not preceded by a word character, `/`, `.` or `-`. */
const LEFT = '(?<![\\w./\\\\-])'
/* Right boundary: end of text or a delimiter that cannot extend a path. */
const RIGHT = '(?=$|[\\s,;:!?)"\'`\\]])'

/** An identifier that marks a test: `test_x`, `x.test`, `x.spec`, `TestX`. */
const TEST_ID = /^(?:test[_.-]|Test[A-Z])/

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function buildPathRegExp(extensions: readonly string[]): RegExp {
  const list = extensions
    .map((extension) => extension.replace(/^\.+/, ''))
    .filter((extension) => extension !== '')
    .map(escapeRegExp)
  // An empty extension list must not match every dotted token.
  if (list.length === 0) return /(?!)/u
  return new RegExp(`${LEFT}(${PATH_CORE}\\.(${list.join('|')}))(?!\\w)${SYMBOL}`, 'giu')
}

function buildGlossaryRegExp(
  glossary: readonly { term: string; aliases: string[] }[],
): { regexp: RegExp; lookup: Map<string, { term: string; isAlias: boolean }> } | undefined {
  const lookup = new Map<string, { term: string; isAlias: boolean }>()
  for (const entry of glossary) {
    for (const alias of entry.aliases) {
      if (alias.trim() !== '') lookup.set(alias.toLowerCase(), { term: entry.term, isAlias: true })
    }
    if (entry.term.trim() !== '') lookup.set(entry.term.toLowerCase(), { term: entry.term, isAlias: false })
  }
  if (lookup.size === 0) return undefined

  // Longest first, so "measurement run" wins over a hypothetical "run".
  const alternatives = Array.from(lookup.keys())
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')
  return {
    regexp: new RegExp(`${LEFT}(${alternatives})${RIGHT}`, 'giu'),
    lookup,
  }
}

/** Extract every entity from the prose runs of one section. */
export function extractEntities(
  proseRuns: readonly string[],
  options: EntityOptions = {},
): ExtractedEntities {
  const files = new Map<string, FileRef>()
  const tests = new Map<string, TestRef>()
  const glossaryHits: ExtractedEntities['glossaryHits'] = []
  const customHits: ExtractedEntities['customHits'] = []
  const seenGlossary = new Set<string>()
  const seenCustom = new Set<string>()

  const extensions = options.fileExtensions ?? []
  const pathRe = buildPathRegExp(extensions)
  const glossaryRe = buildGlossaryRegExp(options.glossary ?? [])

  const customRes = (options.extraPatterns ?? []).map(({ name, pattern }) => {
    try {
      return { name, regexp: new RegExp(pattern, 'giu') }
    } catch {
      return { name, regexp: /(?!)/u }
    }
  })

  for (const run of proseRuns) {
    // Links arrive as bare URLs or autolinks; strip them so `https://x/y.ts`
    // does not read as a local file path.
    const text = run.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/giu, ' ')

    pathRe.lastIndex = 0
    for (const match of text.matchAll(pathRe)) {
      const path = match[1] as string
      const symbol = match[3]
      const normalised = path.replace(/\\/gu, '/')
      const key = symbol === undefined ? normalised : `${normalised}::${symbol}`
      if (tests.has(key) || files.has(key)) continue

      if (symbol !== undefined && TEST_ID.test(symbol)) {
        tests.set(key, { id: key, path: normalised, testId: symbol })
        continue
      }
      files.set(key, symbol === undefined ? { path: normalised } : { path: normalised, symbol })
    }

    if (glossaryRe !== undefined) {
      glossaryRe.regexp.lastIndex = 0
      for (const match of text.matchAll(glossaryRe.regexp)) {
        const hit = match[1] as string
        const key = hit.toLowerCase()
        if (seenGlossary.has(key)) continue
        const resolved = glossaryRe.lookup.get(key)
        if (resolved === undefined) continue
        seenGlossary.add(key)
        glossaryHits.push({ text: hit, term: resolved.term, isAlias: resolved.isAlias })
      }
    }

    for (const { name, regexp } of customRes) {
      regexp.lastIndex = 0
      for (const match of text.matchAll(regexp)) {
        const hit = match[0]
        if (hit === '') continue
        const key = `${name}:${hit.toLowerCase()}`
        if (seenCustom.has(key)) continue
        seenCustom.add(key)
        customHits.push({ name, text: hit })
      }
    }
  }

  return { files: [...files.values()], tests: [...tests.values()], glossaryHits, customHits }
}

/** Text of a `Block`, in reading order, with all code excluded. */
function blockRuns(block: Block, runs: string[]): void {
  switch (block.kind) {
    case 'prose':
    case 'quote':
      collectProseRuns(block.node, runs)
      return
    case 'list':
      for (const item of block.items) collectProseRuns(item, runs)
      return
    case 'table':
      // Cells are their own little prose islands; a path in a cell counts.
      for (const cell of [...block.header, ...block.rows.flat()]) runs.push(cell)
      return
    case 'loop':
      for (const label of block.labels) runs.push(label)
      return
    case 'graph':
      for (const node of block.spec.nodes) runs.push(`${node.label} ${node.sub ?? ''}`.trim())
      return
    case 'steps':
      for (const step of block.spec) runs.push(`${step.title} ${step.description ?? ''}`.trim())
      return
    default:
      // code / terminal / mermaid / hr / html contribute nothing by design.
      return
  }
}

/** Prose runs for a set of blocks, with all code excluded. */
export function proseRunsOf(blocks: readonly Block[]): string[] {
  const runs: string[] = []
  for (const block of blocks) blockRuns(block, runs)
  return runs
}
