/**
 * M3.8 — the §6.7 threshold boundary, wired to the states a reader actually sees.
 *
 * M0 proved the thresholds in the data: two links leave the capability off, three
 * links across three sections turn it on, an explicit block always wins. Those
 * tests read a `Doc`. This file reads the *screen* — the nav item, the view, the
 * chip — because the failure mode they cannot see is a pipeline and a view that
 * disagree: a document whose capability is on and whose view renders nothing, or
 * a nav item for a view the router will refuse.
 *
 * The three boundaries:
 *
 *   crosslinked  3 links / 3 H2s  → derived map, "Auto-generated map" chip
 *   minimal      no links          → no nav item at all, and #/graph is the reader
 *   kitchen-sink explicit block   → explicit mode, "Architecture", no chip
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App } from '../app/App'
import { configFor, renderFixture } from './render-helpers'
import { parseMarkdown } from './fixtures'

afterEach(cleanup)
beforeEach(() => {
  window.location.hash = ''
})

/**
 * The per-test budget for anything that awaits the graph chunk.
 *
 * The graph view is a `React.lazy` chunk (§10, M3.1), so reaching it means
 * resolving a dynamic import — a real module graph, including the whole of
 * React Flow. That takes well under Vitest's 5s default in isolation and well
 * over it when the full suite is running its 27 files in parallel, which is how
 * three of these failed on a green machine. A timeout here is not a flaky test;
 * it is the honest cost of testing a code-split view, and it is the same reason
 * the Playwright suite waits on state rather than on a clock.
 */
const AWAITS_CHUNK = 20_000

/**
 * Open the graph view and wait for it to actually be on screen.
 *
 * The explicit timeout is not decoration. The graph view is a `React.lazy`
 * chunk (§10, M3.1), so clicking the switcher only starts a dynamic import; under
 * the full suite's parallel load that import can take well past Testing Library's
 * 1s default, and the failure then reads as "the graph view did not render"
 * rather than as "the chunk had not loaded yet". The two are different bugs and
 * the message has to name the right one.
 */
async function openGraph(container: HTMLElement): Promise<HTMLElement> {
  const switcher = container.querySelector('.view-switcher')
  if (switcher === null) throw new Error('this document has no view switcher at all')
  fireEvent.click(within(switcher as HTMLElement).getByRole('button', { name: 'Graph' }))
  await waitFor(() => expect(container.querySelector('.app')?.getAttribute('data-view')).toBe('graph'), {
    timeout: 10_000,
  })
  await waitFor(() => expect(container.querySelector('.graph-workbench')).not.toBeNull(), {
    timeout: 10_000,
  })
  return container
}

describe('M3.8 above threshold: a derived Document map', () => {
  it('crosslinked shows a Graph nav item, because the pipeline turned it on', async () => {
    const { container } = await renderFixture('crosslinked')
    const switcher = screen.getByRole('navigation', { name: 'View' })
    expect(within(switcher).getByRole('button', { name: 'Graph' })).toBeInTheDocument()
    // And no stepper: the document has no `steps` block, so there is nothing to
    // step through. Capability gating is per view, not per document.
    expect(within(switcher).queryByRole('button', { name: 'Stepper' })).toBeNull()
    expect(container.querySelector('.app')?.getAttribute('data-view')).toBe('reader')
  })

  it('the view reads "Document map" and carries the auto-generated chip', async () => {
    const { container } = await renderFixture('crosslinked')
    await openGraph(container)
    await waitFor(() => expect(container.querySelector('.graph-workbench')).not.toBeNull())
    expect(container.querySelector('.graph-title')?.textContent).toBe('Document map')
    const chip = container.querySelector('.graph-chip')
    expect(chip?.textContent).toBe('Auto-generated map')
    expect(chip?.getAttribute('data-chip')).toBe('derived')
  }, AWAITS_CHUNK)

  it('a #/graph deep link lands on it directly', async () => {
    window.location.hash = '#/graph'
    const { container } = await renderFixture('crosslinked')
    await waitFor(() => expect(container.querySelector('.graph-title')?.textContent).toBe('Document map'), {
      timeout: AWAITS_CHUNK,
    })
  }, AWAITS_CHUNK)
})

describe('M3.8 below threshold: no graph at all', () => {
  it('minimal has no Graph nav item, because nothing in it derives a map', async () => {
    const { container } = await renderFixture('minimal')
    // Not a disabled item and not a hidden one: no switcher at all, since the
    // document is Tier 0 (§1.1).
    expect(container.querySelector('.view-switcher')).toBeNull()
    expect(container.querySelector('.workbench-tabs')).toBeNull()
  })

  it('and #/graph falls back to the reader rather than erroring or blanking', async () => {
    window.location.hash = '#/graph'
    const { container } = await renderFixture('minimal')
    await waitFor(() => expect(container.querySelector('.app')).not.toBeNull())
    expect(container.querySelector('.app')?.getAttribute('data-view')).toBe('reader')
    expect(container.querySelector('.reader')).not.toBeNull()
    expect(container.querySelector('.graph-workbench')).toBeNull()
    // The reader is the whole document, not an error card.
    expect(container.querySelector('.drop-screen')).toBeNull()
  })

  it('a document one link short of the threshold is still not graph-capable', async () => {
    // The boundary itself, built rather than borrowed: two cross-links across two
    // H2s is one below §6.7's threshold, so the capability must be off.
    const { container } = render(
      <App
        config={configFor('kitchen-sink')}
        fetcher={(async () => {
          const source = [
            '# Two links',
            '',
            '## One',
            '',
            'See [two](#two).',
            '',
            '## Two',
            '',
            'See [three](#three).',
            '',
            '## Three',
            '',
            'Nothing else links anywhere.',
            '',
          ].join('\n')
          return { ok: true, status: 200, text: async () => source } as Response
        }) as unknown as typeof fetch}
      />,
    )
    await waitFor(() => expect(container.querySelector('.app')).not.toBeNull())
    expect(container.querySelector('.view-switcher')).toBeNull()
  })

  it('one link more turns it on, at the same boundary', async () => {
    const source = [
      '# Three links',
      '',
      '## One',
      '',
      'See [two](#two) and [three](#three).',
      '',
      '## Two',
      '',
      'See [three](#three).',
      '',
      '## Three',
      '',
      'Nothing else links anywhere.',
      '',
    ].join('\n')
    const { container } = render(
      <App
        config={configFor('kitchen-sink')}
        fetcher={(async () => ({ ok: true, status: 200, text: async () => source }) as Response) as unknown as typeof fetch}
      />,
    )
    await waitFor(() => expect(container.querySelector('.app')).not.toBeNull())
    expect(screen.getByRole('navigation', { name: 'View' })).toBeInTheDocument()
  })
})

describe('M3.8 an explicit graph wins over derivation', () => {
  it('kitchen-sink reads "Architecture" with no auto-generated chip', async () => {
    const { container } = await renderFixture('kitchen-sink')
    await openGraph(container)
    await waitFor(() => expect(container.querySelector('.graph-workbench')).not.toBeNull())
    expect(container.querySelector('.graph-title')?.textContent).toBe('Architecture')
    // The chip is the *derived* marker. An explicit graph is the author's own
    // architecture, and labelling it auto-generated would be a false claim.
    expect(container.querySelector('.graph-chip')).toBeNull()
  }, AWAITS_CHUNK)

  it('even though kitchen-sink also has the cross-links that would derive one', async () => {
    // It has internal links, so the derivation would have produced a map. §6.7
    // says the explicit block is authoritative; this proves the view did not
    // quietly prefer the derived one.
    const { doc } = parseMarkdown(
      [
        '# T',
        '',
        '## Alpha',
        '',
        'See [beta](#beta) and [gamma](#gamma).',
        '',
        '## Beta',
        '',
        'See [gamma](#gamma).',
        '',
        '## Gamma',
        '',
        '```graph',
        'nodes:',
        '  alpha: Alpha',
        '  beta: Beta',
        'edges:',
        '  alpha -> beta',
        '```',
        '',
        '## Delta',
        '',
        'text',
        '',
      ].join('\n'),
    )
    // The links alone would have derived a map; the explicit block is there, and
    // §6.7 makes the explicit block authoritative.
    expect(doc.graph?.derived).toBe(false)
    expect(doc.graph?.spec.nodes.map((node) => node.id)).toEqual(['alpha', 'beta'])
  })

  it('the palette offers the graph for kitchen-sink, because the view is real now', async () => {
    // M3.0b made this row exist; this is the boundary case that proves the row
    // is gated on the same capability the nav item uses.
    const { container } = await renderFixture('kitchen-sink')
    fireEvent.click(container.querySelector('.app-search') as HTMLButtonElement)
    await screen.findByRole('combobox')
    await waitFor(() => expect(container.querySelector('[data-action="graph"]')).not.toBeNull())
  }, AWAITS_CHUNK)
})

describe('M3.8 the segmented tabs are capability-gated too', () => {
  it('appear for a graph-capable document', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const tabs = container.querySelector('.workbench-tabs')
    expect(tabs).not.toBeNull()
    // Docs / Visual Graph, and **no Metrics tab** — §5.3 dropped it explicitly.
    expect(tabs?.textContent).toContain('Docs')
    expect(tabs?.textContent).toContain('Visual Graph')
    expect(tabs?.textContent).not.toMatch(/metrics/i)
  })

  it('and are absent for a document that cannot render a graph', async () => {
    const { container } = await renderFixture('minimal')
    expect(container.querySelector('.workbench-tabs')).toBeNull()
  })
})

/**
 * M3.4 — the inspector renders prose through the *shared* inline pipeline.
 *
 * The brief's requirement is specific: the first prose block must render "through
 * the SHARED inline pipeline (entity chips must work here)". That is a claim
 * about code sharing, and the only honest way to test it is to find a document
 * that is *both* graph-capable with resolvable node ids *and* entity-capable —
 * which no fixture is:
 *
 *   kitchen-sink   is entity-capable, but its graph nodes are `shell`/`ingest`,
 *                  which match no section, so its panels have no prose at all;
 *   crosslinked    has a derived map whose ids are slugs, but is under the
 *                  entity threshold, so it has no chips to render.
 *
 * So the document is built here, on both sides of both thresholds. The assertion
 * is that a file path in a graph node's section becomes a real chip *button* in
 * the panel — the same component the reader uses, focusable and popover-capable.
 */
describe('M3.4 the panel uses the shared inline pipeline', () => {
  /** A document whose explicit graph's node ids are real slugs, with file paths. */
  const SOURCE = [
    '# Both sides',
    '',
    'Intro prose mentioning src/one.ts and src/two.ts and src/three.ts, which is',
    'enough to clear the §1.1 entity threshold of three distinct paths.',
    '',
    '## Ingest',
    '',
    'The loader reads `src/pipeline/loader.ts` and hands the text on.',
    '',
    '## Storage',
    '',
    'Parsed documents are kept beside `src/pipeline/parse.ts` in the cache.',
    '',
    '## Presentation',
    '',
    'Only the reader consumes the stored form, as `src/app/App.tsx` shows.',
    '',
    '```graph',
    'nodes:',
    '  ingest: Ingest',
    '  storage: Storage',
    '  presentation: Presentation',
    'edges:',
    '  ingest -> storage',
    '  storage -> presentation',
    '```',
    '',
  ].join('\n')

  async function openPanelFor(node: string) {
    const { container } = render(
      <App
        config={configFor('kitchen-sink')}
        fetcher={(async () => ({ ok: true, status: 200, text: async () => SOURCE }) as Response) as unknown as typeof fetch}
      />,
    )
    await waitFor(() => expect(container.querySelector('.app')).not.toBeNull())
    fireEvent.click(within(container.querySelector('.view-switcher') as HTMLElement).getByRole('button', { name: 'Graph' }))
    await waitFor(() => expect(container.querySelector('.graph-workbench')).not.toBeNull(), { timeout: 10_000 })

    // The node wrapper is React Flow's own element, so drive it the way a reader
    // does: focus it and press Enter.
    const wrapper = container.querySelector(`[data-id="${node}"]`) as HTMLElement
    wrapper.focus()
    fireEvent.keyDown(wrapper, { key: 'Enter' })
    await waitFor(() => expect(container.querySelector('.inspector')).not.toBeNull())
    return container
  }

  it('the document really is both graph-capable and entity-capable', () => {
    // Stated first, because every assertion below is meaningless without it: a
    // graph with no chips would pass a "chips render" test that never ran.
    const { doc } = parseMarkdown(SOURCE)
    expect(doc.capabilities.graph).toBe(true)
    expect(doc.capabilities.entities).toBe(true)
    expect(doc.graph?.derived).toBe(false)
  })

  it('renders the node\'s section title and first prose block', async () => {
    const container = await openPanelFor('ingest')
    expect(container.querySelector('.inspector-title')?.textContent).toBe('Ingest')
    // The section's *first* prose block — §7.6 says first, not all.
    expect(container.querySelector('.inspector-prose .reader-prose')?.textContent).toContain(
      'The loader reads',
    )
  })

  it('renders a file path from that prose as a real chip, not as plain text', async () => {
    const container = await openPanelFor('ingest')
    const chip = container.querySelector('.inspector-prose .entity-chip')
    expect(chip, 'the entity chip did not survive into the panel').not.toBeNull()
    expect(chip?.textContent).toBe('src/pipeline/loader.ts')
    // A real button, so a keyboard can reach it and it can open a popover here
    // exactly as it does in the reader.
    expect(chip?.tagName).toBe('BUTTON')
  })

  it('lists the section\'s file chips alongside it', async () => {
    const container = await openPanelFor('storage')
    const chips = Array.from(
      container.querySelectorAll('.inspector-files__list .entity-chip'),
    ).map((node) => node.textContent)
    expect(chips).toContain('src/pipeline/parse.ts')
  })

  it('the chip opens the same popover it does in the reader', async () => {
    // One code path is the whole claim. If the panel had its own chip renderer,
    // this is where the two would diverge.
    const container = await openPanelFor('ingest')
    const chip = container.querySelector('.inspector-prose .entity-chip') as HTMLElement
    fireEvent.focus(chip)
    await waitFor(() => expect(document.querySelector('.popover')).not.toBeNull())
  }, AWAITS_CHUNK)

  it('and "Open section" is live, because the node id is a real slug', async () => {
    const container = await openPanelFor('ingest')
    const action = container.querySelector('.inspector-action') as HTMLButtonElement
    expect(action.disabled).toBe(false)
    fireEvent.click(action)
    await waitFor(() => expect(window.location.hash).toBe('#ingest'))
    await waitFor(() => expect(container.querySelector('.reader')).not.toBeNull())
  }, AWAITS_CHUNK)
})
