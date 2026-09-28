/**
 * §11.3 — THE GENERICITY CONTRACT.
 *
 * If this test ever needs editing because a fixture changed, something has been
 * special-cased. These expectations are the definition of "the app renders what
 * the document provides and hides the rest".
 */

import { describe, expect, it } from 'vitest'
import { isTier0Only, activeCapabilities } from './capabilities'
import { ENTITIES_MIN_FILE_PATHS, GLOSSARY_MIN_ENTRIES } from './constants'
import { parseFixture, type FixtureName } from '../test/fixtures'
import type { CapabilityName, CapabilitySet } from './types'

const OFF: CapabilitySet = {
  graph: false,
  stepper: false,
  glossary: false,
  entities: false,
  mermaid: false,
  loop: false,
  terminal: false,
}

const ALL_ON: CapabilitySet = {
  graph: true,
  stepper: true,
  glossary: true,
  entities: true,
  mermaid: true,
  loop: true,
  terminal: true,
}

/** The exact matrix from spec §11.3 and plan §3's G1 gate. */
const EXPECTED: Record<FixtureName, CapabilitySet> = {
  minimal: OFF,
  'no-structure': OFF,
  crosslinked: { ...OFF, graph: true },
  'kitchen-sink': ALL_ON,
  'edge-cases': OFF,
  /*
   * M4.14a. The ASCII diagram fixture is untagged fences only, so `terminal` is
   * the one flag it turns on — no explicit DSL block, no glossary, no entity
   * threshold. Four of its six fences render as SVG diagrams and two stay
   * terminal windows, and *that* is a renderer decision, not a capability: the
   * capability is "this document contains an untagged fence that looks like a
   * diagram", which is true of all six.
   */
  'ascii-diagrams': { ...OFF, terminal: true },
}

describe('§11.3 capability matrix — the genericity contract', () => {
  it.each(Object.entries(EXPECTED) as [FixtureName, CapabilitySet][])(
    '%s resolves to exactly the expected capability set',
    (name, expected) => {
      const { doc } = parseFixture(name)
      expect(doc.capabilities).toEqual(expected)
    },
  )

  it('minimal is Tier 0 only: no capability flag is on', () => {
    const { doc } = parseFixture('minimal')
    expect(activeCapabilities(doc.capabilities)).toEqual([])
    expect(isTier0Only(doc.capabilities)).toBe(true)
  })

  it('no-structure is Tier 0 only: no H2, no rail, but the reader still has content', () => {
    const { doc } = parseFixture('no-structure')
    expect(doc.sections).toHaveLength(0)
    expect(doc.intro.length).toBeGreaterThan(0)
    expect(isTier0Only(doc.capabilities)).toBe(true)
  })

  it('crosslinked turns on the graph capability through derivation, not an explicit block', () => {
    const { doc } = parseFixture('crosslinked')
    expect(doc.capabilities.graph).toBe(true)
    expect(doc.graph?.derived).toBe(true)
  })

  it('kitchen-sink turns on every capability', () => {
    const { doc } = parseFixture('kitchen-sink')
    expect(doc.capabilities).toEqual(ALL_ON)
    expect(doc.graph?.derived).toBe(false)
  })

  it('edge-cases: malformed DSL degrades, so nothing turns on', () => {
    const { doc } = parseFixture('edge-cases')
    expect(doc.capabilities).toEqual(OFF)
    expect(doc.graph).toBeUndefined()
    expect(doc.steps).toBeUndefined()
  })
})

describe('§1.1 capability thresholds are constants, not magic numbers', () => {
  it('entities needs at least the configured number of file paths', () => {
    expect(ENTITIES_MIN_FILE_PATHS).toBe(3)
    const { doc } = parseFixture('kitchen-sink')
    expect(doc.indexes.filePaths.length).toBeGreaterThanOrEqual(ENTITIES_MIN_FILE_PATHS)
  })

  it('glossary needs at least the configured number of entries', () => {
    expect(GLOSSARY_MIN_ENTRIES).toBe(2)
    const { doc } = parseFixture('kitchen-sink')
    expect(doc.glossary?.length ?? 0).toBeGreaterThanOrEqual(GLOSSARY_MIN_ENTRIES)
  })

  it('a single glossary entry is not enough', () => {
    const { doc } = parseFixture('minimal')
    expect(doc.glossary).toBeUndefined()
  })
})

describe('capability set has exactly the spec §1.1 members', () => {
  it('no flag is added or missing', () => {
    const { doc } = parseFixture('kitchen-sink')
    const names = Object.keys(doc.capabilities).sort()
    const expected: CapabilityName[] = [
      'entities',
      'glossary',
      'graph',
      'loop',
      'mermaid',
      'stepper',
      'terminal',
    ]
    expect(names).toEqual(expected)
  })
})
