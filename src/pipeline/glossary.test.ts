/**
 * §11.6 — glossary assembly. Candidate headings are exact; aliases come only
 * from explicit `Aliases:` lines; similar-but-unrelated terms are never merged.
 */

import { describe, expect, it } from 'vitest'
import { GLOSSARY_CANDIDATE_HEADINGS } from './constants'
import { buildGlossary, isGlossaryCandidate, parseAliasLine } from './glossary'
import { parseFixture, parseMarkdown } from '../test/fixtures'
import type { GlossaryEntry } from './types'

function entriesOf(...lines: string[]): GlossaryEntry[] {
  return parseMarkdown(`# Doc\n\n${lines.join('\n')}`).doc.glossary ?? []
}

describe('candidate headings are exact, case-insensitive (§6.6)', () => {
  it.each(GLOSSARY_CANDIDATE_HEADINGS)('%s is a candidate', (heading) => {
    expect(isGlossaryCandidate(heading)).toBe(true)
    expect(isGlossaryCandidate(heading.toUpperCase())).toBe(true)
  })

  it('near-misses are not candidates', () => {
    for (const heading of ['Glossarys', 'The Glossary', 'Glossary of terms', 'Terms & Conditions', 'Index']) {
      expect(isGlossaryCandidate(heading)).toBe(false)
    }
  })

  it('a "Glossary" section with H3 children produces entries', () => {
    const entries = entriesOf('## Glossary', '', '### Alpha', '', 'First.', '', '### Beta', '', 'Second.')
    expect(entries.map((entry) => entry.term)).toEqual(['Alpha', 'Beta'])
  })

  it('the definition is the entry first paragraph', () => {
    const entries = entriesOf('## Glossary', '', '### Alpha', '', 'The definition.', '', 'More prose.', '', '### Beta', '', 'Another.')
    expect(entries.map((entry) => entry.definition)).toEqual(['The definition.', 'Another.'])
  })
})

describe('entries merge across multiple candidate sections (§15)', () => {
  it('Terms and Definitions both contribute', () => {
    const entries = entriesOf(
      '## Terms', '', '### Token', '', 'A unit of meaning.', '',
      '## Definitions', '', '### Lexeme', '', 'A unit of language.',
    )
    expect(entries.map((entry) => entry.term).sort()).toEqual(['Lexeme', 'Token'])
  })

  it('a duplicated term keeps the first definition and accumulates aliases', () => {
    const entries = entriesOf(
      '## Glossary', '', '### Token', '', 'First definition.', 'Aliases: T1', '',
      '## Terms', '', '### token', '', 'Second definition.', 'Aliases: T2',
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]?.definition).toBe('First definition.')
    expect(entries[0]?.aliases).toEqual(['T1', 'T2'])
  })
})

describe('similar terms are NEVER merged (§6.6, §11.6)', () => {
  it('near-identical headings stay separate entries', () => {
    const entries = entriesOf(
      '## Glossary', '',
      '### Cache', '', 'A fast store.', '',
      '### Caches', '', 'Several fast stores.', '',
      '### Caching', '', 'The act of caching.', '',
      '### Cached', '', 'Already stored.',
    )
    expect(entries.map((entry) => entry.term)).toEqual(['Cache', 'Caches', 'Caching', 'Cached'])
  })

  it('a term and its plural are distinct', () => {
    const entries = entriesOf('## Glossary', '', '### Index', '', 'A structure.', '', '### Indices', '', 'A list.')
    expect(entries).toHaveLength(2)
  })
})

describe('aliases come only from explicit lines (§6.6)', () => {
  it('parses a comma-separated alias list', () => {
    expect(parseAliasLine('Aliases: MR, measurement run')).toEqual(['MR', 'measurement run'])
    expect(parseAliasLine('Alias: T')).toEqual(['T'])
  })

  it('is case-insensitive on the prefix but preserves alias case', () => {
    expect(parseAliasLine('ALIASES: Alpha, Beta')).toEqual(['Alpha', 'Beta'])
  })

  it('ignores a line that merely mentions aliases', () => {
    expect(parseAliasLine('This paragraph has no alias declaration.')).toEqual([])
    expect(parseAliasLine('See the aliases below.')).toEqual([])
  })

  it('an entry with no alias line has no aliases — nothing is inferred', () => {
    const entries = entriesOf('## Glossary', '', '### Measurement Run', '', 'One execution.')
    expect(entries[0]?.aliases).toEqual([])
  })

  it('a term repeated in prose does not become its own alias', () => {
    const entries = entriesOf('## Glossary', '', '### Run', '', 'A single execution.', '', 'Prose calls this a run.')
    expect(entries[0]?.aliases).toEqual([])
  })

  it('the alias line is not part of the definition', () => {
    const entries = entriesOf('## Glossary', '', '### Measurement Run', '', 'One execution.', 'Aliases: MR')
    expect(entries[0]?.definition).toBe('One execution.')
    expect(entries[0]?.aliases).toEqual(['MR'])
  })

  it('the spec §6.6 example parses exactly as written', () => {
    const entries = entriesOf(
      '## Glossary', '',
      '### Measurement Run',
      'One execution of the frozen prompt pack.',
      'Aliases: MR, measurement run',
    )
    expect(entries).toEqual([
      {
        term: 'Measurement Run',
        aliases: ['MR', 'measurement run'],
        definition: 'One execution of the frozen prompt pack.',
      },
    ])
  })
})

describe('non-glossary sections contribute nothing', () => {
  it('a section with no H3 children yields no entries', () => {
    expect(entriesOf('## Glossary', '', 'Just a paragraph, no sub-headings.')).toEqual([])
  })

  it('a normal section is not a glossary', () => {
    expect(entriesOf('## Architecture', '', '### Shell', '', 'The client.')).toEqual([])
  })
})

describe('the kitchen-sink fixture', () => {
  it('produces three entries, one with an explicit alias list', () => {
    const { doc } = parseFixture('kitchen-sink')
    const glossary = doc.glossary ?? []
    expect(glossary.map((entry) => entry.term)).toEqual(['Measurement Run', 'Adapter', 'Snapshot'])
    expect(glossary.find((entry) => entry.term === 'Measurement Run')?.aliases).toEqual([
      'MR',
      'measurement run',
    ])
    expect(glossary.find((entry) => entry.term === 'Adapter')?.aliases).toEqual([])
  })
})

describe('buildGlossary is pure over a section list', () => {
  it('returns an empty array for no sections', () => {
    expect(buildGlossary([])).toEqual([])
  })
})
