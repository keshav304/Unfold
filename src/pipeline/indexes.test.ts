/**
 * §11.8 — search smoke per fixture: title hit, body hit, file hit, alias hit.
 * §6.6 — backlinks and ±45-char snippet windows.
 */

import { describe, expect, it } from 'vitest'
import { SNIPPET_WINDOW } from './constants'
import { buildBacklinks, createSearchIndex, snippetAround } from './indexes'
import { FIXTURES, allSections, parseFixture } from '../test/fixtures'
import type { SearchRecord } from './types'

function search(doc: { indexes: { records: SearchRecord[] } }, query: string) {
  return createSearchIndex(doc.indexes.records).search(query)
}

describe('§11.8 search smoke', () => {
  it.each(FIXTURES)('%s indexes without throwing and returns results for a title query', (name) => {
    const { doc } = parseFixture(name)
    const first = allSections(doc.sections)[0]
    if (first === undefined) return
    const results = search(doc, first.title)
    expect(results.length).toBeGreaterThan(0)
  })

  it('a section title hit resolves to the right slug', () => {
    const { doc } = parseFixture('kitchen-sink')
    const results = search(doc, 'Runtime shape')
    expect(results.map((result) => result.slug)).toContain('runtime-shape')
  })

  it('a body-text hit resolves to a section', () => {
    const { doc } = parseFixture('kitchen-sink')
    const results = search(doc, 'tail latency')
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((result) => result.slug === 'operational-notes')).toBe(true)
  })

  it('a file-path hit is searchable', () => {
    const { doc } = parseFixture('kitchen-sink')
    const results = search(doc, 'entities.ts')
    expect(results.some((result) => result.kind === 'file')).toBe(true)
  })

  it('a glossary term hit is searchable', () => {
    const { doc } = parseFixture('kitchen-sink')
    const results = search(doc, 'Snapshot')
    expect(results.some((result) => result.kind === 'glossary')).toBe(true)
  })

  it('an ALIAS hit is searchable, which is the §11.6/§11.8 requirement', () => {
    const { doc } = parseFixture('kitchen-sink')
    // "MR" reaches the index only through the explicit alias, never by being
    // guessed from the term "Measurement Run".
    const results = search(doc, 'MR')
    const glossaryHit = results.find((result) => result.kind === 'glossary')
    expect(glossaryHit).toBeDefined()
    expect(glossaryHit?.keywords).toContain('MR')
  })

  it('minimal still searches its prose — search is always available (Tier 0)', () => {
    const { doc } = parseFixture('minimal')
    expect(doc.capabilities).toEqual({
      graph: false,
      stepper: false,
      glossary: false,
      entities: false,
      mermaid: false,
      loop: false,
      terminal: false,
    })
    expect(search(doc, 'Purpose').length).toBeGreaterThan(0)
  })

  it('an empty document produces an empty, usable index', () => {
    const { doc } = parseFixture('no-structure')
    expect(() => search(doc, 'anything')).not.toThrow()
  })

  it('records are serialisable — the Doc must survive JSON round-tripping', () => {
    const { doc } = parseFixture('kitchen-sink')
    const round = JSON.parse(JSON.stringify(doc.indexes.records)) as SearchRecord[]
    expect(round).toHaveLength(doc.indexes.records.length)
  })
})

describe('backlinks (§6.6)', () => {
  it('map a file path to the slugs mentioning it', () => {
    const { doc } = parseFixture('kitchen-sink')
    expect(doc.indexes.backlinks['tools/build.sh']).toEqual(['operational-notes'])
  })

  it('are keyed case-insensitively', () => {
    const backlinks = buildBacklinks(new Map([['s', [{ path: 'Src/A.TS' }]]]))
    expect(backlinks['src/a.ts']).toEqual(['s'])
  })

  it('a path mentioned in two sections lists both', () => {
    const backlinks = buildBacklinks(
      new Map([
        ['one', [{ path: 'shared.ts' }]],
        ['two', [{ path: 'shared.ts' }]],
      ]),
    )
    expect(backlinks['shared.ts']).toEqual(['one', 'two'])
  })

  it('a section mentioning a path twice lists the slug once', () => {
    const backlinks = buildBacklinks(new Map([['one', [{ path: 'a.ts' }, { path: 'a.ts' }]]]))
    expect(backlinks['a.ts']).toEqual(['one'])
  })

  it('no files means no backlinks', () => {
    const { doc } = parseFixture('minimal')
    expect(doc.indexes.backlinks).toEqual({})
  })
})

describe('snippet windows are ±45 characters (§6.6)', () => {
  it('the window constant is 45', () => {
    expect(SNIPPET_WINDOW).toBe(45)
  })

  it('centres the window on the match', () => {
    const text = `${'x'.repeat(200)}needle${'y'.repeat(200)}`
    const snippet = snippetAround(text, 'needle')
    expect(snippet.text).toContain('needle')
    expect(snippet.start).toBe(200 - SNIPPET_WINDOW)
    expect(snippet.end).toBe(200 + 'needle'.length + SNIPPET_WINDOW)
  })

  it('clamps at the start of the text', () => {
    const snippet = snippetAround('needle' + 'y'.repeat(200), 'needle')
    expect(snippet.start).toBe(0)
    expect(snippet.text.startsWith('needle')).toBe(true)
  })

  it('clamps at the end of the text', () => {
    const text = 'x'.repeat(200) + 'needle'
    const snippet = snippetAround(text, 'needle')
    expect(snippet.end).toBe(text.length)
  })

  it('never returns a blank snippet when there is no match', () => {
    const snippet = snippetAround('some prose here', 'absent')
    expect(snippet.text).not.toBe('')
  })

  it('empty text yields an empty snippet rather than throwing', () => {
    expect(snippetAround('', 'anything')).toEqual({ text: '', start: 0, end: 0 })
  })

  it('matches case-insensitively', () => {
    const snippet = snippetAround('a NEEDLE here', 'needle')
    expect(snippet.text).toContain('NEEDLE')
  })
})
