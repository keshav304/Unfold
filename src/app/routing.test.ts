/**
 * Hash routing (spec §4, M1.1). The rule that matters: a route to a view the
 * document cannot support degrades to the reader. Never an error, never blank.
 */

import { describe, expect, it } from 'vitest'
import { capableViews, hashFor, parseHash, resolveRoute } from './routing'

const ALL_ON = { graph: true, stepper: true }
const ALL_OFF = { graph: false, stepper: false }

describe('parseHash', () => {
  it('reads a section deep link', () => {
    expect(parseHash('#getting-started')).toEqual({ name: 'reader', slug: 'getting-started' })
  })

  it('reads the view routes', () => {
    expect(parseHash('#/graph')).toEqual({ name: 'graph' })
    expect(parseHash('#/stepper')).toEqual({ name: 'stepper' })
  })

  it('an empty or root hash is the reader', () => {
    expect(parseHash('')).toEqual({ name: 'reader' })
    expect(parseHash('#')).toEqual({ name: 'reader' })
    expect(parseHash('#/')).toEqual({ name: 'reader' })
  })

  it('an unknown view falls back to the reader rather than erroring', () => {
    expect(parseHash('#/nope')).toEqual({ name: 'reader', slug: 'nope' })
  })

  it('decodes percent-encoded slugs', () => {
    expect(parseHash('#%E4%B8%AD%E6%96%87')).toEqual({ name: 'reader', slug: '中文' })
  })

  it('survives a malformed percent-escape', () => {
    expect(() => parseHash('#%E0%A4%A')).not.toThrow()
  })
})

describe('hashFor', () => {
  it('round-trips every route', () => {
    for (const route of [{ name: 'reader' }, { name: 'graph' }, { name: 'stepper' }, { name: 'reader', slug: 'a' }] as const) {
      expect(parseHash(hashFor(route))).toEqual(route)
    }
  })

  it('an empty slug is the reader root, not "#"', () => {
    expect(hashFor({ name: 'reader', slug: '' })).toBe('#/')
  })
})

describe('capableViews', () => {
  it('a document with no capabilities gets the reader only', () => {
    expect(capableViews(ALL_OFF)).toEqual(['reader'])
  })

  it('each capability adds exactly one view', () => {
    expect(capableViews({ graph: true, stepper: false })).toEqual(['reader', 'graph'])
    expect(capableViews({ graph: false, stepper: true })).toEqual(['reader', 'stepper'])
    expect(capableViews(ALL_ON)).toEqual(['reader', 'graph', 'stepper'])
  })
})

describe('resolveRoute', () => {
  it('keeps a capable route', () => {
    expect(resolveRoute({ name: 'graph' }, ALL_ON)).toEqual({ name: 'graph' })
  })

  it('degrades an incapable graph route to the reader', () => {
    expect(resolveRoute({ name: 'graph' }, ALL_OFF)).toEqual({ name: 'reader' })
  })

  it('degrades an incapable stepper route to the reader', () => {
    expect(resolveRoute({ name: 'stepper' }, { graph: true, stepper: false })).toEqual({ name: 'reader' })
  })

  it('never throws, whatever the combination', () => {
    for (const caps of [ALL_ON, ALL_OFF, { graph: true, stepper: false }, { graph: false, stepper: true }]) {
      expect(() => resolveRoute({ name: 'graph' }, caps)).not.toThrow()
      expect(() => resolveRoute({ name: 'stepper' }, caps)).not.toThrow()
    }
  })
})
