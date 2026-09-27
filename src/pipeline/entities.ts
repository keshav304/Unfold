/**
 * Entity extraction (spec §6.5). Generic and configurable: the patterns are
 * driven by an extension list, never by knowledge of any particular document.
 *
 * Rules that hold for every pattern:
 *   - code is never scanned (fenced blocks *and* inline spans)
 *   - link URLs are never scanned, only link labels
 *   - results are deduped per section
 */

import { collectInlineRuns, collectProseRuns } from './mdast-text'
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

/* Path shape and boundaries are defined below, next to PATH_BODY. */
/* A `::symbol` suffix, e.g. `src/app.ts::render`. */
const SYMBOL = '(?:::(?<symbol>[A-Za-z_$][\\w$]*))?'
/* Left boundary: not preceded by a word character, `/`, `.` or `-`. */
const LEFT = '(?<![\\w./\\\\-])'
/* Glossary terms are matched word-bounded (spec §6.5), so their right boundary
 * is simply "not a word character" — which includes sentence punctuation, so a
 * term at the end of a line still matches. A path needs no right boundary:
 * its final segment already ends at the extension, and `(?!\\w)` forbids a
 * longer word from continuing it. */
const WORD_RIGHT = '(?=$|[^\\p{L}\\p{N}_])'

/**
 * A bare token with no `/` is only a file mention if its stem *looks like a
 * filename* rather than like a product name:
 *
 *   - all lowercase:            `readme.md`, `index.ts`
 *   - all uppercase:            `README.md`, `LICENSE`
 *   - lowercase then dotted:    `unfold.config.json`
 *
 * A single capitalised word is rejected, so `Node.js` is not a file chip. This
 * is a rule about case shape only — no product, language or document is named
 * anywhere in this module. It errs toward false negatives, because §1.1 wants
 * a missing chip far more than a fictional one.
 */
const BARE_STEM = [
  '[a-z0-9_@~-]+(?:\\.[a-z0-9_@~-]+)*', // all lowercase, optionally dotted
  '[A-Z0-9_@~-]+(?:\\.[A-Z0-9_@~-]+)*', // all uppercase, optionally dotted
  '[a-z0-9_@~-]+\\.[A-Za-z0-9_@~-]+', // lowercase head, then any suffix
].join('|')
/** A path with at least one separator: `src/app.ts`, `docs/spec.md`. */
const NESTED_PATH = '(?:[A-Za-z0-9_.@~-]+[\\\\/])+[A-Za-z0-9_.@~-]+'
const PATH_BODY = `(?:${NESTED_PATH}|${BARE_STEM})`

/**
 * What makes a `path::identifier` a test id (spec §6.5). Either the identifier
 * reads like a test (`test_x`, `TestX`) or the path itself does (`a.test.ts`,
 * `a.spec.ts`). A `::identifier` is required either way: a bare
 * `tests/a.test.ts` with no symbol is an ordinary file path.
 */
function isTestId(symbol: string, path: string): boolean {
  return /^(?:test[_.-]|Test[A-Z])/u.test(symbol) || /\.(?:test|spec)\./u.test(path)
}


function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * A regex that can never match. Must be global: `matchAll` rejects a
 * non-global pattern outright, so a "matches nothing" fallback has to be global.
 */
const MATCH_NOTHING = /(?!)/gu

/** `ts` → `(?:t|T)(?:s|S)`, so an extension matches either case without the `i` flag. */
function caseInsensitiveLiteral(value: string): string {
  return Array.from(value)
    .map((character) =>
      character.toLowerCase() === character.toUpperCase()
        ? character
        : `(?:${character.toLowerCase()}|${character.toUpperCase()})`,
    )
    .join('')
}

function buildPathRegExp(extensions: readonly string[]): RegExp {
  const list = extensions
    .map((extension) => extension.replace(/^\.+/, ''))
    .filter((extension) => extension !== '')
  // An empty extension list must not match every dotted token.
  if (list.length === 0) return MATCH_NOTHING
  const extensionAlt = list.map((ext) => caseInsensitiveLiteral(escapeRegExp(ext))).join('|')

  // Named groups: capture indices shift silently when the shape above changes.
  //
  // Deliberately NOT case-insensitive: the bare-stem alternatives encode a
  // case-shape rule (`Node.js` is a product, `node.js` is a file), and the `i`
  // flag would collapse exactly that distinction. The extension list is
  // case-expanded instead, so `README.MD` still matches.
  return new RegExp(
    `${LEFT}(?<path>${PATH_BODY}\\.(?:${extensionAlt}))(?!\\w)${SYMBOL}`,
    'gu',
  )
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
    regexp: new RegExp(`${LEFT}(${alternatives})${WORD_RIGHT}`, 'giu'),
    lookup,
  }
}

/** Text a section is scanned from, split by which entity families may read it. */
export type EntityRuns =
  /** Plain prose: no fenced code, no inline code. */
  | readonly string[]
  | {
      /** Glossary terms, aliases and custom config patterns read this. */
      readonly prose: readonly string[]
      /** The file family also reads this (A2 / spec §6.5). */
      readonly inline: readonly string[]
    }

function splitRuns(runs: EntityRuns): { prose: readonly string[]; inline: readonly string[] } {
  if (Array.isArray(runs)) return { prose: runs, inline: [] }
  const record = runs as { prose?: readonly string[]; inline?: readonly string[] }
  return { prose: record.prose ?? [], inline: record.inline ?? [] }
}

/** Extract every entity from one section. Never throws. */
export function extractEntities(runs: EntityRuns, options: EntityOptions = {}): ExtractedEntities {
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
      return { name, regexp: MATCH_NOTHING }
    }
  })

  const { prose, inline } = splitRuns(runs)

  // 1. The file family reads prose *and* inline code (A2 / spec §6.5).
  for (const run of [...prose, ...inline]) {
    // Links arrive as bare URLs or autolinks; strip them so `https://x/y.ts`
    // does not read as a local file path.
    const text = run.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/giu, ' ')

    pathRe.lastIndex = 0
    for (const match of text.matchAll(pathRe)) {
      const path = match.groups?.['path'] as string
      const symbol = match.groups?.['symbol']
      const normalised = path.replace(/\\/gu, '/')
      const key = symbol === undefined ? normalised : `${normalised}::${symbol}`
      if (tests.has(key) || files.has(key)) continue

      if (symbol !== undefined && isTestId(symbol, normalised)) {
        tests.set(key, { id: key, path: normalised, testId: symbol })
        continue
      }

      files.set(key, symbol === undefined ? { path: normalised } : { path: normalised, symbol })
    }
  }

  // 2. Glossary terms, aliases and custom config patterns read prose only.
  for (const run of prose) {
    const text = run

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

/** Text of a `Block`, split by which entity families may read it (spec §6.5). */
function blockRuns(block: Block, out: { prose: string[]; inline: string[] }): void {
  const nodes: unknown[] = []
  switch (block.kind) {
    case 'prose':
    case 'quote':
      nodes.push(block.node)
      break
    case 'list':
      nodes.push(...block.items)
      break
    case 'table':
      // Cells are their own little prose islands; a path in a cell counts.
      // A backticked path inside a cell is still an inline span.
      for (const cell of [...block.header, ...block.rows.flat()]) {
        out.prose.push(cell)
        out.inline.push(cell)
      }
      return
    case 'loop':
      out.prose.push(...block.labels)
      return
    case 'graph':
      out.prose.push(...block.spec.nodes.map((node) => `${node.label} ${node.sub ?? ''}`.trim()))
      return
    case 'steps':
      out.prose.push(...block.spec.map((step) => `${step.title} ${step.description ?? ''}`.trim()))
      return
    default:
      // code / terminal / mermaid / hr / html contribute nothing by design.
      return
  }
  for (const node of nodes) {
    collectProseRuns(node, out.prose)
    collectInlineRuns(node, out.inline)
  }
}

/**
 * Text runs for a set of blocks. Prose excludes all code; `inline` holds only
 * backticked spans, which the file family may read (spec §6.5, amendment A2).
 */
export function proseRunsOf(blocks: readonly Block[]): { prose: string[]; inline: string[] } {
  const out = { prose: [] as string[], inline: [] as string[] }
  for (const block of blocks) blockRuns(block, out)
  return out
}

