/**
 * §11.1 — per-fixture golden snapshots: section tree (slugs, block kinds,
 * counts), capability sets, stats. A parsing regression turns these red.
 *
 * Snapshots are committed. If a change is intentional, review the diff: a
 * snapshot that moves because a fixture was edited is the point of the test.
 */

import { describe, expect, it } from 'vitest'
import { FIXTURES, allBlocksOf, allSections, kindCounts, parseFixture, sectionTree } from '../test/fixtures'
import type { CapabilitySet, Doc } from './types'

function capabilitiesOf(doc: Doc): CapabilitySet {
  return { ...doc.capabilities }
}

function summaryOf(doc: Doc) {
  return {
    title: doc.title,
    titleSource: doc.titleSource,
    capabilities: capabilitiesOf(doc),
    stats: doc.stats,
    sections: sectionTree(doc.sections),
    glossaryTerms: (doc.glossary ?? []).map((entry) => entry.term),
    graphDerived: doc.graph === undefined ? null : doc.graph.derived,
    stepCount: doc.steps?.length ?? 0,
    introKinds: kindCounts(doc.intro),
  }
}

describe('§11.1 golden snapshots', () => {
  it.each(FIXTURES)('%s', (name) => {
    const { doc } = parseFixture(name)
    expect(summaryOf(doc)).toMatchSnapshot()
  })
})

describe('every fixture parses without throwing', () => {
  it.each(FIXTURES)('%s yields a titled document', (name) => {
    const { doc } = parseFixture(name)
    expect(doc.title).not.toBe('')
    expect(doc.sections.length + doc.intro.length).toBeGreaterThan(0)
  })

  it.each(FIXTURES)('%s has a well-formed section tree', (name) => {
    const { doc } = parseFixture(name)
    const slugs = allSections(doc.sections).map((section) => section.slug)
    // Slugs are unique — that is what makes anchors resolvable.
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const section of allSections(doc.sections)) {
      expect([2, 3]).toContain(section.level)
      expect(section.title).not.toBe('')
      expect(section.wordCount).toBeGreaterThanOrEqual(0)
    }
    // Only the top level is level 2; children are level 3.
    for (const section of doc.sections) {
      expect(section.level).toBe(2)
      for (const child of section.children) expect(child.level).toBe(3)
    }
  })

  it.each(FIXTURES)('%s resolves its own internal links', (name) => {
    const { doc } = parseFixture(name)
    const slugs = new Set(allSections(doc.sections).map((section) => section.slug))
    for (const link of doc.unresolvedLinks) {
      // The only unresolved links a fixture may have are deliberate ones.
      expect(slugs.has(link.to)).toBe(false)
    }
  })

  it.each(FIXTURES)('%s indexes every section for search', (name) => {
    const { doc } = parseFixture(name)
    for (const section of allSections(doc.sections)) {
      expect(Object.keys(doc.indexes.sectionText)).toContain(section.slug)
    }
  })
})

describe('kitchen-sink section structure (spec §6.2)', () => {
  it('H2s are top level and H3s nest', () => {
    const { doc } = parseFixture('kitchen-sink')
    for (const section of doc.sections) {
      expect(section.level).toBe(2)
      for (const child of section.children) expect(child.level).toBe(3)
    }
  })

  it('duplicate H2 headings receive -1 suffixes', () => {
    const { doc } = parseFixture('kitchen-sink')
    const slugs = doc.sections.map((section) => section.slug)
    expect(slugs).toContain('notes')
    expect(slugs).toContain('notes-1')
  })

  it('every block kind in the model is exercised somewhere in the fixture set', () => {
    const kinds = new Set<string>()
    for (const name of FIXTURES) {
      const { doc } = parseFixture(name)
      for (const block of allBlocksOf(doc)) kinds.add(block.kind)
    }
    for (const kind of [
      'prose',
      'code',
      'table',
      'terminal',
      'mermaid',
      'loop',
      'graph',
      'steps',
      'quote',
      'hr',
      'html',
    ]) {
      expect(kinds).toContain(kind)
    }
  })
})

describe('title fallback chain (spec §7.2)', () => {
  it('frontmatter wins over H1', () => {
    const { doc } = parseFixture('kitchen-sink')
    expect(doc.titleSource).toBe('frontmatter')
    expect(doc.title).toBe('Kitchen Sink Fixture')
  })

  it('H1 is used when there is no frontmatter', () => {
    const { doc } = parseFixture('minimal')
    expect(doc.titleSource).toBe('h1')
  })

  it('the filename is the last resort', () => {
    const { doc } = parseFixture('no-structure')
    expect(doc.titleSource).toBe('filename')
    expect(doc.title).toBe('No Structure')
  })
})
