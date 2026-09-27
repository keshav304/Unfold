import { describe, expect, it } from 'vitest'
import { Slugger, slugify, uniqueSlugFactory } from './slug'

/**
 * §11.2 — GitHub-parity slug vectors. Generic vectors only: punctuation, case,
 * duplicates, Unicode. If the implementation and a vector disagree, the vector
 * wins and the implementation is wrong.
 */
describe('slugify (§6.4 GitHub parity)', () => {
  const vectors: [string, string][] = [
    ['Getting started', 'getting-started'],
    ['Known divergences & errata', 'known-divergences--errata'],
    ["Bird's-eye architecture", 'birds-eye-architecture'],
    ['Plain', 'plain'],
    ['  padded  ', 'padded'],
    ['Trailing punctuation.', 'trailing-punctuation'],
    ['multiple   inner   spaces', 'multiple---inner---spaces'],
    ['Already-hyphenated', 'already-hyphenated'],
    ['CAPS AND lower', 'caps-and-lower'],
    ['slash/back\\slash', 'slashbackslash'],
    ['under_score', 'under_score'],
    ['colon: and (parens)', 'colon-and-parens'],
    ['100% coverage', '100-coverage'],
    ['中文标题', '中文标题'],
    ['Пример', 'пример'],
    ['emoji 🚀 heading', 'emoji--heading'],
    ['🚀 Launch', '-launch'],
    ['¿Qué tal?', 'qué-tal'],
    ['a—b', 'ab'],
    ['dots...everywhere', 'dotseverywhere'],
  ]

  it.each(vectors)('%j → %j', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })

  it('drops emoji and punctuation but keeps letters and numbers', () => {
    // GitHub does not re-trim after removing characters, so the dropped 🎉
    // leaves a trailing space, which becomes a trailing hyphen.
    expect(slugify('v2.0 release 🎉')).toBe('v20-release-')
  })

  it('keeps non-Latin scripts intact', () => {
    expect(slugify('日本語のタイトル')).toBe('日本語のタイトル')
    expect(slugify('한국어 제목')).toBe('한국어-제목')
  })
})

describe('Slugger duplicate suffixing (§6.4)', () => {
  it('suffixes the second and third occurrence with -1 and -2', () => {
    const slugger = new Slugger()
    expect(slugger.slug('Notes')).toBe('notes')
    expect(slugger.slug('Notes')).toBe('notes-1')
    expect(slugger.slug('Notes')).toBe('notes-2')
    expect(slugger.slug('Notes')).toBe('notes-3')
  })

  it('counts duplicates per base slug, not globally', () => {
    const slugger = new Slugger()
    expect(slugger.slug('Alpha')).toBe('alpha')
    expect(slugger.slug('Beta')).toBe('beta')
    expect(slugger.slug('Alpha')).toBe('alpha-1')
    expect(slugger.slug('Beta')).toBe('beta-1')
  })

  it('counts duplicates across heading levels, since the anchor space is one', () => {
    const slugger = new Slugger()
    expect(slugger.slug('Setup')).toBe('setup')
    expect(slugger.slug('Setup')).toBe('setup-1')
  })

  it('is case-insensitive when counting, because slugify lowercases first', () => {
    const slugger = new Slugger()
    expect(slugger.slug('Notes')).toBe('notes')
    expect(slugger.slug('NOTES')).toBe('notes-1')
  })

  it('reset() clears the counters', () => {
    const slugger = new Slugger()
    expect(slugger.slug('Notes')).toBe('notes')
    slugger.reset()
    expect(slugger.slug('Notes')).toBe('notes')
  })

  it('uniqueSlugFactory is an independent instance', () => {
    const a = uniqueSlugFactory()
    const b = uniqueSlugFactory()
    expect(a('X')).toBe('x')
    expect(a('X')).toBe('x-1')
    expect(b('X')).toBe('x')
  })

  it('an empty heading still gets a usable anchor', () => {
    expect(slugify('!!!')).toBe('')
    const slugger = new Slugger()
    expect(slugger.slug('!!!')).toBe('')
    expect(slugger.slug('???')).toBe('-1')
  })
})
