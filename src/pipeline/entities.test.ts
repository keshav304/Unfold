/**
 * §11.7 — entity extraction. Generic rules only: the extension list drives what
 * counts as a path, code is never scanned, and results are deduped per section.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_FILE_EXTENSIONS } from './constants'
import { normalizeConfig } from './config'
import { extractEntities, proseRunsOf } from './entities'
import { parseFixture, parseMarkdown } from '../test/fixtures'

const ext = (paths: string[]) => extractEntities([paths.join(' ')], { fileExtensions: DEFAULT_FILE_EXTENSIONS })

describe('file paths (§6.5)', () => {
  it('finds a bare filename and a nested path', () => {
    const { files } = ext(['See README.md and src/deep/nested/file.py.'])
    expect(files.map((file) => file.path)).toEqual(['README.md', 'src/deep/nested/file.py'])
  })

  it('normalises Windows separators', () => {
    const { files } = ext(['Open src\\app\\main.ts please.'])
    expect(files.map((file) => file.path)).toEqual(['src/app/main.ts'])
  })

  it('only accepts extensions on the list', () => {
    const { files } = ext(['a.ts b.unknownext c.png d.rs'])
    expect(files.map((file) => file.path)).toEqual(['a.ts', 'd.rs'])
  })

  it('an empty extension list matches nothing rather than everything', () => {
    const { files } = extractEntities(['a.ts b.py c.md'], { fileExtensions: [] })
    expect(files).toEqual([])
  })

  it('does not treat a domain name as a path', () => {
    const { files } = ext(['Visit example.com for docs.'])
    expect(files).toEqual([])
  })

  it('does not treat a URL path as a local file', () => {
    const { files } = ext(['See https://example.com/guide/intro.md for details.'])
    expect(files).toEqual([])
  })

  it('a version number is not a path', () => {
    const { files } = ext(['Upgrade to version 1.2 before continuing.'])
    expect(files).toEqual([])
  })
})

/**
 * Product names ending in a source extension are the false-positive class the
 * stranger test surfaced. The rule is about *case shape*, never about content:
 * no product or language is named in src/.
 */
describe('a capitalised product name is not a file (§1.1: hide, never fake)', () => {
  it('rejects a bare capitalised stem', () => {
    const { files } = ext(['Requires Node.js at runtime.'])
    expect(files).toEqual([])
  })

  it('accepts the same token in lower case, which is a filename', () => {
    const { files } = ext(['See node.js for details.'])
    expect(files.map((file) => file.path)).toEqual(['node.js'])
  })

  it('accepts an all-uppercase conventional filename', () => {
    const { files } = ext(['Copy README.md and CHANGELOG.md first.'])
    expect(files.map((file) => file.path)).toEqual(['README.md', 'CHANGELOG.md'])
  })

  it('a bare name with no extension is not a path', () => {
    // LICENSE, Makefile and friends carry no source extension, so §6.5 does
    // not make them file mentions. That is a deliberate scope limit.
    const { files } = ext(['Copy LICENSE and Makefile first.'])
    expect(files).toEqual([])
  })

  it('accepts a lowercase stem with a dotted suffix', () => {
    const { files } = ext(['Read unfold.config.json before deploying.'])
    expect(files.map((file) => file.path)).toEqual(['unfold.config.json'])
  })

  it('the extension itself may be upper case', () => {
    const { files } = ext(['README.MD is the entry point.'])
    expect(files.map((file) => file.path)).toEqual(['README.MD'])
  })

  it('a mixed-case stem is an accepted false negative', () => {
    // Erring toward a missing chip is correct here: §1.1 wants a hidden
    // feature far more than a fictional one.
    const { files } = ext(['Read the Jest.config.js file.'])
    expect(files).toEqual([])
  })

  it('a nested path is accepted whatever its case', () => {
    const { files } = ext(['Import Src/Widgets/Modal.tsx and src/lib/util.ts.'])
    expect(files.map((file) => file.path)).toEqual(['Src/Widgets/Modal.tsx', 'src/lib/util.ts'])
  })

  it('case shape does not affect a document that reaches the threshold', () => {
    const { doc } = parseMarkdown(
      ['# T', '', 'Node.js runs src/a.ts, docs/b.md and tools/c.sh.'].join('\n'),
    )
    expect(doc.indexes.filePaths).toEqual(['docs/b.md', 'src/a.ts', 'tools/c.sh'])
    expect(doc.capabilities.entities).toBe(true)
  })
})

describe('path::symbol (§6.5)', () => {
  it('captures the symbol separately from the path', () => {
    const { files } = ext(['Implemented in src/pipeline/parse.ts::buildDoc.'])
    expect(files).toEqual([{ path: 'src/pipeline/parse.ts', symbol: 'buildDoc' }])
  })

  it('a path with no symbol is still a path', () => {
    const { files } = ext(['Read docs/spec.md.'])
    expect(files).toEqual([{ path: 'docs/spec.md' }])
  })
})

describe('test ids (§6.5)', () => {
  it('recognises test_ prefixed identifiers', () => {
    const { tests, files } = ext(['Covered by tests/parse.test.ts::test_slug_duplicates'])
    expect(tests).toEqual([
      { id: 'tests/parse.test.ts::test_slug_duplicates', path: 'tests/parse.test.ts', testId: 'test_slug_duplicates' },
    ])
    expect(files).toEqual([])
  })

  it('recognises .test. and .spec. paths when a symbol follows', () => {
    const { tests, files } = ext(['tests/a.test.ts::adds_two_numbers', 'tests/b.spec.ts::it_works'])
    expect(tests.map((test) => test.path)).toEqual(['tests/a.test.ts', 'tests/b.spec.ts'])
    expect(files).toEqual([])
  })

  it('a bare test path with no symbol is an ordinary file path', () => {
    const { files, tests } = ext(['See tests/a.test.ts for the suite.'])
    expect(tests).toEqual([])
    expect(files.map((file) => file.path)).toEqual(['tests/a.test.ts'])
  })

  it('a non-test symbol stays an ordinary symbol', () => {
    const { files, tests } = ext(['See src/app.ts::render for the renderer.'])
    expect(tests).toEqual([])
    expect(files).toEqual([{ path: 'src/app.ts', symbol: 'render' }])
  })
})

describe('dedupe per section (§6.5)', () => {
  it('repeats of the same path collapse to one entry', () => {
    const { files } = ext(['a.ts b.ts a.ts b.ts a.ts'])
    expect(files.map((file) => file.path)).toEqual(['a.ts', 'b.ts'])
  })

  it('the same path with different symbols is two entries', () => {
    const { files } = ext(['src/a.ts::one and src/a.ts::two'])
    expect(files).toEqual([
      { path: 'src/a.ts', symbol: 'one' },
      { path: 'src/a.ts', symbol: 'two' },
    ])
  })
})

describe('code is never scanned (§6.5, §11.7)', () => {
  it('a path inside a fenced code block is not an entity', () => {
    const { doc } = parseMarkdown(
      ['# T', '', 'Prose with no paths.', '', '```text', 'src/fenced/only.py', '```'].join('\n'),
    )
    expect(doc.indexes.filePaths).toEqual([])
    expect(doc.capabilities.entities).toBe(false)
  })

  it('a path inside an inline code span IS an entity (A2)', () => {
    // A backticked path in prose is an author pointing at a real file, and
    // technical documents write them that way far more often than bare.
    const { doc } = parseMarkdown(['# T', '', 'Prose with no paths, but `src/inline.py` inline.'].join('\n'))
    expect(doc.indexes.filePaths).toEqual(['src/inline.py'])
  })

  it('a path::symbol inside an inline code span is an entity (A2)', () => {
    const { doc } = parseMarkdown(['# T', '', 'See `src/app.ts::render` for details.'].join('\n'))
    expect(doc.indexes.filePaths).toEqual(['src/app.ts'])
  })

  it('a test id inside an inline code span is a test (A2)', () => {
    const { doc } = parseMarkdown(['# T', '', 'Covered by `tests/a.test.ts::adds_numbers`.'].join('\n'))
    expect(doc.indexes.filePaths).toEqual(['tests/a.test.ts'])
  })

  it('a path in prose IS an entity, in the same document as fenced paths', () => {
    const { doc } = parseMarkdown(
      [
        '# T',
        '',
        'Real mention of src/real.ts in prose.',
        '',
        '```text',
        'src/fenced/only.py',
        '```',
        '',
        'And another: docs/guide.md.',
      ].join('\n'),
    )
    expect(doc.indexes.filePaths).toEqual(['docs/guide.md', 'src/real.ts'])
  })

  it('the kitchen-sink fixture picks up prose paths and ignores fenced ones', () => {
    const { doc } = parseFixture('kitchen-sink')
    expect(doc.indexes.filePaths).toContain('src/pipeline/parse.ts')
    expect(doc.indexes.filePaths).toContain('docs/spec.md')
    // `def build_doc(...)` in the python fence must not register.
    expect(doc.indexes.filePaths.some((path) => path.includes('build_doc'))).toBe(false)
  })
})

describe('extension list is config-extensible (§6.5, §1.4)', () => {
  it('honours a custom extension list', () => {
    const { files } = extractEntities(['a.ts b.zig c.odin'], { fileExtensions: ['zig', 'odin'] })
    expect(files.map((file) => file.path)).toEqual(['b.zig', 'c.odin'])
  })

  it('replaces rather than extends the default list', () => {
    const config = normalizeConfig({ fileExtensions: ['zig'] })
    const { files } = extractEntities(['a.ts b.zig'], { fileExtensions: config.fileExtensions })
    expect(files.map((file) => file.path)).toEqual(['b.zig'])
  })

  it('the whole document threshold moves with the config', () => {
    const source = ['# T', '', 'a.ts', '', 'b.zig', '', 'c.odin'].join('\n')
    // Default list knows neither .zig nor .odin: one path, threshold not met.
    expect(parseMarkdown(source).doc.capabilities.entities).toBe(false)
    const { doc } = parseMarkdown(source, { config: normalizeConfig({ fileExtensions: ['ts', 'zig', 'odin'] }) })
    expect(doc.capabilities.entities).toBe(true)
  })
})

describe('extra regex patterns from config (§1.4)', () => {
  it('collects named custom hits', () => {
    const { customHits } = extractEntities(['Ticket ENG-123 is referenced.'], {
      extraPatterns: [{ name: 'ticket', pattern: 'ENG-\\d+' }],
    })
    expect(customHits).toEqual([{ name: 'ticket', text: 'ENG-123' }])
  })

  it('an invalid pattern is ignored rather than fatal', () => {
    expect(() =>
      extractEntities(['text'], { extraPatterns: [{ name: 'bad', pattern: '([' }] }),
    ).not.toThrow()
  })
})

describe('glossary term matching is word-bounded (§6.5)', () => {
  const glossary = [{ term: 'Adapter', aliases: ['MR'] }]

  it('matches the term and its alias case-insensitively', () => {
    const { glossaryHits } = extractEntities(['An adapter wraps. Also an MR.'], { glossary })
    expect(glossaryHits.map((hit) => [hit.text.toLowerCase(), hit.term, hit.isAlias])).toEqual([
      ['adapter', 'Adapter', false],
      ['mr', 'Adapter', true],
    ])
  })

  it('does not match inside a longer word', () => {
    const { glossaryHits } = extractEntities(['Adapterly and preadapter.'], { glossary })
    expect(glossaryHits).toEqual([])
  })

  it('an empty glossary matches nothing', () => {
    const { glossaryHits } = extractEntities(['Adapter MR'], { glossary: [] })
    expect(glossaryHits).toEqual([])
  })
})

describe('proseRunsOf splits prose from inline code (§6.5, A2)', () => {
  it('a table cell is scanned according to how it is actually written (A3)', () => {
    const source = ['# T', '', '## S', '', '| File |', '| --- |', '| src/a.ts | `src/b.ts` |'].join('\n')
    const { doc } = parseMarkdown(source)
    const section = doc.sections[0]
    expect(section?.blocks[0]?.kind).toBe('table')
    const runs = proseRunsOf(section?.blocks ?? [])
    // A bare cell is prose; a backticked cell is an inline span. Before A3 every
    // cell was pushed into both sets, which made the split a lie the renderer
    // then had to undo.
    expect(runs.prose).toContain('src/a.ts')
    expect(runs.inline).toContain('src/b.ts')
  })

  it('the file family still reads both, so both cells are extracted', () => {
    const source = ['# T', '', '## S', '', '| File |', '| --- |', '| src/a.ts | `src/b.ts` |'].join('\n')
    const { doc } = parseMarkdown(source)
    const paths = doc.sections[0]?.files.map((file) => file.path) ?? []
    expect(paths).toContain('src/a.ts')
    expect(paths).toContain('src/b.ts')
  })

  it('a `path::symbol` and a test id inside a cell are both extracted', () => {
    const source = [
      '# T',
      '',
      '## S',
      '',
      '| Ref |',
      '| --- |',
      '| `src/a.ts::run` |',
      '| `src/a.test.ts::test_thing` |',
    ].join('\n')
    const { doc } = parseMarkdown(source)
    const section = doc.sections[0]
    expect(section?.files.map((file) => `${file.path}::${file.symbol}`)).toContain('src/a.ts::run')
    expect(section?.tests.map((test) => test.id)).toContain('src/a.test.ts::test_thing')
  })

  it('a glossary term in a bare cell matches; one in backticks does not (A2 still holds)', () => {
    const source = [
      '# T',
      '',
      '## Glossary',
      '',
      '### Adapter',
      '',
      'A thin wrapper.',
      '',
      '## S',
      '',
      '| A |',
      '| --- |',
      '| An Adapter here |',
      '| `Adapter` quoted |',
    ].join('\n')
    const { doc } = parseMarkdown(source)
    const glossary = (doc.glossary ?? []).map((entry) => ({ term: entry.term, aliases: entry.aliases }))
    const section = doc.sections.find((entry) => entry.slug === 's')
    const hits = extractEntities(proseRunsOf(section?.blocks ?? []), { glossary })
    // Word-bounded, and exactly one hit — the quoted occurrence is a literal.
    expect(hits.glossaryHits).toEqual([{ text: 'Adapter', term: 'Adapter', isAlias: false }])
  })

  it('inline code reaches the inline set but never the prose set', () => {
    const source = ['# T', '', 'Run `npm ci` to install.'].join('\n')
    const { doc } = parseMarkdown(source)
    const runs = proseRunsOf(doc.intro)
    expect(runs.inline).toContain('npm ci')
    expect(runs.prose.join(' ')).not.toContain('npm ci')
  })

  it('a fenced block reaches neither set', () => {
    const source = ['# T', '', '```text', 'src/fenced.ts', '```'].join('\n')
    const { doc } = parseMarkdown(source)
    const runs = proseRunsOf(doc.intro)
    expect(runs.prose.join(' ')).not.toContain('src/fenced.ts')
    expect(runs.inline.join(' ')).not.toContain('src/fenced.ts')
  })
})

describe('glossary terms stay prose-only even in backticks (A2)', () => {
  const glossary = [{ term: 'Adapter', aliases: ['MR'] }]

  it('a term in plain prose matches', () => {
    const { glossaryHits } = extractEntities({ prose: ['An adapter wraps.'], inline: [] }, { glossary })
    expect(glossaryHits).toHaveLength(1)
  })

  it('a term inside backticks does NOT match', () => {
    // The author is quoting a literal string, not referencing a concept.
    const { glossaryHits } = extractEntities({ prose: ['The class'], inline: ['Adapter'] }, { glossary })
    expect(glossaryHits).toEqual([])
  })

  it('the array shorthand is prose-only, so backticks are irrelevant there', () => {
    const { glossaryHits } = extractEntities(['An adapter wraps.'], { glossary })
    expect(glossaryHits).toHaveLength(1)
  })
})

describe('the edge-cases fixture stays under the entity threshold', () => {
  it('has two file paths, one short of the threshold', () => {
    const { doc } = parseFixture('edge-cases')
    expect(doc.indexes.filePaths).toEqual(['src/pipeline/slug.ts', 'tools/lint.py'])
    expect(doc.capabilities.entities).toBe(false)
  })

  it('a file path inside a nested fence is not extracted', () => {
    const { doc } = parseFixture('edge-cases')
    expect(doc.indexes.filePaths.some((path) => path.includes('this is a string'))).toBe(false)
  })
})
