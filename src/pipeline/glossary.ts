/**
 * Glossary assembly (spec §6.6).
 *
 *   - Candidate headings, matched case-insensitively and exactly:
 *     `Glossary`, `Terms`, `Terminology`, `Definitions`, `Appendix: Terms`.
 *   - Entries are the H3 subsections of a candidate section. The definition is
 *     the entry's first paragraph.
 *   - Aliases come only from an explicit `Aliases:` / `Alias:` paragraph. They
 *     are never inferred, and two terms are never merged by similarity.
 */

import { ALIAS_LINE_PREFIXES, GLOSSARY_CANDIDATE_HEADINGS } from './constants'
import { toPlainTextLines } from './mdast-text'
import type { Block, GlossaryEntry, Section } from './types'

const CANDIDATES = new Set(GLOSSARY_CANDIDATE_HEADINGS.map((heading) => heading.toLowerCase()))

/** Is this heading a glossary candidate? Exact match, case-insensitive. */
export function isGlossaryCandidate(title: string): boolean {
  return CANDIDATES.has(title.trim().toLowerCase())
}

function normaliseTerm(term: string): string {
  return term.trim().replace(/\s+/gu, ' ').toLowerCase()
}

/** `Aliases: MR, measurement run` → `['MR', 'measurement run']`. */
export function parseAliasLine(text: string): string[] {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()
  const prefix = ALIAS_LINE_PREFIXES.find((candidate) => lower.startsWith(candidate))
  if (prefix === undefined) return []
  return trimmed
    .slice(prefix.length)
    .split(',')
    .map((alias) => alias.trim())
    .filter((alias) => alias !== '')
}

/**
 * A paragraph's text can carry an `Aliases:` line of its own (a soft line break
 * inside one paragraph is still one paragraph in mdast). So each *line* of the
 * paragraph is checked, not just the paragraph as a whole. The alias line never
 * becomes part of the definition.
 */
function definitionOf(blocks: readonly Block[]): { definition: string; aliases: string[] } {
  const aliases: string[] = []
  const definitionLines: string[] = []

  for (const block of blocks) {
    if (block.kind !== 'prose') continue
    // `toPlainText` collapses whitespace; keep the line structure instead.
    for (const line of toPlainTextLines(block.node)) {
      const found = parseAliasLine(line)
      if (found.length > 0) {
        for (const alias of found) if (!aliases.includes(alias)) aliases.push(alias)
        continue
      }
      definitionLines.push(line)
    }
  }

  return { definition: definitionLines.join(' ').replace(/\s+/gu, ' ').trim(), aliases }
}


/**
 * Merge the entries of every candidate section. Later candidates never
 * overwrite an earlier term: first definition wins, aliases accumulate.
 */
export function buildGlossary(sections: readonly Section[]): GlossaryEntry[] {
  const byTerm = new Map<string, GlossaryEntry>()

  for (const section of sections) {
    if (!isGlossaryCandidate(section.title)) continue

    for (const child of section.children) {
      const key = normaliseTerm(child.title)
      if (key === '') continue
      const { definition, aliases } = definitionOf(child.blocks)

      const existing = byTerm.get(key)
      if (existing === undefined) {
        byTerm.set(key, { term: child.title.trim(), aliases: [...aliases], definition })
        continue
      }
      for (const alias of aliases) {
        if (!existing.aliases.includes(alias)) existing.aliases.push(alias)
      }
      if (existing.definition === '' && definition !== '') existing.definition = definition
    }

    // A candidate section with no H3 children contributes nothing. Inventing
    // entries from loose paragraphs would be guessing, and guessing is what
    // the genericity contract forbids.
  }

  return [...byTerm.values()]
}
