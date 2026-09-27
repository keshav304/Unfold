/**
 * §1.4 — `unfold.config.json`. Every field is optional; zero-config works; a
 * broken config degrades to defaults with a warning and never throws.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, normalizeConfig, parseConfig } from './config'
import { parseMarkdown } from '../test/fixtures'

describe('zero config', () => {
  it('empty input yields the defaults', () => {
    expect(parseConfig('')).toEqual(DEFAULT_CONFIG)
    expect(parseConfig('   ')).toEqual(DEFAULT_CONFIG)
  })

  it('the documented example parses', () => {
    const config = parseConfig(
      JSON.stringify({
        docPath: './document.md',
        title: 'override title',
        accent: '#06b6d4',
        features: { graph: 'auto', stepper: 'auto', delight: true },
      }),
    )
    expect(config.docPath).toBe('./document.md')
    expect(config.title).toBe('override title')
    expect(config.accent).toBe('#06b6d4')
    expect(config.features).toEqual({ graph: 'auto', stepper: 'auto', delight: true })
  })
})

describe('invalid config degrades, never throws', () => {
  it('malformed JSON falls back to defaults with a warning', () => {
    const previous = parseConfig('{ not json')
    expect(previous).toEqual(DEFAULT_CONFIG)
  })

  it('a JSON array is not a config', () => {
    expect(normalizeConfig([1, 2, 3])).toEqual(DEFAULT_CONFIG)
  })

  it('a null config is not a config', () => {
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG)
  })

  it('unknown feature values fall back to auto', () => {
    expect(normalizeConfig({ features: { graph: 'maybe' } }).features.graph).toBe('auto')
  })

  it('an invalid entity regex is dropped, not fatal', () => {
    const config = normalizeConfig({ entityPatterns: [{ name: 'bad', pattern: '([' }] })
    expect(config.entityPatterns).toEqual([])
  })

  it('non-string entries in fileExtensions are ignored', () => {
    expect(normalizeConfig({ fileExtensions: ['zig', 42, null] }).fileExtensions).toEqual(['zig'])
  })
})

describe('config reaches the pipeline', () => {
  // Three sections, three cross-links: the derived graph is on by default.
  const source = ['# T', '', '## A', '', 'See [B](#b).', '', '## B', '', 'See [C](#c).', '', '## C', '', 'See [A](#a).'].join('\n')

  it('features.graph = "off" hides a capability the document provides', () => {
    expect(parseMarkdown(source).doc.capabilities.graph).toBe(true)
    const off = normalizeConfig({ features: { graph: 'off' } })
    expect(parseMarkdown(source, { config: off }).doc.capabilities.graph).toBe(false)
  })

  it('features.graph = "on" shows the nav item with an empty state', () => {
    const on = normalizeConfig({ features: { graph: 'on' } })
    const { doc } = parseMarkdown('# T\n\nJust prose.', { config: on })
    expect(doc.capabilities.graph).toBe(true)
    expect(doc.graph).toBeUndefined()
  })

  it('features.stepper = "off" hides the stepper', () => {
    const withSteps = ['# T', '', '```steps', '1. Only step', '```'].join('\n')
    expect(parseMarkdown(withSteps).doc.capabilities.stepper).toBe(true)
    const off = normalizeConfig({ features: { stepper: 'off' } })
    expect(parseMarkdown(withSteps, { config: off }).doc.capabilities.stepper).toBe(false)
  })

  it('a config title overrides the document title', () => {
    const config = normalizeConfig({ title: 'From config' })
    const { doc } = parseMarkdown('# From markdown', { config })
    expect(doc.title).toBe('From config')
    expect(doc.titleSource).toBe('frontmatter')
  })

  it('descriptions default to empty — popovers show backlinks only (§7.5)', () => {
    expect(DEFAULT_CONFIG.descriptions).toEqual({})
  })
})
