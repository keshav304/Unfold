/**
 * Rendering helpers for component tests (spec §11.9). A fake `fetch` serves
 * fixture text so the app exercises its real load path.
 */

import { render, type RenderResult } from '@testing-library/react'
import { App } from '../app/App'
import { normalizeConfig, type UnfoldConfig } from '../pipeline/config'
import { readFixture, type FixtureName } from './fixtures'

export function fetcherFor(name: FixtureName): typeof fetch {
  const text = readFixture(name)
  return (async () =>
    ({ ok: true, status: 200, text: async () => text }) as Response) as unknown as typeof fetch
}

export function configFor(name: FixtureName, overrides: Record<string, unknown> = {}): UnfoldConfig {
  return normalizeConfig({ docPath: `./testdocs/${name}.md`, ...overrides })
}

/** Render the app on a fixture and wait for the document to be ready. */
export async function renderFixture(
  name: FixtureName,
  overrides: Record<string, unknown> = {},
): Promise<RenderResult & { docTitle: string }> {
  const result = render(<App config={configFor(name, overrides)} fetcher={fetcherFor(name)} />)
  // The document is parsed in an effect; wait for the shell to leave "loading".
  await waitForDocument(result)
  return { ...result, docTitle: name }
}

export async function waitForDocument(result: RenderResult): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (result.container.querySelector('.app') !== null) return
    if (result.container.querySelector('.drop-screen') !== null) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('the app never left the loading state')
}

/** jsdom has no layout: give every element a position for the scrollspy. */
export function stubLayout(): () => void {
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function stub(this: Element): DOMRect {
    const top = Number(this.getAttribute('data-stub-top') ?? '0')
    return { top, bottom: top + 100, left: 0, right: 0, width: 0, height: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect
  }
  return () => {
    Element.prototype.getBoundingClientRect = original
  }
}
