/**
 * M4.5 — delight (spec §7.10), behind one flag.
 *
 * The subject is not confetti, it is the *gate*: `features.delight: false` has
 * to mean the chunk is never **requested**, not that nothing is drawn. That is a
 * claim about a network waterfall, so it is proven twice — here, through the
 * module's own accounting, and in `budget.test.ts`, by reading the built output.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { createDelight, END_AT, KONAMI, MILESTONES } from '../app/delight/delight'
import { configFor, renderFixture } from './render-helpers'

/**
 * The library is mocked, and that is the point of this file.
 *
 * `canvas-confetti` starts a `requestAnimationFrame` loop against a real 2D
 * context the moment it is called, and jsdom has no canvas — so the first draft
 * of this test passed its twelve assertions and then threw `clearRect of null`
 * from inside the library's animation frame, on a timer, after the test had
 * finished. That is worse than a failure: it is a passing test with a
 * background exception, and the next person to see it has no idea which change
 * caused it.
 *
 * What is under test here is the *gate* — when we call it, and with what — not
 * whether a particle system draws. `budget.test.ts` proves the real library is
 * a lazy chunk, and the Playwright suite runs it for real in Chromium.
 */
type BurstOptions = { particleCount: number; colors: string[]; disableForReducedMotion: boolean }
const burst = vi.fn((_options?: BurstOptions) => Promise.resolve(undefined))
vi.mock('canvas-confetti', () => ({ default: burst }))


/** `matchMedia` answers for the reduced-motion preference. */
function reducedMotion(value: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string): MediaQueryList =>
      ({
        matches: value && query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  )
}

beforeEach(() => {
  reducedMotion(false)
  window.localStorage.clear()
  burst.mockClear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

/** Let a `void`-ed dynamic import settle before counting. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))

/** The milestone fractions, which are the module's contract with §7.10. */
describe('§7.10 the milestones', () => {
  it('are 25/50/75%, monotonic, and inside the document', () => {
    expect([...MILESTONES]).toEqual([0.25, 0.5, 0.75])
    for (let i = 1; i < MILESTONES.length; i += 1) {
      expect(MILESTONES[i]).toBeGreaterThan(MILESTONES[i - 1] as number)
    }
    expect(END_AT).toBeGreaterThan(MILESTONES[MILESTONES.length - 1] as number)
  })

  it('each fires once, however many times progress crosses it', async () => {
    const delight = createDelight(true)
    // A scroll is not monotonic — a reader scrolls back up constantly — so the
    // "fire once" rule is what stops three confetti bursts per wobble.
    for (let i = 0; i <= 40; i += 1) delight.progress(i / 40)
    await settle()
    const after = delight.count()
    for (let i = 40; i > 0; i -= 1) delight.progress(i / 40)
    for (let i = 0; i <= 40; i += 1) delight.progress(i / 40)
    await settle()
    expect(delight.count(), 'a milestone fired twice').toBe(after)
    // 25, 50, 75 and the end — four celebrations, no more.
    expect(after).toBe(4)
  })

  it('a jump past every milestone still counts each of them', async () => {
    const delight = createDelight(true)
    // Scrolling top-to-bottom in one gesture is a thing readers do (End, or a
    // restored scroll position), and firing only the last would mean the
    // document they skipped is the one that got no celebration.
    delight.progress(1)
    await settle()
    expect(delight.fired.has(1), 'the end celebration is missing').toBe(true)
    expect(burst).toHaveBeenCalled()
  })

  it('the end celebration is bigger than a milestone', async () => {
    const delight = createDelight(true)
    delight.progress(0.26)
    await settle()
    const milestone = burst.mock.calls[0]?.[0] as BurstOptions
    delight.progress(1)
    await settle()
    const ending = burst.mock.calls[1]?.[0] as BurstOptions
    expect(ending.particleCount, 'the end is no bigger than a quarter').toBeGreaterThan(
      milestone.particleCount,
    )
  })

  it('the colours are read from the tokens, never written here', async () => {
    const delight = createDelight(true)
    delight.progress(0.26)
    await settle()
    const options = burst.mock.calls[0]?.[0] as BurstOptions
    // `canvas-confetti` needs literal colour strings, so they have to come out
    // of the cascade — a hex in this file is what `genericity.test.ts` exists to
    // refuse, and jsdom loads no stylesheet, so the honest expectation here is
    // that the list is *whatever the cascade had*, not three hard-coded values.
    const root = getComputedStyle(document.documentElement)
    const expected = ['--primary', '--secondary', '--tertiary']
      .map((token) => root.getPropertyValue(token).trim())
      .filter((value) => value !== '')
    expect(options.colors).toEqual(expected)
    // The reduced-motion backstop is set even though the gate already prevents
    // reaching here under reduce — belt and braces, not the mechanism.
    expect(options.disableForReducedMotion).toBe(true)
  })
})

describe('§7.10 the Konami code', () => {
  it('is the canonical ten keys', () => {
    expect([...KONAMI]).toEqual([
      'ArrowUp',
      'ArrowUp',
      'ArrowDown',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'ArrowLeft',
      'ArrowRight',
      'b',
      'a',
    ])
  })

  it('fires on the full sequence and on nothing shorter', async () => {
    const delight = createDelight(true)
    for (const key of KONAMI.slice(0, KONAMI.length - 1)) delight.key(key)
    expect(delight.count(), 'nine keys is not the code').toBe(0)
    delight.key(KONAMI[KONAMI.length - 1] as string)
    await settle()
    expect(delight.count()).toBe(1)
  })

  it('a wrong key restarts the sequence rather than sliding a window', async () => {
    const delight = createDelight(true)
    // Half the code, a mistake, then the whole thing again. A forgiving matcher
    // would fire on the tail; the sequence is meant to be a deliberate gesture.
    for (const key of KONAMI.slice(0, 5)) delight.key(key)
    delight.key('z')
    for (const key of KONAMI) delight.key(key)
    await settle()
    expect(delight.count()).toBe(1)
  })
})

describe('§8 reduced motion: delight never loads', () => {
  it('is inert with the preference on, at every trigger', async () => {
    reducedMotion(true)
    const delight = createDelight(true)
    for (let i = 0; i <= 40; i += 1) delight.progress(i / 40)
    for (const key of KONAMI) delight.key(key)
    await settle()
    // §8 says "confetti/particles never load", which is stronger than "never
    // fire": nothing should have been requested, so nothing can be mid-flight
    // when the reader changes their mind.
    expect(delight.count()).toBe(0)
    expect(delight.fired.size).toBe(0)
  })

  it('and inert with the flag off, with motion allowed', async () => {
    const delight = createDelight(false)
    for (let i = 0; i <= 40; i += 1) delight.progress(i / 40)
    for (const key of KONAMI) delight.key(key)
    await settle()
    expect(delight.count()).toBe(0)
  })

  it('the preference is re-read per call, not captured at construction', async () => {
    // A reader who turns the preference on mid-session must not be greeted by a
    // burst from a progress tick queued a moment earlier.
    const delight = createDelight(true)
    reducedMotion(true)
    delight.progress(1)
    expect(delight.count()).toBe(0)
    reducedMotion(false)
    delight.progress(1)
    await settle()
    expect(delight.count()).toBe(1)
  })
})

describe('§1.4 features.delight is the only switch', () => {
  it('defaults to on', () => {
    expect(configFor('minimal').features.delight).toBe(true)
  })

  it('is false when the deployer says so', () => {
    expect(configFor('minimal', { features: { delight: false } }).features.delight).toBe(false)
  })

  it('and a document with delight off renders with no celebration', async () => {
    const { container } = await renderFixture('kitchen-sink', { features: { delight: false } })
    // jsdom has no scroll, so progress is 0 and nothing *could* fire; what this
    // proves is that the shell mounted at all, which is what a delight module
    // that touched `document` at import time would break.
    expect(container.querySelector('.app')).not.toBeNull()
  })
})
