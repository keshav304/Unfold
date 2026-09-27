/**
 * M3.0a — reference links (`[label][ref]`) and their definitions.
 *
 * The stranger round found the defect: a `linkReference` node carries only a
 * label and an identifier, so it fell through to the renderer's default branch
 * and came out as *nothing* — the author's words deleted, and any chip inside
 * the label deleted with it. Reference links are common in exactly the GitHub
 * READMEs this app is pointed at, so the fix has to be a contract, not a patch.
 *
 * Locked here: a resolved reference is a real link; an unresolved one keeps its
 * label (§6.4's rule — the only rule in the app that does not drop words); and a
 * definition is metadata, producing no block at all. An empty `<pre>` per
 * definition is a gap on the page, and §1.3 says a construct with no
 * presentation is absent, not rendered as nothing.
 *
 * The chip case (a file path inside a reference label) is asserted here rather
 * than in the fixture, because `edge-cases.md` deliberately sits *under* the
 * entity threshold and one path in a label would push it over — a fixture may
 * not quietly change the capability it was written to prove.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { renderInline, type InlineContext } from '../app/blocks/Inline'
import { DEFAULT_FILE_EXTENSIONS } from '../pipeline/constants'
import { parseFixture, parseMarkdown } from './fixtures'

afterEach(cleanup)

const WITH_REFERENCES = [
  '# Reference document',
  '',
  '## Reference-style links',
  '',
  'See [the specification][spec] and [the readme][readme].',
  '',
  'And [the missing target][nowhere].',
  '',
  '[spec]: https://example.com/spec.md "The specification"',
  '[readme]: https://example.com/readme.md',
  '',
].join('\n')

const CONTEXT: InlineContext = {
  slugs: new Set<string>(),
  fileExtensions: DEFAULT_FILE_EXTENSIONS,
  entities: true,
}
/**
 * Render every prose block of the first section, through the real pipeline.
 *
 * The context is assembled the way `Reader` assembles it, from the parsed
 * document — including the link definitions, which are the whole point here: a
 * context without them renders every reference as unresolved, which would make
 * these tests pass for the wrong reason.
 *
 * `derive` warnings are filtered out. A one-section document with no cross-links
 * legitimately earns one ("no derived document map") — that is the §6.7
 * threshold working, not a fault in this contract.
 */
function renderFirstProse(source: string, overrides: Partial<InlineContext> = {}) {
  const { doc, warnings } = parseMarkdown(source)
  const prose = (doc.sections[0]?.blocks ?? []).filter((block) => block.kind === 'prose')
  if (prose.length === 0) throw new Error('no prose block to render')
  const context: InlineContext = {
    slugs: new Set<string>(),
    fileExtensions: DEFAULT_FILE_EXTENSIONS,
    entities: true,
    ...(doc.linkDefinitions === undefined ? {} : { linkDefinitions: doc.linkDefinitions }),
    ...overrides,
  }
  const { container } = render(
    <>
      {prose.map((block, blockIndex) => (
        <p key={blockIndex}>
          {block.kind === 'prose' &&
            block.node.children.map((child, index) => renderInline(child, index, context))}
        </p>
      ))}
    </>,
  )
  return {
    container,
    warnings: warnings.filter((warning) => warning.code !== 'derive'),
    doc,
    links: Array.from(container.querySelectorAll('a')),
  }
}

describe('M3.0a a resolved reference link is a real link', () => {
  it("carries the URL from the document's own definition", () => {
    const { links } = renderFirstProse(WITH_REFERENCES)
    const spec = links.find((link) => link.textContent === 'the specification')
    expect(spec).toBeDefined()
    expect(spec?.getAttribute('href')).toBe('https://example.com/spec.md')
  })

  it("carries the definition's title, since the node has none of its own", () => {
    const { links } = renderFirstProse(WITH_REFERENCES)
    const spec = links.find((link) => link.textContent === 'the specification')
    expect(spec?.getAttribute('title')).toBe('The specification')
  })

  it('an external reference opens in a new tab, like any other external link', () => {
    const { links } = renderFirstProse(WITH_REFERENCES)
    const spec = links.find((link) => link.textContent === 'the specification')
    expect(spec?.getAttribute('target')).toBe('_blank')
    expect(spec?.getAttribute('rel')).toBe('noreferrer noopener')
  })

  it('a reference to an internal anchor still resolves in-app', () => {
    const source = [
      '# T',
      '',
      '## Here',
      '',
      'Jump to [there][anchor].',
      '',
      '[anchor]: #there',
      '',
      '## There',
      '',
      'text',
    ].join('\n')
    const { container } = renderFirstProse(source, { slugs: new Set(['there']) })
    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('#there')
    expect(link?.className).toContain('inline-link--internal')
  })

  it('a resolved reference produces no dev-mode warning', () => {
    expect(renderFirstProse(WITH_REFERENCES).warnings).toEqual([])
  })

  it('an identifier match is case-insensitive, like a GitHub anchor', () => {
    const source = [
      '# T',
      '',
      '## S',
      '',
      'See [the label][SPEC].',
      '',
      '[spec]: https://example.com/s.md',
      '',
    ].join('\n')
    expect(renderFirstProse(source).links[0]?.getAttribute('href')).toBe('https://example.com/s.md')
  })
})

describe('M3.0a an unresolved reference keeps its words', () => {
  it('a definition-less reference is literal text, per CommonMark, and reads as itself', () => {
    const { container, links } = renderFirstProse(WITH_REFERENCES)
    // CommonMark does not parse `[a][b]` as a link at all when `b` is undefined,
    // so the parser hands the renderer plain text. The requirement is the one
    // that matters either way: the author's words are on the page.
    expect(container.textContent).toContain('[the missing target][nowhere]')
    expect(links.some((link) => link.textContent === 'the missing target')).toBe(false)
  })

  it('a reference whose definition is nested still keeps its label', () => {
    // The genuinely unresolved case. CommonMark resolves the link, so mdast emits
    // a `linkReference` node — but the definition sits inside a blockquote, not on
    // the root, so `Doc.linkDefinitions` never sees it. The renderer must degrade
    // to the label rather than delete the words (§6.4's rule, applied to
    // references). A link to a definition nobody can see is worse than text.
    const source = ['# T', '', '## S', '', '> [q]: https://example.com/q.md', '', 'See [the label][q].', ''].join(
      '\n',
    )
    const { container, links, doc } = renderFirstProse(source)
    expect(doc.linkDefinitions?.['q']).toBeUndefined()
    expect(container.textContent).toContain('the label')
    expect(links).toHaveLength(0)
  })
})


describe('M3.0a a definition is metadata, not a block', () => {
  it('produces no block in the section that declares it', () => {
    const section = parseFixture('edge-cases').doc.sections.find(
      (entry) => entry.slug === 'reference-style-links',
    )
    expect(section).toBeDefined()
    // Exactly the two prose paragraphs the section reads as, and nothing else.
    expect(section?.blocks.map((block) => block.kind)).toEqual(['prose', 'prose'])
  })

  it('leaves no empty html block anywhere in that document', () => {
    for (const section of parseFixture('edge-cases').doc.sections) {
      const empty = section.blocks.filter((block) => block.kind === 'html' && block.value.trim() === '')
      expect(empty, `${section.slug} rendered an empty html block`).toEqual([])
    }
  })

  it('still collects the definitions onto the Doc, so the links resolve', () => {
    expect(parseFixture('edge-cases').doc.linkDefinitions?.['spec']?.url).toBe(
      'https://example.com/spec.md',
    )
  })

  it('a document that declares definitions nobody references is still consistent', () => {
    const { doc, warnings } = parseMarkdown('## S\n\n[unused]: https://example.com/a.md\n')
    // The one warning this earns is `derive` (a one-section document is below the
    // §6.7 threshold), which is the threshold working — not a definition problem.
    expect(warnings.map((warning) => warning.code)).toEqual(['derive'])
    expect(doc.sections[0]?.blocks).toEqual([])
    expect(doc.linkDefinitions?.['unused']?.url).toBe('https://example.com/a.md')
  })

  it('a definition in the introduction is not a block of the introduction', () => {
    const { doc } = parseMarkdown('[top]: https://example.com/b.md\n\n# T\n\nSee [the label][top].\n')
    expect(doc.linkDefinitions?.['top']?.url).toBe('https://example.com/b.md')
    expect(doc.intro.map((block) => block.kind)).toEqual(['prose'])
  })
})

describe('M3.0a a chip inside a reference label survives', () => {
  it('the file path in the label becomes a chip, not deleted text', () => {
    // The exact shape the stranger round reported:
    // ``See [`contributing.md`][contrib]``.
    const source = [
      '# T',
      '',
      '## S',
      '',
      'See [`docs/plan.md`][plan] for the schedule.',
      '',
      '[plan]: https://example.com/plan.md',
      '',
    ].join('\n')
    const { container } = renderFirstProse(source)
    const chip = container.querySelector('.entity-chip')
    expect(chip, 'the chip inside the reference label was deleted').not.toBeNull()
    expect(chip?.textContent).toBe('docs/plan.md')
    // The chip lives inside the link, so the label is not merely restored but
    // interactive — the same as it would be in a plain inline link.
    expect(container.querySelector('a .entity-chip')).not.toBeNull()
  })
})
