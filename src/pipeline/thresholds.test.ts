/**
 * §11.4 — derivation threshold boundaries. This is the test the review is
 * looking for: 2 links → off, 3 links + 3 sections → on, explicit always wins.
 * If someone hardcodes a document instead of reading thresholds, this goes red.
 */

import { describe, expect, it } from 'vitest'
import { DERIVED_GRAPH_MIN_LINKS, DERIVED_GRAPH_MIN_SECTIONS } from './constants'
import { deriveGraph, type CrossLink } from './derive-graph'
import { parseFixture, parseMarkdown } from '../test/fixtures'

/** A document with `count` H2 sections chained by internal links. */
function chain(count: number): string {
  const lines = ['# Chain', '']
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count
    lines.push(`## Section ${i}`, '', `See [next](#section-${next}).`, '')
  }
  return lines.join('\n')
}

const EXPLICIT = ['```graph', 'nodes:', '  one: One', '  two: Two', 'edges:', '  one -> two', '```'].join('\n')

const NO_GRAPH_BLOCK = (sections: readonly string[]): string =>
  ['# Doc', '', ...sections.flatMap((body) => [body, ''])].join('\n')

describe('threshold constants live in one place (§6.7)', () => {
  it('both are 3', () => {
    expect(DERIVED_GRAPH_MIN_LINKS).toBe(3)
    expect(DERIVED_GRAPH_MIN_SECTIONS).toBe(3)
  })
})

describe('§11.4 boundary: link count', () => {
  it('2 links across 4 sections → graph OFF', () => {
    const source = NO_GRAPH_BLOCK([
      '## A',
      'See [B](#b).',
      '## B',
      'See [C](#c).',
      '## C',
      'No link here.',
      '## D',
      'No link here either.',
    ])
    const { doc } = parseMarkdown(source)
    expect(doc.capabilities.graph).toBe(false)
    expect(doc.graph).toBeUndefined()
  })

  it('3 links across 3 sections → graph ON, derived', () => {
    const { doc } = parseMarkdown(chain(3))
    expect(doc.capabilities.graph).toBe(true)
    expect(doc.graph?.derived).toBe(true)
  })

  it('3 links from one hub across 4 endpoint sections → graph ON', () => {
    const source = NO_GRAPH_BLOCK([
      '## Hub',
      'See [A](#a), [B](#b) and [C](#c).',
      '## A',
      'Body.',
      '## B',
      'Body.',
      '## C',
      'Body.',
    ])
    const { doc } = parseMarkdown(source)
    expect(doc.capabilities.graph).toBe(true)
  })

  it('many links inside a single section → graph OFF (they are all self-links)', () => {
    const source = NO_GRAPH_BLOCK(['## Only', 'Links: [Only](#only), [Only](#only), [Only](#only).'])
    const { doc } = parseMarkdown(source)
    expect(doc.capabilities.graph).toBe(false)
  })
})

describe('§11.4 boundary: section count', () => {
  it('4 cross-links but only 2 distinct H2s involved → graph OFF', () => {
    const source = NO_GRAPH_BLOCK([
      '## Alpha',
      'See [Beta](#beta), [Beta](#beta) and [Beta](#beta).',
      '## Beta',
      'See [Alpha](#alpha).',
    ])
    const { doc } = parseMarkdown(source)
    expect(doc.capabilities.graph).toBe(false)
  })
})

describe('§11.4 boundary: self-links and unresolved links do not count', () => {
  it('a self-link is not a cross-link', () => {
    const source = NO_GRAPH_BLOCK(['## Loop', 'See [Loop](#loop) twice: [Loop](#loop).'])
    const { doc } = parseMarkdown(source)
    expect(doc.capabilities.graph).toBe(false)
  })

  it('links to slugs that do not exist are recorded but never counted', () => {
    const source = NO_GRAPH_BLOCK([
      '## A',
      'See [nope](#nope), [nope](#nope), [nope](#nope).',
      '## B',
      'Body.',
    ])
    const { doc } = parseMarkdown(source)
    expect(doc.unresolvedLinks.length).toBeGreaterThan(0)
    expect(doc.capabilities.graph).toBe(false)
  })
})

describe('§11.4 boundary: explicit always wins', () => {
  it('an explicit block turns the graph on with no links at all', () => {
    const { doc } = parseMarkdown(`# Explicit\n\n## A\n\nBody.\n\n${EXPLICIT}`)
    expect(doc.capabilities.graph).toBe(true)
    expect(doc.graph?.derived).toBe(false)
  })

  it('an explicit block is used even when derivation would also qualify', () => {
    const { doc } = parseMarkdown(`# Both\n\n${chain(3)}\n\n${EXPLICIT}`)
    expect(doc.graph?.derived).toBe(false)
    expect(doc.graph?.spec.nodes.map((node) => node.id)).toEqual(['one', 'two'])
  })

  it('a malformed explicit block falls back to derivation, not to nothing', () => {
    const broken = ['```graph', 'edges:', '  a -> b', '```'].join('\n')
    const { doc } = parseMarkdown(`# Broken\n\n${chain(3)}\n\n${broken}`)
    expect(doc.graph?.derived).toBe(true)
  })
})

describe('deriveGraph reports why it refused', () => {
  const sections = [
    { level: 2 as const, slug: 'a', title: 'A', blocks: [], children: [], files: [], tests: [], wordCount: 0, linksTo: [], text: '' },
  ]

  it('no sections at all', () => {
    const result = deriveGraph([], [{ from: 'a', to: 'b', targetSlug: 'b' }])
    expect(result.derived).toBe(false)
    expect(result.reason).toBe('no-h2-sections')
  })

  it('too few links', () => {
    const result = deriveGraph(sections, [{ from: 'a', to: 'a', targetSlug: 'a' }])
    expect(result.derived).toBe(false)
    expect(result.reason).toBe('too-few-links')
  })

  it('enough links but too few distinct sections', () => {
    const links: CrossLink[] = Array.from({ length: 4 }, () => ({ from: 'a', to: 'b', targetSlug: 'b' }))
    const result = deriveGraph(sections, links)
    expect(result.derived).toBe(false)
    expect(result.reason).toBe('too-few-sections')
  })
})

describe('the crosslinked fixture sits exactly on the boundary', () => {
  it('has exactly 3 cross-links across exactly 3 H2s and no graph block', () => {
    const { doc } = parseFixture('crosslinked')
    const hrefs = doc.sections.flatMap((section) => section.linksTo)
    expect(hrefs).toHaveLength(3)
    expect(new Set(doc.sections.map((section) => section.slug)).size).toBe(3)
    expect(doc.graph?.derived).toBe(true)
  })

  it('losing one link would turn the capability off', () => {
    const source = NO_GRAPH_BLOCK([
      '## One',
      'See [Two](#two).',
      '## Two',
      'See [Three](#three).',
      '## Three',
      'No outgoing link.',
    ])
    const { doc } = parseMarkdown(source)
    expect(doc.capabilities.graph).toBe(false)
  })
})
