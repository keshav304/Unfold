/**
 * M4.13 + M4.14 — the reader's diagrams, in jsdom.
 *
 * What this file exists to prove is a *pair* of properties for each block kind:
 * the diagram renders, and the source does not. Asserting only the first would
 * pass on a reader that shows both; asserting only the second would pass on a
 * reader that shows neither. The terminal fallback gets the same treatment from
 * the other side — a fence the parser refuses must still be a terminal window,
 * and `features.diagrams: "terminal"` must produce one even when the fence
 * parses.
 *
 * Geometry is not asserted here. jsdom has no layout, so "the canvas is 360px",
 * "the SVG scales" and "nothing overflows" are questions for Playwright, which
 * asks them of a real engine (`tests/e2e/diagrams.spec.ts`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { renderFixture } from './render-helpers'

/**
 * The graph chunk is lazy, so reaching an inline canvas means resolving a
 * dynamic import of React Flow. That is fine in isolation and slow under the
 * full suite's parallel load, and the honest response to "the library needs time
 * the test did not give it" is to give it the time, the way
 * `graph-boundary.test.ts` does. It is a per-file setting rather than four
 * repeated arguments, and it is about the *harness*, not about the app: the
 * diagram assertions themselves are all synchronous once the canvas is up.
 */
vi.setConfig({ testTimeout: 30_000 })

/** How long a `waitFor` for the lazy chunk may run. */
const AWAITS_CHUNK = 20_000

beforeEach(() => {
  window.location.hash = ''
})
afterEach(cleanup)

describe('M4.14 an ASCII diagram renders as a diagram', () => {
  it("kitchen-sink's untagged fence becomes an SVG diagram, not a terminal", async () => {
    const { container } = await renderFixture('kitchen-sink')
    expect(container.querySelector('.ascii-diagram')).not.toBeNull()
    expect(container.querySelector('.terminal')).toBeNull()
  })

  it('draws every box, every connector and the label beside it', async () => {
    const { container } = await renderFixture('ascii-diagrams')
    const diagram = container.querySelector('.ascii-diagram') as SVGElement
    // Fixture A: four boxes.
    expect(diagram.querySelectorAll('.ascii-node__box')).toHaveLength(4)
    expect(diagram.querySelectorAll('.ascii-node__hairline')).toHaveLength(4)
    // Four connectors, one of them labelled twice ("request" above the arrow,
    // "client" below it) and the rest labelled once or not at all.
    expect(diagram.querySelectorAll('.ascii-edge')).toHaveLength(4)
    const labels = Array.from(diagram.querySelectorAll('.ascii-edge__label')).map(
      (node) => node.textContent,
    )
    expect(labels).toContain('request')
    expect(labels).toContain('client')
    expect(labels).toContain('fetch')
    expect(labels).toContain('query')
    // And the node labels the parser extracted are the author's own words.
    const text = Array.from(diagram.querySelectorAll('.ascii-node__label')).map(
      (node) => node.textContent,
    )
    expect(text).toContain(' Browser')
    expect(text).toContain(' Dev server')
  })

  it('the SVG is an image with a summary generated from the parsed graph', async () => {
    const { container } = await renderFixture('ascii-diagrams')
    const svg = container.querySelector('.ascii-diagram__svg') as SVGSVGElement
    expect(svg.getAttribute('role')).toBe('img')
    const label = svg.getAttribute('aria-label') ?? ''
    // Generated, not hard-coded: it names the fixture's own boxes in the order
    // the diagram connects them.
    expect(label.startsWith('Diagram: ')).toBe(true)
    expect(label).toContain('Browser → Dev server')
    // The raw ASCII is not the accessible representation of a parsed diagram.
    expect(label).not.toContain('+---')
    expect(label).not.toContain('|')
  })

  it('a fence the parser refuses stays a terminal window', async () => {
    const { container } = await renderFixture('ascii-diagrams')
    // Fixtures E (hostile prose) and F (dangling arrows) are refused.
    expect(container.querySelectorAll('.ascii-diagram')).toHaveLength(4)
    expect(container.querySelectorAll('.terminal')).toHaveLength(2)
    expect(container.querySelectorAll('.terminal-light')).toHaveLength(6)
  })
})

describe('M4.14 features.diagrams: "terminal" is a real escape hatch', () => {
  it('a parseable fence renders as the terminal window when the switch is off', async () => {
    const { container } = await renderFixture('ascii-diagrams', {
      features: { diagrams: 'terminal' },
    })
    // All six fences, including the four that parse: the switch does not hide the
    // result, it stops the parse, so this is the pre-M4.14 reader exactly.
    expect(container.querySelectorAll('.ascii-diagram')).toHaveLength(0)
    expect(container.querySelectorAll('.terminal')).toHaveLength(6)
  })

  it('and the default is the feature, not the fallback', async () => {
    const { container } = await renderFixture('ascii-diagrams')
    expect(container.querySelectorAll('.ascii-diagram')).toHaveLength(4)
  })
})

describe('M4.13.1 an explicit `graph` block renders inline, as a canvas', () => {
  it('the reader mounts a read-only React Flow canvas, not the DSL source', async () => {
    const { container } = await renderFixture('kitchen-sink')
    // The chunk is lazy, so the canvas arrives after a dynamic import.
    await waitFor(() => expect(container.querySelector('.graph-inline')).not.toBeNull(), {
      timeout: AWAITS_CHUNK,
    })
    const canvas = container.querySelector('.graph-inline') as HTMLElement
    expect(canvas.querySelector('.react-flow')).not.toBeNull()
    await waitFor(() => expect(container.querySelectorAll('.graph-inline .metro-node').length).toBe(4), {
      timeout: AWAITS_CHUNK,
    })
    // The graph source is not the reader's primary representation of it any more.
    const graphSource = Array.from(container.querySelectorAll('.code-block')).filter(
      (block) => block.getAttribute('data-lang') === 'graph',
    )
    expect(graphSource).toHaveLength(0)
  })

  it('is read-only: no zoom controls, and no node dragging', async () => {
    const { container } = await renderFixture('kitchen-sink')
    await waitFor(() => expect(container.querySelectorAll('.graph-inline .metro-node').length).toBe(4), {
      timeout: AWAITS_CHUNK,
    })
    const canvas = container.querySelector('.graph-inline') as HTMLElement
    expect(canvas.getAttribute('data-read-only')).toBe('true')
    expect(canvas.querySelector('.react-flow__controls')).toBeNull()
    expect(canvas.querySelectorAll('.react-flow__node.draggable')).toHaveLength(0)
  })

  it('offers the full experience through a link, and the link works', async () => {
    const { container } = await renderFixture('kitchen-sink')
    await waitFor(() => expect(container.querySelector('.graph-open')).not.toBeNull(), {
      timeout: AWAITS_CHUNK,
    })
    const link = container.querySelector('.graph-open') as HTMLAnchorElement
    expect(link.tagName).toBe('A')
    // A real href, so it is copyable and middle-clickable…
    expect(link.getAttribute('href')).toBe('#/graph')
    // …and one click from the reader's own route.
    fireEvent.click(link)
    await waitFor(() => expect(container.querySelector('.app')).toHaveAttribute('data-view', 'graph'))
  })

describe('M4.13.2 an explicit `steps` block renders inline, as the stepper', () => {
  it('the reader mounts the stepper itself, not the DSL source', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const stepper = container.querySelector('.stepper--embedded') as HTMLElement
    expect(stepper).not.toBeNull()
    expect(stepper.getAttribute('data-variant')).toBe('embedded')
    expect(stepper.getAttribute('data-step')).toBe('1')
    expect(stepper.getAttribute('data-total')).toBe('3')
    // The stepper's own contract (§7.7): a tablist of steps and one tabpanel.
    expect(stepper.querySelector('[role="tablist"]')).not.toBeNull()
    expect(stepper.querySelectorAll('[role="tab"]')).toHaveLength(3)
    expect(stepper.querySelector('[role="tabpanel"]')?.id).toBe('reader-step-panel')
    // The document's own words, from the pipeline's parse.
    expect(stepper.querySelector('.step-title')?.textContent).toBe('Submit')
    const stepsSource = Array.from(container.querySelectorAll('.code-block')).filter(
      (block) => block.getAttribute('data-lang') === 'steps',
    )
    expect(stepsSource).toHaveLength(0)
  })

  it('is not a second h1: the title is a paragraph inside the reader', async () => {
    const { container } = await renderFixture('kitchen-sink')
    expect(container.querySelectorAll('h1')).toHaveLength(1)
    expect(container.querySelector('.stepper--embedded .step-title')?.tagName).toBe('P')
  })

  it("walks the steps, and names the reader's own ids", async () => {
    const { container } = await renderFixture('kitchen-sink')
    const stepper = container.querySelector('.stepper--embedded') as HTMLElement
    const tabs = Array.from(stepper.querySelectorAll('[role="tab"]')) as HTMLElement[]
    fireEvent.click(tabs[1] as HTMLElement)
    await waitFor(() => expect(stepper.getAttribute('data-step')).toBe('2'))
    expect(stepper.querySelector('.step-title')?.textContent).toBe('Plan')
    // Ids are namespaced so a page carrying the workbench *and* the block has no
    // duplicate id and no dangling `aria-labelledby`.
    expect(stepper.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(
      'reader-step-tab-2',
    )
  })

  it('the source-section link navigates the reader, as it does in the workbench', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const stepper = container.querySelector('.stepper--embedded') as HTMLElement
    const link = stepper.querySelector('.step-source') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('#environment')
    fireEvent.click(link)
    await waitFor(() => expect(window.location.hash).toBe('#environment'))
  })
})


  it('offers no link when the document cannot show the graph view (§1.1)', async () => {
    const { container } = await renderFixture('kitchen-sink', { features: { graph: 'off' } })
    await waitFor(() => expect(container.querySelector('.graph-inline')).not.toBeNull(), {
      timeout: AWAITS_CHUNK,
    })
    // The block still draws — it is the document's content — but there is no link
    // to a view the capability is off for.
    expect(container.querySelector('.graph-open')).toBeNull()
  })
})

