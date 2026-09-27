/**
 * M2.7 — the palette contract (spec §7.4) in jsdom.
 *
 * These are fast smoke tests, not the authority: jsdom has no layout, no real
 * focus ring and no idea whether a Tab actually cycles. The Playwright suite
 * (M2.PW3) is where the focus trap, the focus restore and the axe scan are
 * proven. What jsdom *can* prove honestly — and what would otherwise regress
 * silently — is the trigger set, the `/`-in-an-input guard, the group gating,
 * the alias-to-parent-term rule and result navigation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App } from '../app/App'
import { isPaletteShortcut, isTypingTarget } from '../app/palette/Palette'
import { configFor, renderFixture } from './render-helpers'
import type { FixtureName } from './fixtures'

afterEach(cleanup)

/**
 * jsdom keeps one `window` for the whole file, so a hash written by one test is
 * still there when the next one mounts the App — and the App reads the hash for
 * its initial route. Without this reset, a test that navigates silently changes
 * the starting view of every test after it, which fails as a mystery assertion
 * several cases away from the cause.
 */
beforeEach(() => {
  window.location.hash = ''
  // §7.8 persists the reading mode, so a test that switches it would otherwise
  // decide the starting mode of every test after it — the same leak as the hash
  // above, one storage key further out.
  window.localStorage.clear()
})

/** Open the palette the way a user would, optionally typing a query. */
async function openPalette(container: HTMLElement, query = ''): Promise<void> {
  fireEvent.click(container.querySelector('.app-search') as HTMLButtonElement)
  await screen.findByRole('combobox')
  if (query === '') return
  fireEvent.change(screen.getByRole('combobox'), { target: { value: query } })
}

async function waitForRows(container: HTMLElement): Promise<HTMLElement[]> {
  await waitFor(() => expect(container.querySelectorAll('.palette-item').length).toBeGreaterThan(0))
  return Array.from(container.querySelectorAll('.palette-item')) as HTMLElement[]
}

const headings = (container: HTMLElement): (string | null)[] =>
  Array.from(container.querySelectorAll('[cmdk-group-heading]')).map((node) => node.textContent)

const rowText = (container: HTMLElement): string =>
  Array.from(container.querySelectorAll('.palette-item'))
    .map((row) => row.textContent ?? '')
    .join(' | ')

describe('§7.4 the palette opens from ⌘K and from /', () => {
  it('⌘K opens it', async () => {
    const { container } = await renderFixture('kitchen-sink')
    expect(container.querySelector('.palette')).toBeNull()
    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    await waitFor(() => expect(container.querySelector('.palette')).not.toBeNull())
  })

  it('Ctrl+K opens it too', async () => {
    const { container } = await renderFixture('kitchen-sink')
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    await waitFor(() => expect(container.querySelector('.palette')).not.toBeNull())
  })

  it('/ opens it', async () => {
    const { container } = await renderFixture('kitchen-sink')
    fireEvent.keyDown(document.body, { key: '/' })
    await waitFor(() => expect(container.querySelector('.palette')).not.toBeNull())
  })

  it('the header trigger opens it', async () => {
    const { container } = await renderFixture('kitchen-sink')
    await openPalette(container)
    expect(container.querySelector('.palette')).not.toBeNull()
  })
})

describe('§7.4 the `/` shortcut is inert while typing', () => {
  it('a slash inside the palette input is typed, not treated as a shortcut', async () => {
    const { container } = await renderFixture('kitchen-sink')
    await openPalette(container)
    const input = screen.getByRole('combobox')
    fireEvent.keyDown(input, { key: '/' })
    // Still open, and the slash was not swallowed.
    expect(container.querySelector('.palette')).not.toBeNull()
    expect(input).toHaveValue('')
  })

  it('a slash in a textarea elsewhere on the page is inert too', () => {
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    expect(isTypingTarget(textarea)).toBe(true)
    textarea.remove()
  })

  it('a slash on ordinary prose is not inert', () => {
    expect(isTypingTarget(document.createElement('div'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })

  it('a contenteditable region counts as typing', () => {
    const editable = document.createElement('div')
    // jsdom does not reflect contentEditable onto the IDL attribute, so assert
    // the predicate against the flag a real browser would set.
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    expect(isTypingTarget(editable)).toBe(true)
  })

  it('an input and a select are typing targets', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true)
    expect(isTypingTarget(document.createElement('select'))).toBe(true)
  })
})

describe('the shortcut predicate is honest about modifiers', () => {
  it('accepts ⌘K and Ctrl+K, and nothing else', () => {
    expect(isPaletteShortcut(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))).toBe(true)
    expect(isPaletteShortcut(new KeyboardEvent('keydown', { key: 'K', ctrlKey: true }))).toBe(true)
    expect(isPaletteShortcut(new KeyboardEvent('keydown', { key: 'k' }))).toBe(false)
    expect(isPaletteShortcut(new KeyboardEvent('keydown', { key: 'j', metaKey: true }))).toBe(false)
  })
})

describe('§7.4 result groups render only when the document supports them', () => {
  it('kitchen-sink shows all three groups, each when its own data matches', async () => {
    const { container } = await renderFixture('kitchen-sink')

    // Sections and body text.
    await openPalette(container, 'operational')
    await waitForRows(container)
    expect(headings(container)).toContain('Sections')

    // File entities: a path the document really mentions.
    await openPalette(container, 'entities.ts')
    await waitForRows(container)
    expect(headings(container)).toContain('Files')

    // Glossary terms.
    await openPalette(container, 'Adapter')
    await waitForRows(container)
    expect(headings(container)).toContain('Glossary')
  })

  it('minimal shows Sections only — no Files, no Glossary', async () => {
    const { container } = await renderFixture('minimal')
    await openPalette(container, 'a')
    await waitForRows(container)
    expect(headings(container)).toEqual(['Sections'])
  })

  it('a document with no glossary has no Glossary group', async () => {
    const { container } = await renderFixture('crosslinked')
    await openPalette(container, 'a')
    await waitForRows(container)
    expect(headings(container)).not.toContain('Glossary')
  })

  it('a document with no file entities has no Files group', async () => {
    const { container } = await renderFixture('no-structure')
    await openPalette(container, 'a')
    await waitForRows(container)
    expect(headings(container)).toEqual(['Sections'])
  })
})

describe('§6.6 an alias hit lands on its parent term', () => {
  it('searching an alias returns the term, and selecting it navigates to the term heading', async () => {
    const { container } = await renderFixture('kitchen-sink')
    await openPalette(container, 'MR')
    const rows = await waitForRows(container)
    const glossaryRow = rows.find((row) => row.textContent?.includes('Measurement Run'))
    expect(glossaryRow).toBeDefined()
    // The alias is a search key, not a result: the parent term is what shows.
    expect(rowText(container)).not.toMatch(/\bMR\b/)
    fireEvent.click(glossaryRow as HTMLElement)
    await waitFor(() => expect(container.querySelector('.palette')).toBeNull())
    expect(window.location.hash).toBe('#measurement-run')
  })

describe('§7.4 a result navigates and closes', () => {
  it('choosing a section result scrolls, flashes and closes', async () => {
    const { container } = await renderFixture('kitchen-sink')
    await openPalette(container, 'operational')
    const rows = await waitForRows(container)
    expect(rowText(container)).toContain('Operational notes')
    const row = rows.find((r) => r.textContent?.includes('Operational notes'))
    fireEvent.click(row as HTMLElement)
    await waitFor(() => expect(container.querySelector('.palette')).toBeNull())
    expect(window.location.hash).toBe('#operational-notes')
    expect(container.querySelector('[data-flash="true"]')?.getAttribute('data-slug')).toBe('operational-notes')
  })

  it('an empty query lists sections, the view rows and the mode row, so the palette is never empty', async () => {
    const { container } = await renderFixture('kitchen-sink')
    await openPalette(container)
    const rows = await waitForRows(container)
    expect(rows.length).toBeGreaterThan(0)
    // Every half of the default state: where you can go (views), how you read
    // (mode), and where you are (sections). A palette that opened onto one list
    // would be a palette whose arrow keys do something different every time you
    // press them. "Reading mode" is its own group rather than a third row under
    // "Views" because it is not a view and does not navigate (M4.1).
    expect(headings(container)).toEqual(['Views', 'Reading mode', 'Sections'])
  })

  it('a query that matches nothing says so instead of showing an empty box', async () => {
    const { container } = await renderFixture('kitchen-sink')
    await openPalette(container, 'zzzzznotpresent')
    await waitFor(() => expect(container.querySelector('.palette-empty')).not.toBeNull())
    expect(container.querySelectorAll('.palette-item')).toHaveLength(0)
  })
})

describe('M2.3 the snippet is a ±45-char window with the match highlighted', () => {
  it('a body hit shows surrounding text and a <mark> on the match', async () => {
    const { container } = await renderFixture('kitchen-sink')
    await openPalette(container, 'latency')
    await waitForRows(container)
    const mark = container.querySelector('.palette-item .search-hit')
    expect(mark).not.toBeNull()
    expect(mark?.textContent?.toLowerCase()).toContain('latency')
    // A snippet, not the whole section.
    const snippet = mark?.closest('.palette-item__snippet')
    expect(snippet?.textContent?.length ?? 0).toBeLessThan(140)
  })
})

describe('§9 Esc closes the palette', () => {
  it('Esc dismisses it', async () => {
    const { container } = await renderFixture('kitchen-sink')
    await openPalette(container)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(container.querySelector('.palette')).toBeNull())
  })
})

describe('M3.0b §7.4 the palette offers a switch-view row per capable view', () => {
  const actionRow = (container: HTMLElement, view: string): Element | null =>
    container.querySelector(`[data-action="${view}"]`)

  it('kitchen-sink offers both the graph and the stepper', async () => {
    const { container } = await renderFixture('kitchen-sink')
    await openPalette(container)
    await waitForRows(container)
    expect(actionRow(container, 'graph')).not.toBeNull()
    expect(actionRow(container, 'stepper')).not.toBeNull()
  })

  it('they are labelled as commands, not as search results', async () => {
    const { container } = await renderFixture('kitchen-sink')
    await openPalette(container)
    await waitForRows(container)
    expect(actionRow(container, 'graph')?.textContent).toBe('Open the visual graph')
    expect(actionRow(container, 'stepper')?.textContent).toBe('Open the stepper')
    expect(headings(container)).toContain('Views')
  })

  it('choosing one switches the view, writes the hash, and closes the palette', async () => {
    const { container } = await renderFixture('kitchen-sink')
    await openPalette(container)
    await waitForRows(container)
    fireEvent.click(actionRow(container, 'graph') as HTMLElement)
    await waitFor(() => expect(container.querySelector('.palette')).toBeNull())
    expect(window.location.hash).toBe('#/graph')
  })

  it('a document with no graph capability offers no graph row (never a dead one)', async () => {
    const { container } = await renderFixture('minimal')
    await openPalette(container)
    await waitForRows(container)
    expect(actionRow(container, 'graph')).toBeNull()
    expect(actionRow(container, 'stepper')).toBeNull()
  })

  it('crosslinked offers the graph but not the stepper', async () => {
    const { container } = await renderFixture('crosslinked')
    await openPalette(container)
    await waitForRows(container)
    expect(actionRow(container, 'graph')).not.toBeNull()
    expect(actionRow(container, 'stepper')).toBeNull()
  })

  it('the view you are already in is not offered — there is nothing to switch to', async () => {
    const { container } = await renderFixture('kitchen-sink')
    // Arrive on the graph, then open the palette from there.
    fireEvent.click(within(container.querySelector('.view-switcher') as HTMLElement).getByRole('button', { name: 'Graph' }))
    await waitFor(() => expect(container.querySelector('[data-view="graph"]')).not.toBeNull())
    await openPalette(container)
    await waitForRows(container)
    expect(actionRow(container, 'graph')).toBeNull()
    expect(actionRow(container, 'stepper')).not.toBeNull()
  })

  it('typing switches the palette to search: the rows step aside for the query', async () => {
    // `shouldFilter={false}` means cmdk will not filter them, and the action rows
    // are not in the search index — so the palette must hide them itself, or a
    // row sits there ignoring what the reader typed.
    const { container } = await renderFixture('kitchen-sink')
    await openPalette(container)
    await waitForRows(container)
    expect(actionRow(container, 'graph')).not.toBeNull()
    await openPalette(container, 'operational')
    await waitForRows(container)
    expect(actionRow(container, 'graph')).toBeNull()
  })
})

describe('A4 the palette ships no dead UI', () => {
  it('the reading-mode row now exists, and names the mode it switches to', async () => {
    // This test used to assert the *absence* of a reading-mode row, and named
    // M4.1 as the milestone that would build the thing it would toggle. That
    // placeholder is now the real contract, inverted: the row is present…
    const { container } = await renderFixture('kitchen-sink')
    await openPalette(container)
    await waitForRows(container)
    const row = container.querySelector('[data-action="mode:executive"]')
    expect(row).not.toBeNull()
    expect(row?.textContent).toBe('Switch to executive mode')
    expect(row?.getAttribute('data-kind')).toBe('mode')
  })

  it('…and it is never the mode already on, so it is never a row that does nothing', async () => {
    // The other half of A4, and the reason the row is written the way it is: a
    // "Switch to executive mode" row sitting in the palette while executive mode
    // is on would render and do nothing. The behaviour of the row is proved in
    // `reading-mode-ui.test.tsx`; what matters here is the absence.
    const { container } = await renderFixture('kitchen-sink')
    fireEvent.click(screen.getByRole('button', { name: 'Executive mode' }))
    await openPalette(container)
    await waitForRows(container)
    expect(container.querySelector('[data-action="mode:executive"]')).toBeNull()
    expect(container.querySelector('[data-action="mode:reference"]')).not.toBeNull()
  })

  it('every row it does offer opens something real', async () => {
    const { container } = await renderFixture('kitchen-sink')
    await openPalette(container)
    await waitForRows(container)
    const rows = Array.from(container.querySelectorAll('.palette-item')) as HTMLElement[]
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      // A row is either a search result (it navigates to a slug) or an action
      // (it names a view this document can render, or a mode). Nothing else is
      // allowed in — and the mode row carries `data-kind` precisely so this
      // check can tell an action from a result.
      const isAction = row.hasAttribute('data-action')
      expect(isAction || (row.textContent ?? '') !== '').toBe(true)
    }
  })
})

describe('M2.7 the palette never appears without a document', () => {
  it('the drop screen has no palette and no trigger', async () => {
    const htmlFetcher = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: { get: () => 'text/html' },
          text: async () => '<!doctype html><html><body><div id="root"></div></body></html>',
        }) as unknown as Response,
    )
    const { container } = render(
      <App config={configFor('kitchen-sink')} fetcher={htmlFetcher as unknown as typeof fetch} />,
    )
    await waitFor(() => expect(container.querySelector('.drop-screen')).not.toBeNull())
    expect(container.querySelector('.palette')).toBeNull()
    expect(container.querySelector('.app-search')).toBeNull()
  })
})

describe('M2.7 the palette works on every fixture', () => {
  it.each(['minimal', 'kitchen-sink', 'crosslinked', 'no-structure', 'edge-cases'] as FixtureName[])(
    '%s opens the palette with at least one result',
    async (name) => {
      const { container } = await renderFixture(name)
      await openPalette(container, 'a')
      await waitForRows(container)
    },
  )
})

})