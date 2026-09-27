/**
 * M3.4 — which section a graph node is about, and what happens when it is none.
 *
 * The rule is simple and the consequences are not:
 *
 *   - a **derived** graph's node ids are the H2 slugs the pipeline derived them
 *     from, so every one of them resolves;
 *   - an **explicit** graph's ids are whatever the author typed, and §6.7 has no
 *     syntax for pointing a node at a section. So an explicit node resolves only
 *     when its id happens to match a slug.
 *
 * That asymmetry is the whole content of the inspector. A test that only checked
 * the derived case would pass while the explicit case — the one a real document
 * uses — quietly offered a dead "Open section" button.
 */

import { describe, expect, it } from 'vitest'
import { sectionsBySlug, targetForNode, unresolvedNodeIds } from '../app/graph/graph-targets'
import { parseFixture, parseMarkdown } from './fixtures'

const KITCHEN = parseFixture('kitchen-sink').doc
const CROSSLINKED = parseFixture('crosslinked').doc

describe('M3.3 a derived map resolves every node', () => {
  it('every derived node id is a real slug', () => {
    const bySlug = sectionsBySlug(CROSSLINKED)
    const ids = (CROSSLINKED.graph?.spec.nodes ?? []).map((node) => node.id)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(targetForNode(id, bySlug).section, `${id} resolved to nothing`).not.toBeNull()
    }
  })

  it('and none of them is reported as unresolved', () => {
    const ids = (CROSSLINKED.graph?.spec.nodes ?? []).map((node) => node.id)
    expect(unresolvedNodeIds(CROSSLINKED, ids)).toEqual([])
  })
})

describe('M3.4 an explicit node resolves when its id is a slug', () => {
  const bySlug = sectionsBySlug(KITCHEN)

  it('a node named after a section finds it', () => {
    const target = targetForNode('runtime-shape', bySlug)
    expect(target.slug).toBe('runtime-shape')
    expect(target.section?.title).toBe('Runtime shape')
  })

  it('the match is case-insensitive, like a §6.4 anchor', () => {
    expect(targetForNode('Runtime-Shape', bySlug).slug).toBe('runtime-shape')
  })

  it('the H3 slugs resolve too, not only the H2s', () => {
    expect(targetForNode('component-graph', bySlug).slug).toBe('component-graph')
  })
})

describe('M3.4 an explicit node that names no section says so', () => {
  const bySlug = sectionsBySlug(KITCHEN)

  it('resolves to nothing rather than to a near match', () => {
    // The kitchen-sink graph is `shell`, `ingest`, `store`, `planner` — system
    // components, not sections. There is no honest mapping from them, and
    // inventing one would be a fiction the reader would then have to debug.
    const target = targetForNode('shell', bySlug)
    expect(target.slug).toBeNull()
    expect(target.section).toBeNull()
  })

  it('a near-miss is still a miss: no fuzzy matching of node ids to titles', () => {
    // "Runtime" is close to "Runtime shape" and belongs to no section. Fuzzy
    // matching here would be a guess presented as a link.
    expect(targetForNode('runtime', bySlug).slug).toBeNull()
  })

  it('the unresolved ids are reported so the view can warn about them', () => {
    expect(unresolvedNodeIds(KITCHEN, ['shell', 'ingest', 'runtime-shape', 'store'])).toEqual([
      'shell',
      'ingest',
      'store',
    ])
  })
})

describe('M3.4 the lookup is over the document, not a hardcoded list', () => {
  it('a document with different sections resolves against its own', () => {
    const { doc } = parseMarkdown(
      ['# T', '', '## Alpha', '', 'text', '', '```graph', 'nodes:', '  alpha: A', '```', ''].join('\n'),
    )
    const bySlug = sectionsBySlug(doc)
    expect(targetForNode('alpha', bySlug).section?.title).toBe('Alpha')
    // And a name from a *different* document resolves to nothing here.
    expect(targetForNode('runtime-shape', bySlug).slug).toBeNull()
  })

  it('a document with no sections resolves nothing at all', () => {
    const { doc } = parseMarkdown('just prose, no headings\n')
    expect(sectionsBySlug(doc).size).toBe(0)
    expect(targetForNode('anything', sectionsBySlug(doc)).slug).toBeNull()
  })
})
