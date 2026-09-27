/**
 * M4.1 — the reading mode as *state* (spec §7.8), end to end in jsdom.
 *
 * The heuristic itself is in `reading-mode.test.ts`. What is here is the half
 * that only a whole-app render can see: that the header toggle, the palette row
 * and the per-section override all move the same mode, and that the mode is
 * persisted rather than recomputed.
 *
 * The A4 test in `palette.test.tsx` used to assert that no reading-mode row
 * existed, naming M4.1 as the milestone that would build it. That assertion is
 * now inverted there, and this file is where the row's *behaviour* is proven —
 * a row that renders and does nothing would satisfy the old test perfectly.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderFixture } from './render-helpers'
import { MODE_STORAGE_KEY } from '../app/modes/reading-mode'

afterEach(cleanup)
beforeEach(() => {
  // jsdom keeps one window per file, and the App seeds its route from the hash.
  window.location.hash = ''
  // The mode is persisted, so without this a test's choice becomes the next
  // test's starting mode — the same class of leak the hash reset above prevents.
  window.localStorage.clear()
})

const toggle = (): HTMLElement => screen.getByRole('button', { name: 'Executive mode' })

/** Block kinds rendered inside one section, in document order. */
function sectionBlocks(container: HTMLElement, slug: string): string[] {
  const section = sectionOf(container, slug)
  return Array.from(section.children)
    .filter((node) => !node.classList.contains('reader-heading') && !node.classList.contains('section-expand'))
    .map((node) => node.className.split(' ')[0] as string)
}

function sectionOf(container: HTMLElement, slug: string): HTMLElement {
  const section = container.querySelector(`[data-slug="${slug}"]`)
  if (section === null) throw new Error(`no section ${slug}`)
  return section as HTMLElement
}

/**
 * The override button on one section — a **direct child** lookup.
 *
 * `within(section).getByRole(...)` looks at the whole subtree, and an H2
 * contains its H3s, so asking the H2 for "Show all" finds the H3s' buttons too.
 * The button that controls *this* section is the one this section renders.
 */
function expandButton(container: HTMLElement, slug: string): HTMLButtonElement {
  const own = Array.from(sectionOf(container, slug).children).find(
    (node) => node.classList.contains('section-expand'),
  )
  if (own === undefined) throw new Error(`section ${slug} has no override button`)
  return own as HTMLButtonElement
}

describe('§7.8 the header toggle switches the whole reader', () => {
  it('starts unpressed, in reference mode, showing everything', async () => {
    const { container } = await renderFixture('kitchen-sink')
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(container.querySelector('.reader')).toHaveAttribute('data-reading-mode', 'reference')
    // The H2 that holds a terminal, a loop, a mermaid and two code blocks.
    expect(sectionBlocks(container, 'runtime-shape').length).toBeGreaterThan(4)
  })

  it('pressing it reduces the sections and marks the button pressed', async () => {
    const { container } = await renderFixture('kitchen-sink')
    fireEvent.click(toggle())
    await waitFor(() =>
      expect(container.querySelector('.reader')).toHaveAttribute('data-reading-mode', 'executive'),
    )
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    const blocks = sectionBlocks(container, 'runtime-shape')
    // §7.8 keeps the lead paragraph, tables and blockquotes; the terminal, loop,
    // mermaid and code blocks are gone.
    for (const gone of ['terminal', 'loop', 'mermaid', 'code-block']) {
      expect(blocks, `${gone} survived executive mode`).not.toContain(gone)
    }
    expect(blocks.length).toBeLessThan(4)
  })

  it('pressing it again restores the document exactly', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const before = sectionBlocks(container, 'runtime-shape')
    fireEvent.click(toggle())
    await waitFor(() =>
      expect(container.querySelector('.reader')).toHaveAttribute('data-reading-mode', 'executive'),
    )
    fireEvent.click(toggle())
    await waitFor(() =>
      expect(container.querySelector('.reader')).toHaveAttribute('data-reading-mode', 'reference'),
    )
    expect(sectionBlocks(container, 'runtime-shape')).toEqual(before)
  })

  it('it persists, and a fresh mount comes back in the mode it was left in', async () => {
    await renderFixture('kitchen-sink')
    fireEvent.click(toggle())
    await waitFor(() => expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe('executive'))

    cleanup()
    const { container } = await renderFixture('kitchen-sink')
    // The *first* render is already executive: the mode is read in a state
    // initialiser, so a returning reader never sees the long version flash past.
    expect(container.querySelector('.reader')).toHaveAttribute('data-reading-mode', 'executive')
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
  })

  it('the mode is not in the hash — the address bar belongs to the view (§7.1)', async () => {
    await renderFixture('kitchen-sink')
    fireEvent.click(toggle())
    await waitFor(() => expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe('executive'))
    expect(window.location.hash).toBe('')
  })
})

describe('§9 every header control has an accessible name of its own', () => {
  // A regression test for a defect M4.1 introduced. The <768px collapse hides
  // the search trigger's word and its `⌘K` hint with `display: none`, which
  // removes them from the accessibility tree — so a name that lived only inside
  // a child span went with them and the button became nameless. Lighthouse found
  // it because it audits at a mobile viewport, which is the only width where the
  // bug exists; the unit suite renders at no viewport at all, so it cannot see a
  // media query and must assert the *property* instead.
  const NAMED = ['app-menu', 'mode-toggle', 'app-search']

  it.each(NAMED)('.%s names itself, and does not borrow the name from a child', async (className) => {
    const { container } = await renderFixture('kitchen-sink')
    const button = container.querySelector(`.${className}`) as HTMLElement
    expect(button, `.${className} is missing`).not.toBeNull()
    // An explicit label is what survives a stylesheet that hides a child.
    expect(
      button.getAttribute('aria-label'),
      `.${className} has no aria-label, so hiding a child would make it nameless`,
    ).toMatch(/\S/u)
  })

  it('the switcher and the segmented control name their group', async () => {
    const { container } = await renderFixture('kitchen-sink')
    expect(container.querySelector('.view-switcher')?.getAttribute('aria-label')).toBe('View')
    expect(container.querySelector('.workbench-tabs')?.getAttribute('aria-label')).toBe('Workbench pane')
  })
})

describe('§7.8 the per-section "show all" override', () => {
  it('appears only on a section that lost something', async () => {
    const { container } = await renderFixture('kitchen-sink')
    // Reference mode: no section is reduced, so no override renders anywhere
    // (A4 — a control that reveals nothing is not a control).
    expect(container.querySelectorAll('.section-expand')).toHaveLength(0)

    fireEvent.click(toggle())
    await waitFor(() => expect(container.querySelectorAll('.section-expand').length).toBeGreaterThan(0))

    // `crosslinked` has nothing to reduce anywhere; `kitchen-sink` does. The
    // button count must therefore be *fewer* than the section count, not equal.
    const sections = container.querySelectorAll('.reader-section').length
    expect(container.querySelectorAll('.section-expand').length).toBeLessThan(sections)
  })

  it('reveals that one section, and leaves the others reduced', async () => {
    const { container } = await renderFixture('kitchen-sink')
    fireEvent.click(toggle())
    await waitFor(() => expect(container.querySelectorAll('.section-expand').length).toBeGreaterThan(0))

    const before = sectionBlocks(container, 'runtime-shape')
    const section = sectionOf(container, 'runtime-shape')
    const button = expandButton(container, 'runtime-shape')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button.textContent).toBe('Show all')

    fireEvent.click(button)
    await waitFor(() => expect(sectionBlocks(container, 'runtime-shape').length).toBeGreaterThan(before.length))
    expect(section).toHaveAttribute('data-expanded', 'true')
    // And the button becomes the way back, rather than disappearing.
    const back = expandButton(container, 'runtime-shape')
    expect(back.textContent).toBe('Show less')
    expect(back).toHaveAttribute('aria-expanded', 'true')
    // A sibling section is untouched by its neighbour's override.
    expect(sectionOf(container, 'operational-notes')).toHaveAttribute('data-expanded', 'false')
  })

  it('leaving executive mode forgets the overrides', async () => {
    const { container } = await renderFixture('kitchen-sink')
    fireEvent.click(toggle())
    await waitFor(() => expect(container.querySelectorAll('.section-expand').length).toBeGreaterThan(0))
    const section = sectionOf(container, 'runtime-shape')
    fireEvent.click(expandButton(container, 'runtime-shape'))
    await waitFor(() => expect(section).toHaveAttribute('data-expanded', 'true'))

    fireEvent.click(toggle())
    await waitFor(() =>
      expect(container.querySelector('.reader')).toHaveAttribute('data-reading-mode', 'reference'),
    )
    // Back to reference: every section shows everything, so every override is
    // gone rather than left switched on behind a control that no longer exists.
    expect(container.querySelectorAll('.section-expand')).toHaveLength(0)
  })
})

describe('§7.8 the palette offers the mode it is not in', () => {
  const modeRow = (container: HTMLElement): Element | null =>
    container.querySelector('[data-action^="mode:"]')

  const openPalette = async (container: HTMLElement): Promise<void> => {
    fireEvent.click(container.querySelector('.app-search') as HTMLButtonElement)
    await screen.findByRole('combobox')
    await waitFor(() => expect(container.querySelectorAll('.palette-item').length).toBeGreaterThan(0))
  }

  it('in reference mode it offers executive, and running it switches', async () => {
    const { container } = await renderFixture('kitchen-sink')
    await openPalette(container)
    const row = modeRow(container) as HTMLElement
    expect(row.textContent).toBe('Switch to executive mode')
    fireEvent.click(row)
    await waitFor(() =>
      expect(container.querySelector('.reader')).toHaveAttribute('data-reading-mode', 'executive'),
    )
    // And the palette closed, like every other action row.
    await waitFor(() => expect(container.querySelector('.palette')).toBeNull())
  })

  it('in executive mode it offers the way back, never the mode already on', async () => {
    const { container } = await renderFixture('kitchen-sink')
    fireEvent.click(toggle())
    await waitFor(() =>
      expect(container.querySelector('.reader')).toHaveAttribute('data-reading-mode', 'executive'),
    )
    await openPalette(container)
    expect(modeRow(container)?.textContent).toBe('Switch to reference mode')
  })

  it('it is offered for a document with no capabilities at all', async () => {
    // Not capability-gated: the reading mode is not a view, and §7.8 gives it to
    // every document — including one with no sections to reduce.
    const { container } = await renderFixture('minimal')
    await openPalette(container)
    expect(modeRow(container)).not.toBeNull()
  })

  it('a query steps it aside, exactly as it does the view rows', async () => {
    const { container } = await renderFixture('kitchen-sink')
    await openPalette(container)
    expect(modeRow(container)).not.toBeNull()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'operational' } })
    await waitFor(() => expect(modeRow(container)).toBeNull())
  })
})
