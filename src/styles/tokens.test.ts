/**
 * The P0.2 swatch page is dev scaffolding, but "it renders" is still a claim
 * worth testing — otherwise nobody finds out when a token name is misspelled.
 * It reads the live `:root` scope, so a renamed token shows up here.
 */

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const stylesDir = resolve(here, '../styles')

function readTokens(): string {
  return readFileSync(resolve(stylesDir, 'tokens.css'), 'utf8')
}

/** Render the swatch page against the real tokens.css and return its text. */
async function renderSwatch(): Promise<string> {
  document.head.innerHTML = ''
  document.body.innerHTML = '<div id="root"></div>'
  const style = document.createElement('style')
  style.textContent = readTokens()
  document.head.append(style)
  // The module runs `render()` on import; reset so each call really re-runs it.
  vi.resetModules()
  await import('../dev/swatch')
  return document.getElementById('root')?.textContent ?? ''
}

describe('tokens.css is the single source of visual truth', () => {
  const css = readTokens()

  it('the swatch page renders', async () => {
    expect((await renderSwatch()).length).toBeGreaterThan(0)
  })

  it('renders a swatch for every spec §5.2 colour', async () => {
    const rendered = await renderSwatch()
    for (const token of [
      '--canvas',
      '--surface-1',
      '--surface-2',
      '--surface-interactive',
      '--border-muted',
      '--border-strong',
      '--border-focus',
      '--primary',
      '--secondary',
      '--tertiary',
      '--error',
      '--error-text',
      '--text-high',
      '--text-secondary',
      '--text-muted',
      '--text-subtle',
    ]) {
      expect(rendered).toContain(token)
    }
  })

  it('auto-discovers every token declared on :root, including unlisted ones', async () => {
    const rendered = await renderSwatch()
    // Not in any hand-written group in the swatch page.
    for (const token of ['--elevation-inner', '--code-surface', '--space-3xl', '--inspector-width']) {
      expect(rendered).toContain(token)
    }
  })

  it('carries the three elevation shadows and the gradient verbatim', () => {
    expect(css).toContain('--elevation-1: none')
    expect(css).toContain('--elevation-2: 0 4px 20px -2px rgba(2, 6, 23, 0.6)')
    expect(css).toContain(
      '--elevation-3: 0 0 16px -2px rgba(6, 182, 212, 0.25), 0 12px 32px -4px rgba(2, 6, 23, 0.8)',
    )
    expect(css).toContain(
      '--gradient: linear-gradient(135deg, #06b6d4 0%, #6366f1 50%, #8b5cf6 100%)',
    )
  })

  it('carries the grid-line colour, the accent wash and the active line', () => {
    expect(css).toContain('--grid-line: rgba(51, 65, 85, 0.25)')
    expect(css).toContain('--accent-wash: rgba(6, 182, 212, 0.1)')
    expect(css).toContain('--active-line: rgba(6, 182, 212, 0.08)')
  })

  it('keeps a [data-theme] hook for the v2 light theme (§7.9, §15)', () => {
    expect(css).toContain("[data-theme='light']")
  })

  it('honours reduced motion (§8)', () => {
    expect(css).toContain('prefers-reduced-motion: reduce')
  })
})
