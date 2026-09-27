/**
 * M4.1 — reading modes (spec §7.8).
 *
 * This file tests **the heuristic**, which is a pure function over the parsed
 * fixtures, and prints the word counts §7.8 asks to be verified. The mode as
 * *state* — across the shell, the header, the palette and the reader — is in
 * `reading-mode-ui.test.tsx`, because that is a whole-app assertion and jsdom is
 * the only place it is cheap.
 *
 * "Verify the heuristic on fixtures, not a fixed ratio" is an instruction about
 * how to verify, and the honest reading of it is that the numbers are the
 * artefact: a reader who wants to know what executive mode does to *their*
 * document should be able to run this and read a table.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import type { Block, Doc, Section } from '../pipeline/types'
import { countWords, toPlainText } from '../pipeline/mdast-text'
import {
  coerceMode,
  filterBlocksForMode,
  sectionIsReduced,
  MODE_STORAGE_KEY,
  type ReadingMode,
} from '../app/modes/reading-mode'
import { FIXTURES, parseFixture, parseMarkdown, type FixtureName } from './fixtures'

/** The words one block contributes, using the pipeline's own text extraction. */
function wordsOf(block: Block): number {
  switch (block.kind) {
    case 'prose':
    case 'quote':
      return countWords(toPlainText(block.node))
    case 'table':
      return countWords(
        [...block.header, ...block.rows]
          .map((cell) => cell.map((run) => toPlainText(run)).join(' '))
          .join(' '),
      )
    case 'loop':
      return countWords(block.labels.join(' '))
    case 'html':
      return countWords(block.value)
    case 'list':
      return countWords(toPlainText(block.items))
    default:
      // Code, terminal and mermaid blocks count zero on purpose: they are shown
      // or hidden whole, and counting their tokens would make the reduction look
      // smaller than what a skimming reader actually stops reading.
      return 0
  }
}

/** The words one section shows in `mode`. */
function sectionWords(section: Section, mode: ReadingMode): number {
  return filterBlocksForMode(section.blocks, section.level, mode).reduce(
    (sum, block) => sum + wordsOf(block),
    0,
  )
}

function sectionsOf(doc: Doc): Section[] {
  const out: Section[] = []
  const visit = (list: readonly Section[]): void => {
    for (const section of list) {
      out.push(section)
      visit(section.children)
    }
  }
  visit(doc.sections)
  return out
}

/** Whole-document words in a mode. The introduction counts in both. */
function docWords(doc: Doc, mode: ReadingMode): number {
  const total = sectionsOf(doc).reduce((sum, section) => sum + sectionWords(section, mode), 0)
  return total + doc.intro.reduce((sum, block) => sum + wordsOf(block), 0)
}

/** Whole-document *blocks* shown in a mode, intro excluded (never reduced). */
function docBlocks(doc: Doc, mode: ReadingMode): number {
  return sectionsOf(doc).reduce(
    (sum, section) => sum + filterBlocksForMode(section.blocks, section.level, mode).length,
    0,
  )
}

describe('§7.8 reference mode is the identity', () => {
  it.each(FIXTURES)('%s renders every block of every section', (name) => {
    const { doc } = parseFixture(name)
    for (const section of sectionsOf(doc)) {
      expect(filterBlocksForMode(section.blocks, section.level, 'reference')).toEqual(section.blocks)
      expect(sectionIsReduced(section.blocks, section.level, 'reference')).toBe(false)
    }
  })
})

describe('§7.8 the executive heuristic, per fixture', () => {
  // Printed on every run, exactly like the §10 budget: a number a human reads is
  // worth more than a number only a failing run reveals.
  it('reports the word counts for kitchen-sink and crosslinked', () => {
    const rows: string[] = [
      '  fixture         sections  reducible  reference  executive   kept   blocks',
    ]

    for (const name of ['kitchen-sink', 'crosslinked'] as FixtureName[]) {
      const { doc } = parseFixture(name)
      const sections = sectionsOf(doc)
      // "Reducible" is a property of the *document*: does any section have more
      // than the blocks the rule keeps? It is the reason a fixture can report
      // 100% and still be correct, and printing it stops that reading as a bug.
      const reducible = sections.some((s) => sectionIsReduced(s.blocks, s.level, 'executive'))
      const reference = docWords(doc, 'reference')
      const executive = docWords(doc, 'executive')
      const kept = reference === 0 ? '—' : `${Math.round((executive / reference) * 100)}%`
      // Words alone understate the mode badly: a 200-line code block is one
      // block and a lot of words, but a reader in executive mode stops at its
      // title — it is *one* unit of reading, not two hundred. The block count is
      // the honest measure of what was taken away.
      const blocks = `${docBlocks(doc, 'reference')}→${docBlocks(doc, 'executive')}`
      rows.push(
        `  ${name.padEnd(15)} ${String(sections.length).padStart(8)}  ${String(reducible).padStart(9)}  ` +
          `${String(reference).padStart(9)}  ${String(executive).padStart(9)}  ${kept.padStart(5)}  ${blocks.padStart(9)}`,
      )

      // The one invariant that holds for every document: executive mode is a
      // filter, so it can never show *more* than reference mode.
      expect(executive, `${name} grew in executive mode`).toBeLessThanOrEqual(reference)
      // …and where the document has something to hide, it is hidden. Derived
      // from the document rather than from a magic number, because §7.8 says to
      // verify on fixtures and not against a fixed ratio.
      if (reducible) {
        expect(executive, `${name} has reducible sections but reduced nothing`).toBeLessThan(reference)
      }
    }
    process.stdout.write(`\n§7.8 executive-mode word counts\n${rows.join('\n')}\n\n`)
  })

  it('a section that is one paragraph long is not reduced — there is nothing to drop', () => {
    // `crosslinked` is exactly this shape, and it is why the report above shows
    // 100%: three H2s, one prose block each. Asserting the *reason* keeps the
    // number from being read as a broken heuristic, and keeps a future change
    // that starts hiding a section's only paragraph from passing silently.
    const { doc } = parseFixture('crosslinked')
    for (const section of doc.sections) {
      expect(sectionIsReduced(section.blocks, 2, 'executive'), section.slug).toBe(false)
    }
  })
})

describe('§7.8 the reduction itself', () => {
  it('an H2 keeps one lead paragraph, every table and every blockquote', () => {
    const { doc } = parseFixture('kitchen-sink')
    for (const section of doc.sections) {
      const kinds = filterBlocksForMode(section.blocks, 2, 'executive').map((block) => block.kind)
      expect(kinds.filter((kind) => kind === 'prose').length).toBeLessThanOrEqual(1)
      expect(kinds.filter((kind) => kind === 'table').length).toBe(
        section.blocks.filter((block) => block.kind === 'table').length,
      )
      expect(kinds.filter((kind) => kind === 'quote').length).toBe(
        section.blocks.filter((block) => block.kind === 'quote').length,
      )
      // §7.8's own denylist, asserted because the allowlist implies it.
      for (const hidden of ['code', 'terminal', 'mermaid', 'list'] as const) {
        expect(kinds).not.toContain(hidden)
      }
    }
  })

  it('a lead paragraph survives a section that opens with something else', () => {
    // The one case `blocks[0]` would have got wrong: §7.8 says "first prose
    // block", not "first block".
    const { doc } = parseMarkdown(
      ['## Ordering', '', '| a | b |', '| - | - |', '| 1 | 2 |', '', 'The lead.', '', 'More.'].join('\n'),
    )
    const section = doc.sections[0] as Section
    expect(section.blocks[0]?.kind).toBe('table')
    expect(filterBlocksForMode(section.blocks, 2, 'executive').map((b) => b.kind)).toEqual([
      'table',
      'prose',
    ])
  })

  it('an H3 keeps its first paragraph and nothing else', () => {
    const h3 = sectionsOf(parseFixture('kitchen-sink').doc).find((s) => s.level === 3)
    expect(h3).toBeDefined()
    expect(filterBlocksForMode((h3 as Section).blocks, 3, 'executive').map((b) => b.kind)).toEqual([
      'prose',
    ])
  })

  it('a section with nothing to keep still shows its title', () => {
    // The rule is a filter, not a gate: an H3 whose blocks are all code still
    // renders — as a heading with a "show all" under it, which is the only
    // honest thing to show for a section whose entire body is hidden.
    const { doc } = parseMarkdown(['## S', '', '### C', '', '```js', 'x', '```', ''].join('\n'))
    const child = (doc.sections[0] as Section).children[0] as Section
    expect(filterBlocksForMode(child.blocks, 3, 'executive')).toEqual([])
    expect(sectionIsReduced(child.blocks, 3, 'executive')).toBe(true)
  })
})

describe('§7.8 a document with no sections is unaffected by the mode', () => {
  it('no-structure has zero sections, so the mode has nothing to act on', () => {
    const { doc } = parseFixture('no-structure')
    expect(doc.sections).toEqual([])
    expect(doc.intro.length).toBeGreaterThan(1)
    // Equal because the introduction is never reduced. This is the assertion
    // that fails if someone "helpfully" applies the H2 rule to the intro too.
    expect(docWords(doc, 'executive')).toBe(docWords(doc, 'reference'))
  })

  it('and neither mode throws on it', () => {
    const { doc } = parseFixture('no-structure')
    expect(() => filterBlocksForMode(doc.intro, 2, 'executive')).not.toThrow()
    expect(() => sectionsOf(doc).map((s) => sectionIsReduced(s.blocks, s.level, 'executive'))).not.toThrow()
  })
})

describe('§7.8 the stored mode', () => {
  it('only "executive" means executive; anything else is reference', () => {
    expect(coerceMode('executive')).toBe('executive')
    expect(coerceMode('reference')).toBe('reference')
    // `localStorage` is user-writable, so a hand-edited or stale value must not
    // put the reader in a mode the UI cannot describe.
    expect(coerceMode('EXECUTIVE')).toBe('reference')
    expect(coerceMode(null)).toBe('reference')
    expect(coerceMode(42)).toBe('reference')
  })

  it('the key is namespaced, so it cannot collide with the host page', () => {
    expect(MODE_STORAGE_KEY).toBe('unfold:reading-mode')
  })
})

describe('§7.8 the transition is a transition, not a signature moment', () => {
  // Spec §8: three signature moments, everything else ≤250ms ease-out, every
  // duration from a `--motion-*` token so reduced motion can neutralise it. A
  // mode change is a change of density, not of structure, so it gets the token
  // and nothing more.
  const here = dirname(fileURLToPath(import.meta.url))
  const ast = postcss.parse(readFileSync(resolve(here, '../styles/reader.css'), 'utf8'), {
    from: 'reader.css',
  })
  const tokens = readFileSync(resolve(here, '../styles/tokens.css'), 'utf8')

  const declsFor = (selector: string, prop: string): string[] => {
    const found: string[] = []
    ast.walkRules((rule) => {
      if (rule.selector !== selector) return
      rule.walkDecls(prop, (decl) => {
        found.push(decl.value)
      })
    })
    return found
  }

  it('the reader animates the mode flip from --motion-slow, ease-out', () => {
    expect(declsFor(".reader[data-mode-flip='to-executive']", 'animation-name')).toEqual(['mode-flip-a'])
    expect(declsFor(".reader[data-mode-flip='to-reference']", 'animation-name')).toEqual(['mode-flip-b'])
    expect(declsFor('.reader[data-mode-flip]', 'animation-duration')).toEqual(['var(--motion-slow)'])
    expect(declsFor('.reader[data-mode-flip]', 'animation-timing-function')).toEqual(['var(--ease-out)'])
  })

  it('--motion-slow is the §8 ceiling of 250ms, and no duration is smuggled past it', () => {
    expect(tokens).toContain('--motion-slow: 250ms')
    expect(declsFor('.reader[data-mode-flip]', 'animation-duration').join(' ')).not.toMatch(/\d/)
  })

  it('it is instant under reduced motion, with no rule of its own', () => {
    // `tokens.css` zeroes every `--motion-*` inside the reduced-motion query and
    // forces `animation-duration: 0ms !important` on every element. The flip
    // reads its duration from that token, so it is instant for free — and a mode
    // switch is exactly the large reflow a motion-sensitive reader must not have
    // to sit through.
    expect(tokens).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*--motion-slow: 0ms/)
    expect(tokens).toMatch(/animation-duration: 0ms !important/)
  })
})
