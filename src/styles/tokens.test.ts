/**
 * The P0.2 swatch page is dev scaffolding, but "it renders" is still a claim
 * worth testing — otherwise nobody finds out when a token name is misspelled.
 * It reads the live `:root` scope, so a renamed token shows up here.
 *
 * M0.11: the assertions below used to be text/regex checks only, which meant a
 * structurally *malformed* tokens.css (a `:root` opened inside another `:root`)
 * still passed. These parse the file with PostCSS first, so an unbalanced brace
 * or a nested selector fails here instead of silently losing half the tokens in
 * a real browser.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss, { type Rule } from 'postcss'
import { describe, expect, it, vi } from 'vitest'

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

describe('tokens.css is structurally valid CSS (M0.11)', () => {
  const css = readTokens()

  it('parses without throwing — an unbalanced brace fails here', () => {
    expect(() => postcss.parse(css, { from: 'tokens.css' })).not.toThrow()
  })

  it('has exactly one top-level :root rule', () => {
    const ast = postcss.parse(css, { from: 'tokens.css' })
    const roots = ast.nodes.filter(
      (node): node is Rule => node.type === 'rule' && node.selector === ':root',
    )
    expect(roots).toHaveLength(1)
  })

  it('has no rule nested inside :root', () => {
    // The actual bug: a second `:root` opened inside the first one. Under CSS
    // nesting the inner selector becomes `:is(:root) :root`, which matches
    // nothing, so every token inside it silently vanishes in a browser.
    const ast = postcss.parse(css, { from: 'tokens.css' })
    const root = ast.nodes.find(
      (node): node is Rule => node.type === 'rule' && node.selector === ':root',
    )
    expect(root).toBeDefined()
    const nested = (root?.nodes ?? []).filter((node) => node.type === 'rule')
    expect(nested.map((node) => (node as Rule).selector)).toEqual([])
  })

  it('declares every token directly on :root, not after it', () => {
    // Orphans that fall outside the block (a previous revision had
    // --space-md…--space-3xl stranded after [data-theme]) would be parsed as
    // garbage and dropped. Assert they are all inside.
    const ast = postcss.parse(css, { from: 'tokens.css' })
    const root = ast.nodes.find(
      (node): node is Rule => node.type === 'rule' && node.selector === ':root',
    )
    const inside = new Set(
      (root?.nodes ?? [])
        .filter((node) => node.type === 'decl')
        .map((node) => (node as { prop: string }).prop),
    )
    for (const token of [
      '--space-2xs',
      '--space-xs',
      '--space-sm',
      '--space-md',
      '--space-lg',
      '--space-xl',
      '--space-2xl',
      '--space-3xl',
      '--font-display',
      '--font-body',
      '--font-mono',
      '--nav-rail-width',
      '--inspector-width',
      '--motion-slow',
    ]) {
      expect(inside).toContain(token)
    }
  })

  it('keeps the [data-theme] hook and the utility classes as siblings', () => {
    const ast = postcss.parse(css, { from: 'tokens.css' })
    const selectors = ast.nodes.filter((node) => node.type === 'rule').map((node) => (node as Rule).selector)
    expect(selectors).toContain("[data-theme='light']")
    expect(selectors).toContain('.elev-2')
    expect(selectors).toContain('.t-code-md')
  })
})

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
