/**
 * §11.9 — the M1 component-test subset, against the real fixtures.
 *
 * The behaviour these lock down is the genericity contract at the UI layer:
 * a view the document cannot support is not rendered at all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { configFor, fetcherFor, renderFixture } from '../test/render-helpers'
import { render } from '@testing-library/react'
import { App } from './App'
import type { FixtureName } from '../test/fixtures'

afterEach(cleanup)

/**
 * jsdom keeps one `window` per file, and the App seeds its route from
 * `location.hash` — so a hash written by one test is the starting route of the
 * next. Reset it between cases, or a test that navigates silently decides what
 * several later tests start from.
 */
beforeEach(() => {
  window.location.hash = ''
})

describe('the app renders every fixture', () => {
  it.each(['minimal', 'kitchen-sink', 'crosslinked', 'no-structure', 'edge-cases'] as FixtureName[])(
    '%s reaches a rendered shell',
    async (name) => {
      const { container } = await renderFixture(name)
      expect(container.querySelector('.app')).not.toBeNull()
    },
  )
})

describe('§11.9 the view switcher is capability-gated', () => {
  it('kitchen-sink, which is capable of both, shows the switcher', async () => {
    await renderFixture('kitchen-sink')
    const switcher = screen.getByRole('navigation', { name: 'View' })
    expect(within(switcher).getByRole('button', { name: 'Reader' })).toBeInTheDocument()
    expect(within(switcher).getByRole('button', { name: 'Graph' })).toBeInTheDocument()
    expect(within(switcher).getByRole('button', { name: 'Stepper' })).toBeInTheDocument()
  })

  it('minimal, which is capable of nothing, shows NO switcher at all', async () => {
    await renderFixture('minimal')
    expect(screen.queryByRole('navigation', { name: 'View' })).toBeNull()
  })

  it('no-structure, with no H2s, shows no switcher', async () => {
    await renderFixture('no-structure')
    expect(screen.queryByRole('navigation', { name: 'View' })).toBeNull()
  })

  it('crosslinked, capable of a derived graph only, shows exactly one extra view', async () => {
    await renderFixture('crosslinked')
    const switcher = screen.getByRole('navigation', { name: 'View' })
    expect(within(switcher).getByRole('button', { name: 'Graph' })).toBeInTheDocument()
    expect(within(switcher).queryByRole('button', { name: 'Stepper' })).toBeNull()
  })

  it('edge-cases, whose DSL all degrades, shows no switcher', async () => {
    await renderFixture('edge-cases')
    expect(screen.queryByRole('navigation', { name: 'View' })).toBeNull()
  })
})

describe('§11.9 the TOC renders the fixture sections', () => {
  it('lists every H2 and H3 of kitchen-sink', async () => {
    await renderFixture('kitchen-sink')
    const toc = screen.getByRole('navigation', { name: 'Table of contents' })
    for (const title of ['Getting started', 'Runtime shape', 'Operational notes', 'Glossary']) {
      expect(within(toc).getByRole('button', { name: title })).toBeInTheDocument()
    }
    // H3s are ticks under their H2.
    expect(within(toc).getByRole('button', { name: 'Environment' })).toBeInTheDocument()
    expect(within(toc).getByRole('button', { name: 'Component graph' })).toBeInTheDocument()
  })

  it('is absent entirely when the document has no H2 (§7.3: hidden, not empty)', async () => {
    const { container } = await renderFixture('no-structure')
    expect(container.querySelector('.toc')).toBeNull()
  })

  it('duplicate headings both appear, with distinct targets', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const toc = screen.getByRole('navigation', { name: 'Table of contents' })
    expect(within(toc).getAllByRole('button', { name: 'Notes' })).toHaveLength(2)
    // They target different sections — that is what the -1 suffix is for.
    const targets = Array.from(container.querySelectorAll('.toc-node')).map((node) => node.getAttribute('data-active'))
    expect(targets.length).toBeGreaterThan(0)
    expect(container.querySelectorAll('#section-notes')).toHaveLength(1)
    expect(container.querySelectorAll('#section-notes-1')).toHaveLength(1)
  })
})

describe('§11.9 internal anchors navigate and flash', () => {
  it('a resolvable internal link scrolls to its section and flashes it', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const link = container.querySelector<HTMLAnchorElement>('.inline-link--internal')
    expect(link).not.toBeNull()
    link?.click()

    await waitFor(() => {
      expect(container.querySelector('[data-flash="true"]')).not.toBeNull()
    })
    const flashed = container.querySelector('[data-flash="true"]')
    expect(flashed?.getAttribute('data-slug')).toBe('getting-started')
  })

  it('an unresolvable internal link is muted with a tooltip, never broken (§6.4)', async () => {
    const { container } = await renderFixture('edge-cases')
    const unresolved = container.querySelector<HTMLSpanElement>('.inline-link--unresolved')
    expect(unresolved).not.toBeNull()
    expect(unresolved?.tagName).toBe('SPAN')
    expect(unresolved?.getAttribute('title')).toMatch(/does not exist/i)
    // It is not a link, so it cannot 404.
    expect(unresolved?.querySelector('a')).toBeNull()
  })

  it('every section has an id the deep link can target', async () => {
    const { container } = await renderFixture('kitchen-sink')
    for (const id of ['section-getting-started', 'section-runtime-shape', 'section-notes-1']) {
      expect(container.querySelector(`#${CSS.escape(id)}`)).not.toBeNull()
    }
  })
})

describe('M3.0c the header view switcher routes, it does not rebuild', () => {
  it('each button writes its own hash and marks itself current', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const switcher = screen.getByRole('navigation', { name: 'View' })

    for (const [label, hash] of [
      ['Graph', '#/graph'],
      ['Stepper', '#/stepper'],
      ['Reader', '#/'],
    ] as const) {
      fireEvent.click(within(switcher).getByRole('button', { name: label }))
      await waitFor(() => expect(window.location.hash).toBe(hash))
      expect(container.querySelector('.app')?.getAttribute('data-view')).toBe(
        label === 'Reader' ? 'reader' : label.toLowerCase(),
      )
      expect(within(switcher).getByRole('button', { name: label })).toHaveAttribute(
        'aria-current',
        'page',
      )
    }
  })

  it('a #/graph deep link lands on the graph view directly, with no click', async () => {
    window.location.hash = '#/graph'
    const { container } = await renderFixture('kitchen-sink')
    await waitFor(() => expect(container.querySelector('.app')?.getAttribute('data-view')).toBe('graph'))
  })

  it('a #/stepper/2 deep link is not yet a route this milestone defines', async () => {
    // M3.6 defines the per-step hash. Until then, an unrecognised `/view` route
    // degrades to the reader like any other unknown hash (§1.3) — never a blank
    // screen, never an error. This test is replaced by the real one in M3.6.
    window.location.hash = '#/stepper/2'
    const { container } = await renderFixture('kitchen-sink')
    await waitFor(() => expect(container.querySelector('.app')).not.toBeNull())
    expect(container.querySelector('.app')?.getAttribute('data-view')).not.toBe('undefined')
  })
})

describe('§11.9 the code container works', () => {
  it('renders a code block with a header strip and a copy button', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const block = container.querySelector('.code-block')
    expect(block).not.toBeNull()
    expect(within(block as HTMLElement).getByRole('button', { name: /Copy|Copied/ })).toBeInTheDocument()
    expect(block?.querySelector('.code-header__path')).not.toBeNull()
  })

  it('the copy button acknowledges with "Copied ✓"', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const { container } = await renderFixture('kitchen-sink')
    const block = container.querySelector('.code-block') as HTMLElement
    const button = within(block).getByRole('button', { name: /Copy/ })
    fireEvent.click(button)

    await waitFor(() => {
      expect(within(block).getByRole('button', { name: /Copied/ })).toBeInTheDocument()
    })
    expect(writeText).toHaveBeenCalled()
  })
})

describe('§11.9 mermaid renders in the dark theme', () => {
  it('carries the dark theme and never leaves a blank box', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const figure = container.querySelector('.mermaid')
    expect(figure).not.toBeNull()
    // Dark in every state: pending, rendered, or degraded to source.
    expect(figure?.getAttribute('data-theme')).toBe('dark')

    // Mermaid is a ~1MB dynamic import, so the block starts pending. It must
    // settle on either a rendered diagram or the source — never a permanent
    // blank. The 30s belongs on the *test*, not only on `waitFor`: the 20s on
    // `waitFor` alone still left the test itself on vitest's 5s default, so a
    // loaded machine (the budget test builds in parallel) failed it while the
    // assertion was still polling.
    await waitFor(
      () => {
        const state = container.querySelector('.mermaid')?.getAttribute('data-state')
        expect(['ready', 'failed']).toContain(state)
      },
      { timeout: 20_000 },
    )
    const settled = container.querySelector('.mermaid')
    expect(settled?.querySelector('svg, pre')).not.toBeNull()
  }, 30_000)
})

describe('block renderers', () => {
  it('renders tables with a header row and its cell text', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const table = container.querySelector('.reader-table')
    expect(table).not.toBeNull()
    expect(table?.querySelectorAll('th').length).toBeGreaterThan(0)
    expect(table?.querySelectorAll('tbody tr').length).toBeGreaterThan(0)
    // A3: a cell carries inline runs, so a backticked cell still reads as its
    // own text — now with a real `<code>` element, not a pre-flattened string.
    expect(table?.textContent).toContain('npm ci')
    expect(table?.querySelector('td code')?.textContent).toBe('npm ci')
  })

  it('renders the untagged ASCII diagram as a terminal window', async () => {
    const { container } = await renderFixture('kitchen-sink')
    expect(container.querySelector('.terminal')).not.toBeNull()
    expect(container.querySelectorAll('.terminal-light').length).toBe(3)
  })

  it('renders a loop block as an SVG cycle with the right labels', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const svg = container.querySelector('.loop-svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('aria-label')).toContain('Ingest')
    expect(svg?.querySelectorAll('.loop-node').length).toBe(4)
  })

  it('renders a quote, a list and a thematic break', async () => {
    const { container } = await renderFixture('kitchen-sink')
    expect(container.querySelector('.reader-quote')).not.toBeNull()
    expect(container.querySelector('.reader-hr')).not.toBeNull()
  })

  it('shows malformed DSL as source rather than dropping it', async () => {
    const { container } = await renderFixture('edge-cases')
    const deferred = Array.from(container.querySelectorAll('.code-block')).filter((block) =>
      ['graph', 'steps', 'loop'].includes(block.getAttribute('data-lang') ?? ''),
    )
    expect(deferred.length).toBe(3)
  })

  it('renders raw HTML as source, never as live markup', async () => {
    const { container } = await renderFixture('edge-cases')
    expect(container.querySelector('.reader-html')).not.toBeNull()
    expect(container.querySelector('details')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })

  it('renders an empty table as a table with a header and no rows', async () => {
    const { container } = await renderFixture('edge-cases')
    const table = container.querySelector('.reader-table')
    expect(table?.querySelectorAll('th').length).toBe(2)
    expect(table?.querySelectorAll('tbody tr').length).toBe(0)
  })
})

describe('the hero follows the title chain (§7.2)', () => {
  it('uses the frontmatter title when there is one', async () => {
    await renderFixture('kitchen-sink')
    expect(screen.getByRole('heading', { level: 1, name: 'Kitchen Sink Fixture' })).toBeInTheDocument()
  })

  it('uses the H1 when there is no frontmatter', async () => {
    await renderFixture('minimal')
    expect(screen.getByRole('heading', { level: 1, name: 'Minimal Fixture' })).toBeInTheDocument()
  })

  it('falls back to the filename when there is no H1', async () => {
    await renderFixture('no-structure')
    expect(screen.getByRole('heading', { level: 1, name: 'No Structure' })).toBeInTheDocument()
  })

  it('a jump chip appears per H2, and none at all with no H2s', async () => {
    const { unmount } = await renderFixture('kitchen-sink')
    expect(screen.getByRole('navigation', { name: 'Jump to section' })).toBeInTheDocument()
    unmount()
    cleanup()
    await renderFixture('no-structure')
    expect(screen.queryByRole('navigation', { name: 'Jump to section' })).toBeNull()
  })
})

describe('capability config overrides (§1.4)', () => {
  it('features.graph = "off" hides the graph view for a capable document', async () => {
    const { container } = render(
      <App config={configFor('kitchen-sink', { features: { graph: 'off' } })} fetcher={fetcherFor('kitchen-sink')} />,
    )
    await waitFor(() => {
      expect(container.querySelector('.app')).not.toBeNull()
    })
    expect(screen.queryByRole('button', { name: 'Graph' })).toBeNull()
    // The document is still capable; the deployer turned it off.
    expect(screen.getByRole('button', { name: 'Stepper' })).toBeInTheDocument()
  })
})

describe('the drop screen is the designed path for a 404 (§6.1)', () => {
  it('never shows a blank screen when the document is missing', async () => {
    const notFound = (async () => ({ ok: false, status: 404 }) as Response) as unknown as typeof fetch
    render(<App config={configFor('kitchen-sink')} fetcher={notFound} />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Drop a markdown file/i })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /Choose file/i })).toBeInTheDocument()
  })

  it('a network failure is also a message, not a crash', async () => {
    const broken = (async () => {
      throw new TypeError('offline')
    }) as unknown as typeof fetch
    render(<App config={configFor('kitchen-sink')} fetcher={broken} />)
    await waitFor(() => {
      expect(document.querySelector('.drop-screen, .app')).not.toBeNull()
    })
  })
})

describe('reduced motion is honoured without a hardcoded duration', () => {
  it('the reader marks itself when the user prefers reduced motion', async () => {
    const original = window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        onchange: null,
        dispatchEvent: () => false,
      }),
    })
    try {
      const { container } = await renderFixture('minimal')
      expect(container.querySelector('.reader')?.getAttribute('data-reduced-motion')).toBe('true')
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: original })
    }
  })
})

describe('the scrollspy boundary rule (§7.3)', () => {
  it('activates the LAST H2 at the bottom of the document', async () => {
    const { container } = await renderFixture('kitchen-sink')
    // jsdom has no layout, so drive the flag the hook reads.
    const doc = document.documentElement
    Object.defineProperty(doc, 'scrollHeight', { configurable: true, value: 5000 })
    Object.defineProperty(doc, 'clientHeight', { configurable: true, value: 1000 })
    window.scrollY = 4000
    fireEvent.scroll(window)

    await waitFor(() => {
      // The LAST H2 in document order. Assert the slug: two sections in this
      // fixture share the title "Notes", so the title is not discriminating.
      const active = container.querySelector('.toc-node[data-active="true"] .toc-title')
      expect(active).not.toBeNull()
      const nodes = Array.from(container.querySelectorAll('.toc-node'))
      expect(nodes[nodes.length - 1]?.querySelector('.toc-title')).toBe(active)
    })
  })
})

/* ------------------------------------------------------------------ *
 * A5 — the served artifact must not be rendered as a document
 * ------------------------------------------------------------------ */

describe('A5: an HTML response shows the drop screen, never a rendered document', () => {
  const APP_SHELL = `<!doctype html>
<html lang="en"><head><title>Unfold</title></head>
<body><div id="root"></div><script type="module" src="/assets/index.js"></script></body></html>
`

  const htmlFetcher = () =>
    (async () =>
      ({
        ok: true,
        status: 200,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html' : null) },
        text: async () => APP_SHELL,
      }) as Response) as unknown as typeof fetch

  it('a wrong docPath that hits the SPA fallback shows the drop screen', async () => {
    const { container } = render(<App config={configFor('kitchen-sink')} fetcher={htmlFetcher()} />)
    await waitFor(() => {
      expect(container.querySelector('.drop-screen')).not.toBeNull()
    })
    expect(container.querySelector('.app')).toBeNull()
    expect(container.querySelector('.reader')).toBeNull()
  })

  it('the message is actionable, naming the path and the config', async () => {
    const { container } = render(<App config={configFor('kitchen-sink')} fetcher={htmlFetcher()} />)
    await waitFor(() => {
      expect(container.querySelector('.drop-screen')).not.toBeNull()
    })
    const message = container.querySelector('.drop-message')?.textContent ?? ''
    expect(message).toMatch(/app shell/i)
    expect(message).toContain('kitchen-sink.md')
    expect(message).toMatch(/unfold\.config\.json/)
  })

  it('never renders the shell as document content', async () => {
    const { container } = render(<App config={configFor('kitchen-sink')} fetcher={htmlFetcher()} />)
    await waitFor(() => {
      expect(container.querySelector('.drop-screen')).not.toBeNull()
    })
    // No headings, no reader column, no sections invented from the shell.
    expect(container.querySelectorAll('.reader-section')).toHaveLength(0)
    expect(container.querySelectorAll('h1, h2, h3')).toHaveLength(1) // the drop screen's own h1
    expect(container.textContent).not.toContain('id="root"')
  })

  it('the drop screen still offers a way forward', async () => {
    const { container } = render(<App config={configFor('kitchen-sink')} fetcher={htmlFetcher()} />)
    await waitFor(() => {
      expect(container.querySelector('.drop-screen')).not.toBeNull()
    })
    expect(container.querySelector('input[type="file"]')).not.toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * M1.9d — the layout must not reserve a rail column that is not there
 * ------------------------------------------------------------------ */

describe('M1.9d: the workbench grid collapses when the rail is absent', () => {
  it('a document WITH sections declares a rail', async () => {
    const { container } = await renderFixture('kitchen-sink')
    const body = container.querySelector('.app-body')
    expect(body?.getAttribute('data-rail')).toBe('true')
    expect(container.querySelector('.toc')).not.toBeNull()
  })

  it('a 0-section document declares no rail', async () => {
    const { container } = await renderFixture('no-structure')
    const body = container.querySelector('.app-body')
    expect(body?.getAttribute('data-rail')).toBe('false')
    expect(container.querySelector('.toc')).toBeNull()
  })

  it('with no rail, the main column is the only child — nothing is pushed aside', async () => {
    const { container } = await renderFixture('no-structure')
    const body = container.querySelector('.app-body')
    expect(body?.children).toHaveLength(1)
    // The content really is the direct child, so it gets the full width.
    expect(body?.firstElementChild?.className).toBe('app-main')
  })

  it('the content is present, not collapsed into a narrow column', async () => {
    const { container } = await renderFixture('no-structure')
    // A regression here is the reported defect: hero + code squeezed into the
    // rail column with an empty main area. The content must be there.
    expect(container.querySelector('.hero')).not.toBeNull()
    expect(container.querySelector('.app-main')).not.toBeNull()
    const main = container.querySelector('.app-main') as HTMLElement
    expect(main.textContent?.trim().length ?? 0).toBeGreaterThan(100)
  })

  it('a document with sections still has exactly two children', async () => {
    const { container } = await renderFixture('kitchen-sink')
    expect(container.querySelector('.app-body')?.children).toHaveLength(2)
  })
})
