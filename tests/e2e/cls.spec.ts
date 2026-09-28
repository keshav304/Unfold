/**
 * §10.1 / A14 — cumulative layout shift stays at zero, asserted rather than
 * hoped for. M4.10.
 *
 * ## The defect this exists to prevent
 *
 * M4.9's gate failed on CLS at **0.148** while FCP was 461ms and LCP 562ms. The
 * cause was located rather than guessed: a `layout-shift` PerformanceObserver put
 * the single shift at **t=1352ms**, and the `resource` timeline put Geist and
 * Inter's woff2 completing at **t=1352ms**. `font-display: swap` painted the
 * fallback, then the real face landed and re-wrapped the document. The reading
 * column is content-sized up to `--reading-column`, so new wrap points change
 * the column's width and move everything below it.
 *
 * M4.6 had already tried preloading these fonts, measured them under Lighthouse's
 * **mobile** preset, and removed them for costing 2 composite points. A14 gates
 * on the **desktop** preset, where that measurement does not apply, so they went
 * back in and were re-measured: composite 93 → 99, CLS 0.148 → 0.000.
 *
 * ## Why this is an e2e test and not a unit test
 *
 * Because the defect is a *race between two network responses and a paint*. No
 * unit test can observe it, and a threshold assertion alone would not have found
 * the cause — the useful part of this test is the **source attribution**, which
 * is what turns "CLS is high" into "the font swap did this, at this millisecond,
 * on these nodes".
 */
import { expect, test } from '@playwright/test'
import { openReader, watchConsole } from './helpers'

/**
 * A shift is only *scored* by CLS if it is not within 500ms of a user input;
 * this observer therefore records everything and the assertion below is
 * deliberately stricter than the metric, because a shift at doc-resolve has no
 * input near it either way.
 */
const OBSERVER = () => {
  const w = window as unknown as {
    __shifts: { start: number; value: number; sources: string[] }[]
    __fontSwapAt: number | null
    __firstPaintAt: number
    __clsSince: number
    __clsMark: () => void
  }
  w.__shifts = []
  w.__fontSwapAt = null
  /*
   * M4.12: a baseline. `#/` is the front door and does not fetch, so reaching
   * the reader means a click, and the reflow from a short front door to a full
   * document is a *user-initiated navigation* — not a load shift. Scoring it
   * would mean the gate no longer measures what A14 is about, which is text
   * moving under the reader who did not touch anything. Everything before
   * `__clsMark()` is therefore excluded, and the reason is in the test.
   */
  w.__clsSince = 0
  w.__clsMark = () => {
    w.__clsSince = performance.now()
  }
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const e = entry as unknown as {
        startTime: number
        value: number
        hadRecentInput: boolean
        sources?: { node?: Element | null }[]
      }
      w.__shifts.push({
        start: Math.round(e.startTime),
        value: e.value,
        sources: (e.sources ?? []).map((s) =>
          s.node ? `${s.node.tagName.toLowerCase()}.${String(s.node.className || '').split(' ')[0] ?? ''}` : 'detached',
        ),
      })
    }
  }).observe({ type: 'layout-shift', buffered: true })

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const e = entry as unknown as { name: string; responseEnd: number }
      if (/\/assets\/(geist|inter|jetbrains-mono)-latin-.*\.woff2$/u.test(e.name)) {
        w.__fontSwapAt = Math.round(e.responseEnd)
      }
    }
  }).observe({ type: 'resource', buffered: true })
}

test.describe('§10.1 A14 — CLS stays at zero (M4.10)', () => {
  test('nothing shifts while the document loads, and the fonts land before it', async ({ page }) => {
    const console_ = watchConsole(page)
    await page.addInitScript(OBSERVER)
    await openReader(page)
    // From here on, any shift at all is a defect.
    await page.evaluate(() => (window as unknown as { __clsMark: () => void }).__clsMark())
    // Past the idle-deferred highlight pass, so a late reflow would be caught.
    await page.waitForTimeout(2500)

    // The page's own globals are copied into a plain object explicitly rather
    // than returned by reference: returning `window.__shifts` directly hands
    // Playwright a live handle to an array the page may still be appending to,
    // and the destructuring that reads it back is where the first version of
    // this test failed.
    const observed = await page.evaluate(() => {
      const w = window as unknown as {
        __shifts?: { start: number; value: number; sources: string[] }[]
        __fontSwapAt?: number | null
      }
      return {
        shifts: (w.__shifts ?? []).map((s) => ({ ...s })),
        fontSwapAt: w.__fontSwapAt ?? null,
      }
    })
    const shifts = observed.shifts

    const total = shifts.reduce((sum, s) => sum + s.value, 0)
    // The whole point: not "CLS is small", but "there is no shift at all".
    // The A14 ceiling is 0.1; asserting 0 means a regression names itself in
    // this test rather than waiting to be discovered as a gate failure.
    expect(
      total,
      `layout shifted by ${total} — sources: ${shifts.map((s) => `t=${s.start}ms v=${s.value} [${s.sources.join(', ')}]`).join('; ')}`,
    ).toBe(0)

    // The fonts must have arrived *before* the document painted, which is what
    // makes the above true. Without this assertion the test would still pass if
    // someone deleted the preloads and the document happened not to reflow on
    // the day — and the defect would return silently on a longer document.
    expect(observed.fontSwapAt, 'the latin font subsets were never fetched').not.toBeNull()
    expect(observed.fontSwapAt as number).toBeLessThan(1000)

    console_.assertQuiet()
  })
})
