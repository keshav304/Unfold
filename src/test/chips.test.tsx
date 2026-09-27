/**
 * M2.7 — entity chips and popovers (spec §6.5, §7.5).
 *
 * The recurring question in every test here is *where a chip may appear*. The
 * answer is fixed by §6.5 and A2: files may be chips in prose and in backticks;
 * glossary terms only in prose; nothing at all inside a fenced block. Those are
 * three different code paths, and each has its own regression.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { renderInline } from '../app/blocks/Inline'
import { POPOVER_OPEN_DELAY_MS } from '../app/components/ChipPopover'
import { parseMarkdown } from './fixtures'
import { renderFixture } from './render-helpers'
import { BlockView } from '../app/blocks/BlockView'
import { ChipPopover } from '../app/components/ChipPopover'
import { DEFAULT_FILE_EXTENSIONS } from '../pipeline/constants'
import type { Block } from '../pipeline/types'
import type { InlineContext } from '../app/blocks/Inline'

afterEach(cleanup)

/** Wait out the hover open delay, so a test never depends on a real clock. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, POPOVER_OPEN_DELAY_MS + 20))
  })
}

const chipsIn = (container: HTMLElement): Element[] =>
  Array.from(container.querySelectorAll('.entity-chip, .glossary-chip'))

/** A minimal inline context with one glossary term, for the rules below. */
function glossaryContext(): InlineContext {
  return {
    slugs: new Set<string>(),
    glossary: [{ term: 'Adapter', aliases: [], definition: 'A thin wrapper.' }],
    fileExtensions: DEFAULT_FILE_EXTENSIONS,
  }
}

/** The first chip for a file path, in the rendered document. */
function chipFor(container: HTMLElement, path: string): HTMLElement {
  const chip = container.querySelector(`.entity-chip[data-file="${path}"]`)
  expect(chip, `no chip for ${path}`).not.toBeNull()
  return chip as HTMLElement
}

describe('§6.5 a file path in prose is a chip', () => {
  it('renders as a real button, so a keyboard can reach it', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const chip = chipFor(container, 'src/pipeline/parse.ts')
    expect(chip.tagName).toBe('BUTTON')
    // A chip is keyboard-focusable, which is what makes §9's "popovers are
    // keyboard-focusable" true without a second code path.
    chip.focus()
    expect(document.activeElement).toBe(chip)
  })

  it('carries the path exactly as the document wrote it', async () => {
    const { container } = await renderFixture('kitchen-sink')
    // A bare path stays bare; a `path::symbol` reference shows the whole
    // reference, because that is the text the author wrote.
    expect(chipFor(container, 'docs/spec.md').textContent).toBe('docs/spec.md')
    expect(chipFor(container, 'src/pipeline/parse.ts').textContent).toBe('src/pipeline/parse.ts::buildDoc')
  })

  it('a `path::symbol` chip carries the symbol', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const chip = container.querySelector('.entity-chip[data-symbol="buildDoc"]')
    expect(chip).not.toBeNull()
    expect(chip?.getAttribute('data-file')).toBe('src/pipeline/parse.ts')
    // The document wrote the whole reference, so the chip shows all of it.
    expect(chip?.textContent).toBe('src/pipeline/parse.ts::buildDoc')
  })

  it('a test-id chip is marked as one', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const chip = container.querySelector('.entity-chip[data-test-id]')
    expect(chip).not.toBeNull()
    expect(chip?.getAttribute('data-file')).toBe('tests/parse.test.ts')
  })
})

describe('A2 a chip inside backticks is the chip', () => {
  it('an inline code span naming a file renders a chip, not plain code', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const code = Array.from(container.querySelectorAll('code.inline-code')).find((node) =>
      node.textContent?.includes('slug.ts'),
    )
    expect(code).not.toBeNull()
    // The mono pill *is* the chip: the button lives inside the code span.
    expect(code?.querySelector('.entity-chip')).not.toBeNull()
  })

  it('a span that is not a file stays plain code', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const code = Array.from(container.querySelectorAll('code.inline-code')).find((node) =>
      node.textContent?.includes('npm ci'),
    )
    expect(code?.textContent).toBe('npm ci')
    expect(code?.querySelector('.entity-chip')).toBeNull()
  })
})

describe('A3 a chip inside a table cell survives the cell', () => {
  it('the cell renders through the inline pipeline, not as flattened text', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const cell = Array.from(container.querySelectorAll('.reader-table td')).find((node) =>
      node.textContent?.includes('npm ci'),
    )
    expect(cell).not.toBeNull()
    // `npm ci` is not a file path, so it stays a plain code span — the cell
    // still went through the inline renderer rather than being flattened.
    expect(cell?.querySelector('code.inline-code')).not.toBeNull()
  })

  it('a file path written in a cell becomes a chip in that cell', () => {
    // Driven from markdown through the real pipeline and the real block
    // renderer, because the point of A3 is that a cell is prose — and the
    // fixtures are frozen (their golden snapshots are committed), so this case
    // is built here rather than added to one.
    const { doc } = parseMarkdown(['# T', '', '| Ref |', '| --- |', '| `src/app/a.ts` |'].join('\n'))
    const table = doc.intro.find((block) => block.kind === 'table')
    expect(table?.kind).toBe('table')

    const { container } = render(
      <BlockView
        block={table as Block}
        context={{ slugs: new Set<string>(), entities: true, fileExtensions: DEFAULT_FILE_EXTENSIONS }}
      />,
    )
    const cell = container.querySelector('td')
    expect(cell?.querySelector('.entity-chip')?.getAttribute('data-file')).toBe('src/app/a.ts')
  })

  it('and a chip in a cell is portalled out of the clipping wrapper', async () => {
    const { doc } = parseMarkdown(['# T', '', '| Ref |', '| --- |', '| `src/app/a.ts` |'].join('\n'))
    const table = doc.intro.find((block) => block.kind === 'table') as Block
    const { container } = render(
      <BlockView
        block={table}
        context={{ slugs: new Set<string>(), entities: true, fileExtensions: DEFAULT_FILE_EXTENSIONS }}
      />,
    )
    const chip = container.querySelector('.reader-table-scroll .entity-chip') as HTMLElement
    expect(chip).not.toBeNull()
    await act(async () => {
      chip.focus()
    })
    // The card is a child of <body>, so the `overflow-x: auto` table wrapper
    // cannot clip it. This is the whole reason the popover is portalled.
    const card = document.querySelector('.popover')
    expect(card?.closest('.reader-table-scroll')).toBeNull()
    expect(card?.parentElement).toBe(document.body)
  })
})

describe('§6.5 nothing inside a fenced block is ever a chip', () => {
  it('a path inside a ``` fence stays code', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const python = Array.from(container.querySelectorAll('.code-block')).find(
      (block) => block.getAttribute('data-lang') === 'python',
    )
    expect(python?.textContent).toContain('build_doc')
    expect(python?.querySelector('.entity-chip')).toBeNull()
  })

  it('a plain inline span is not a chip without the entities capability', () => {
    // The gate is the capability, not the text: same input, no context.
    const node = { type: 'inlineCode', value: 'src/pipeline/parse.ts' } as const
    const { container } = render(<div>{renderInline(node, 0, { slugs: new Set<string>(), fileExtensions: DEFAULT_FILE_EXTENSIONS })}</div>)
    expect(container.querySelector('.entity-chip')).toBeNull()
  })
})

describe('§6.5 a glossary term is a word-bounded, case-insensitive chip', () => {
  it('a term in prose is a chip, with the term recorded on it', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const chip = container.querySelector('.glossary-chip[data-term="Measurement Run"]')
    expect(chip).not.toBeNull()
  })

  it('a term inside backticks is NOT a chip — A2 keeps glossary prose-only', () => {
    const node = { type: 'inlineCode', value: 'Adapter' } as const
    const { container } = render(<div>{renderInline(node, 0, glossaryContext())}</div>)
    expect(container.querySelector('.glossary-chip')).toBeNull()
    expect(container.querySelector('code')).not.toBeNull()
  })

  it('a similar-but-unrelated word is not a chip', () => {
    const node = { type: 'text', value: 'Adapterly and preadapter.' } as const
    const { container } = render(<div>{renderInline(node, 0, glossaryContext())}</div>)
    expect(container.querySelector('.glossary-chip')).toBeNull()
  })

  it('matching is case-insensitive and shows the text as written', () => {
    const node = { type: 'text', value: 'an ADAPTER here' } as const
    const { container } = render(<div>{renderInline(node, 0, glossaryContext())}</div>)
    expect(container.querySelector('.glossary-chip')?.textContent).toBe('ADAPTER')
  })

  it('an alias is a chip too, and resolves to its parent term', () => {
    const context: InlineContext = {
      slugs: new Set<string>(),
      glossary: [{ term: 'Measurement Run', aliases: ['MR'], definition: 'One run.' }],
      fileExtensions: DEFAULT_FILE_EXTENSIONS,
    }
    const node = { type: 'text', value: 'one MR per pass' } as const
    const { container } = render(<div>{renderInline(node, 0, context)}</div>)
    const chip = container.querySelector('.glossary-chip')
    expect(chip?.textContent).toBe('MR')
    // The alias is written; the term is what the chip points at.
    expect(chip?.getAttribute('data-term')).toBe('Measurement Run')
    expect(chip?.getAttribute('data-alias')).toBe('true')
  })
})

describe('§7.5 the popover opens on hover and on focus', () => {
  it('hover opens it, but not before the delay', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const anchor = chipFor(container, 'src/pipeline/parse.ts').closest('.chip-anchor') as HTMLElement

    fireEvent.mouseEnter(anchor)
    // Not yet: the delay is deliberate, so a passing cursor does not flash a card.
    expect(document.querySelector('.popover')).toBeNull()
    await settle()
    expect(document.querySelector('.popover')).not.toBeNull()
  })

  it('keyboard focus opens it immediately, with no delay', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const chip = chipFor(container, 'src/pipeline/parse.ts')
    await act(async () => {
      chip.focus()
    })
    // Focus is a deliberate act, so it does not wait.
    expect(document.querySelector('.popover')).not.toBeNull()
  })

  it('pointer-leave dismisses it', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const chip = chipFor(container, 'src/pipeline/parse.ts')
    const anchor = chip.closest('.chip-anchor') as HTMLElement
    await act(async () => {
      chip.focus()
    })
    expect(document.querySelector('.popover')).not.toBeNull()
    await act(async () => {
      fireEvent.mouseLeave(anchor)
    })
    expect(document.querySelector('.popover')).toBeNull()
  })

  it('Esc dismisses it and returns focus to the chip', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const chip = chipFor(container, 'src/pipeline/parse.ts')
    await act(async () => {
      chip.focus()
    })
    expect(document.querySelector('.popover')).not.toBeNull()
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(document.querySelector('.popover')).toBeNull()
    expect(document.activeElement).toBe(chip)
  })
})

describe('§7.5 the popover is portalled out of the clipping table wrapper', () => {
  it('the card is a child of <body>, not of the chip or the cell', async () => {
    // A chip inside a table cell sits in `overflow-x: auto`, which clips an
    // absolutely positioned card. The card must be portalled and positioned
    // fixed. The table-driven proof is in the A3 block above; this is the same
    // rule stated for a chip in ordinary prose.
    const { container } = await renderFixture('kitchen-sink')
    const chip = chipFor(container, 'docs/spec.md')
    await act(async () => {
      chip.focus()
    })
    const card = document.querySelector('.popover')
    expect(card).not.toBeNull()
    expect(card?.parentElement).toBe(document.body)
    expect((card as HTMLElement).style.position).toBe('fixed')
  })
})

describe('§7.5 a popover shows only what the document supports', () => {
  it('with an empty descriptions map it shows no description at all', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const chip = chipFor(container, 'src/pipeline/entities.ts')
    await act(async () => {
      chip.focus()
    })
    // Empty by default (§7.5), so there is no description paragraph to render.
    expect(document.querySelector('.popover__description')).toBeNull()
  })

  it('a configured description appears, and only for a configured entity', async () => {
    const { container } = await renderFixture('kitchen-sink', {
      descriptions: { 'src/pipeline/parse.ts': 'Turns markdown into the document model.' },
    })
    const described = chipFor(container, 'src/pipeline/parse.ts')
    await act(async () => {
      described.focus()
    })
    expect((document.querySelector('.popover__description') as HTMLElement).textContent).toBe(
      'Turns markdown into the document model.',
    )

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    const undescribed = chipFor(container, 'src/pipeline/entities.ts')
    await act(async () => {
      undescribed.focus()
    })
    expect(document.querySelector('.popover__description')).toBeNull()
  })

  it('a glossary card carries the document’s own definition', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const chip = container.querySelector('.glossary-chip[data-term="Measurement Run"]') as HTMLElement
    expect(chip).not.toBeNull()
    await act(async () => {
      chip.focus()
    })
    const definition = document.querySelector('.popover__definition') as HTMLElement
    await waitFor(() => expect(definition).not.toBeNull())
    // The definition is the document's own first paragraph, quoted from it.
    expect(definition.textContent).toContain('frozen query plan')
  })

  it('it never lists the section the chip is in as a mention of itself', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const chip = chipFor(container, 'src/pipeline/entities.ts')
    const section = chip.closest('[data-slug]') as HTMLElement
    const heading = section.querySelector('.reader-heading')?.textContent ?? ''
    await act(async () => {
      chip.focus()
    })
    const links = Array.from(document.querySelectorAll('.popover__link')).map((n) => n.textContent)
    expect(links).not.toContain(heading)
  })

  it('a card lists the sections that mention the entity', async () => {
    // Driven directly, because no fixture happens to mention one file from two
    // sections: the backlink list is the interesting part, not the fixture.
    const seen: string[] = []
    render(
      <ChipPopover
        target={{ kind: 'file', path: 'src/a.ts' }}
        sectionSlug="here"
        backlinks={[
          { slug: 'here', title: 'This section' },
          { slug: 'elsewhere', title: 'Somewhere else' },
        ]}
        onNavigate={(slug) => seen.push(slug)}
      >
        <button type="button">chip</button>
      </ChipPopover>,
    )
    await act(async () => {
      (document.querySelector('.chip-anchor button') as HTMLElement).focus()
    })
    const links = Array.from(document.querySelectorAll('.popover__link')).map((n) => n.textContent)
    // The chip's own section is not a "mention elsewhere" of itself.
    expect(links).toEqual(['Somewhere else'])
    await act(async () => {
      fireEvent.click(document.querySelector('.popover__link') as HTMLElement)
    })
    expect(seen).toEqual(['elsewhere'])
    expect(document.querySelector('.popover')).toBeNull()
  })

  it('a card with no description and no other mention says so, rather than staying empty', async () => {
    render(
      <ChipPopover
        target={{ kind: 'file', path: 'src/a.ts' }}
        sectionSlug="here"
        backlinks={[]}
        onNavigate={() => {}}
      >
        <button type="button">chip</button>
      </ChipPopover>,
    )
    await act(async () => {
      (document.querySelector('.chip-anchor button') as HTMLElement).focus()
    })
    // An empty card over the reader's text would be the clearest possible lie.
    expect(document.querySelector('.popover__links')).toBeNull()
    expect(document.querySelector('.popover__empty')?.textContent).toContain('Not mentioned anywhere else')
  })
})

describe('a reference link keeps its text and its href (found by the stranger round)', () => {
  it('[label][ref] renders as a link, not as nothing', () => {
    // The stranger round found this: a `linkReference` has no `value`, so it
    // fell through to the default branch and the author's text vanished.
    const { doc } = parseMarkdown(
      ['See [`src/a.ts`][ref] for detail.', '', '[ref]: https://example.com/a'].join('\n'),
    )
    const block = doc.intro.find((entry) => entry.kind === 'prose')
    expect(block?.kind).toBe('prose')
    const { container } = render(
      <BlockView
        block={block as Block}
        context={{
          slugs: new Set<string>(),
          entities: true,
          fileExtensions: DEFAULT_FILE_EXTENSIONS,
          ...(doc.linkDefinitions === undefined ? {} : { linkDefinitions: doc.linkDefinitions }),
        }}
      />,
    )
    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://example.com/a')
    // And the text survived — including the file chip inside the label.
    expect(link?.textContent).toContain('src/a.ts')
    expect(container.querySelector('.entity-chip')?.getAttribute('data-file')).toBe('src/a.ts')
  })

  it('an unresolved reference keeps its label as plain text', () => {
    const { doc } = parseMarkdown('See [the docs][missing] for detail.')
    const block = doc.intro.find((entry) => entry.kind === 'prose')
    const { container } = render(
      <BlockView
        block={block as Block}
        context={{ slugs: new Set<string>(), entities: true, fileExtensions: DEFAULT_FILE_EXTENSIONS }}
      />,
    )
    // Dropping the words is never the answer (§1.3: degrade, never blank).
    expect(container.textContent).toContain('the docs')
    expect(container.querySelector('a')).toBeNull()
  })
})

describe('§1.1 a document with no entities renders no chips at all', () => {
  it('minimal has none', async () => {
    const { container } = await renderFixture('minimal')
    expect(chipsIn(container)).toHaveLength(0)
  })

  it('no-structure has none', async () => {
    const { container } = await renderFixture('no-structure')
    expect(chipsIn(container)).toHaveLength(0)
  })

  it('kitchen-sink does have both chip families', async () => {
    const { container } = await renderFixture('kitchen-sink')
    expect(container.querySelectorAll('.entity-chip').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.glossary-chip').length).toBeGreaterThan(0)
  })
})