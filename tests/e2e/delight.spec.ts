/**
 * M4.5 — delight in a real engine (spec §7.10, §8).
 *
 * The unit test proves the gate's *logic*; this proves the gate's *effect*,
 * which is a claim about the network: with `features.delight: false`, or under
 * reduced motion, no chunk carrying confetti is ever requested. That cannot be
 * observed from inside the page, so it is observed from the only place that can
 * — the list of requests the browser made.
 *
 * The second half is the inverse: with delight on and motion allowed, the chunk
 * *is* fetched, and only when a milestone is actually reached. A "lazy" chunk
 * that the entry preloads would pass a "never requested" test and still cost
 * every reader the bytes.
 */

import { expect, test, type Page } from '@playwright/test'
import { waitForDocument, watchConsole } from './helpers'
import { useDocument, SET_DOC_PATH } from './server'

/** Requested URLs, recorded from the moment the listener is attached. */
function recordRequests(page: Page): string[] {
  const urls: string[] = []
  page.on('request', (request) => urls.push(request.url()))
  return urls
}

/** Was anything from the confetti chunk fetched? */
const fetchedConfetti = (urls: string[]): boolean => urls.some((url) => /confetti/iu.test(url))

test.describe('§7.10 the flag, from the browser', () => {
  test('delight off: the confetti chunk is never requested', async ({ page }) => {
    const console_ = watchConsole(page)
    const urls = recordRequests(page)
    // The test host serves the config per request, so "off" is a real deployer
    // decision here rather than a prop threaded through a component.
    await page.request.get(`${SET_DOC_PATH}?docPath=${encodeURIComponent('/testdocs/kitchen-sink.md')}`)
    await page.addInitScript(() => {
      const original = window.fetch
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('unfold.config.json')) {
          return new Response(JSON.stringify({ docPath: '/testdocs/kitchen-sink.md', features: { delight: false } }), {
            headers: { 'content-type': 'application/json' },
          })
        }
        return original(input as RequestInfo, init)
      }
    })
    await page.goto('/')
    await waitForDocument(page)

    // Scroll the whole document, past every milestone, several times.
    for (const fraction of [0.3, 0.6, 0.8, 1, 0.2, 1]) {
      await page.evaluate((f) => window.scrollTo(0, document.body.scrollHeight * f), fraction)
      await page.waitForTimeout(60)
    }
    // …and type the Konami code.
    for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) {
      await page.keyboard.press(key)
    }
    await page.waitForTimeout(120)

    expect(fetchedConfetti(urls), 'the confetti chunk was fetched with delight off').toBe(false)
    // The app itself is fine, which is the point: the flag removes a decoration,
    // not a feature.
    await expect(page.locator('.reader')).toBeVisible()
    expect(await page.locator('.code-block').count()).toBeGreaterThan(0)
    console_.assertQuiet()
  })

  test('delight on, reduced motion: still never requested', async ({ page }) => {
    const console_ = watchConsole(page)
    const urls = recordRequests(page)
    await page.goto('/')
    await waitForDocument(page)

    // This context runs `reducedMotion: 'reduce'`, so §8's "confetti/particles
    // never load" is in force. The gate is checked before the import, so the
    // chunk is not merely unused — it is not fetched.
    for (const fraction of [0.3, 0.6, 0.8, 1]) {
      await page.evaluate((f) => window.scrollTo(0, document.body.scrollHeight * f), fraction)
      await page.waitForTimeout(60)
    }
    for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) {
      await page.keyboard.press(key)
    }
    await page.waitForTimeout(120)

    expect(fetchedConfetti(urls), 'reduced motion fetched the confetti chunk').toBe(false)
    console_.assertQuiet()
  })

})

test.describe('§7.10 delight on and motion allowed', () => {
  // Its own describe, because `test.use` is a declaration and Playwright does
  // not accept one inside a test body. The M4.4 motion spec needed the same
  // shape for the same reason.
  test.use({ contextOptions: { reducedMotion: 'no-preference' } })

  test('the chunk arrives when a milestone is reached, and not before', async ({ page }) => {
    const console_ = watchConsole(page)
    const urls = recordRequests(page)
    await page.goto('/')
    await waitForDocument(page)

    // Nothing yet: the reader is at the top and has earned nothing. This is the
    // assertion the "never requested" tests above cannot make — they pass
    // whether the chunk is lazy or simply never triggered.
    expect(fetchedConfetti(urls), 'confetti was fetched before any milestone').toBe(false)

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(250)
    // Now it is. The inverse matters as much as the first: a "lazy" chunk that
    // the entry preloads passes every other test here and still costs every
    // reader the bytes on first paint.
    expect(fetchedConfetti(urls), 'the confetti chunk never arrived at a milestone').toBe(true)
    // The canvas the library draws on is real, in a real browser, at a real
    // milestone — this is the assertion jsdom could not make at all.
    await expect(page.locator('canvas')).toHaveCount(1)
    console_.assertQuiet()
  })
})

/** Record every `unfold:celebrate` the app announces. */
const recordCelebrations = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const w = window as unknown as { __ev: number[] }
    w.__ev = []
    window.addEventListener('unfold:celebrate', (e) => {
      w.__ev.push((e as CustomEvent<{ milestone: number }>).detail.milestone)
    })
  })
}

const celebrations = (page: Page): Promise<number[]> =>
  page.evaluate(() => (window as unknown as { __ev: number[] }).__ev)

/**
 * M4.11c — the cadence, asserted on the app's own events.
 *
 * ## Why events and not canvases
 *
 * M4.11 counted `<canvas>` elements entering the document and concluded the
 * milestones under-fired (one burst across a full scroll, at ~65%). That
 * conclusion was **wrong**, and the reason it was wrong is the reason this file
 * no longer sniffs the DOM at all.
 *
 * `canvas-confetti` reuses a single canvas across bursts, so only the *first*
 * burst ever inserts one. The counter could not see the second firing of
 * anything. Measured on `unfold:celebrate` instead, the truth is
 * `[0.25, 0.5, 0.75, 1]` — four events, once each, in order, and nothing
 * further when the reader scrolls back up and down again.
 *
 * The scroll geometry *does* grow while reading (`scrollHeight` 4173 → 4827 over
 * ~2.8s as M4.6's idle-deferred mermaid and Shiki land), so a fraction measured
 * early is a fraction of a smaller page. That is real, and it is also not a
 * defect: `progress()` is recomputed from the live geometry on every scroll, and
 * `fired` is a set, so a late threshold is reached late rather than missed.
 * **No ResizeObserver was added**, because adding machinery to fix a defect that
 * measurement says is not there is the failure mode this whole rewrite exists to
 * avoid.
 *
 * ## The assertion that matters
 *
 * The old test said "at most 4". That is exactly the assertion that let the
 * under-fire look like a pass. This one says **exactly 4, in this order**.
 */
test.describe('§7.10 the cadence, from the browser (M4.11c)', () => {
  // Its own describe: the suite default is `reduce`, and the celebration is
  // suppressed there by design.
  test.use({ contextOptions: { reducedMotion: 'no-preference' } })

  test('a full scroll fires exactly four celebrations, in order, and TOC navigation adds none', async ({ page }) => {
    const console_ = watchConsole(page)
    await recordCelebrations(page)
    await page.goto('/')
    await waitForDocument(page)

    expect(await celebrations(page), 'nothing may fire before the reader scrolls').toEqual([])

    // Walk the document the way a reader does. Small steps, so a threshold
    // cannot be stepped over between two samples.
    const steps = 40
    for (let i = 1; i <= steps; i += 1) {
      await page.evaluate((f) => {
        const doc = document.documentElement
        window.scrollTo(0, (doc.scrollHeight - doc.clientHeight) * f)
      }, i / steps)
      await page.waitForTimeout(40)
    }
    await page.waitForTimeout(300)

    const afterScroll = await celebrations(page)
    expect(
      afterScroll,
      `expected exactly the four milestones in order, got ${JSON.stringify(afterScroll)}`,
    ).toEqual([0.25, 0.5, 0.75, 1])

    // Monotonic: back to the top and down again changes nothing.
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(150)
    await page.evaluate(() => {
      const doc = document.documentElement
      window.scrollTo(0, doc.scrollHeight)
    })
    await page.waitForTimeout(250)
    expect(await celebrations(page), 're-reading must not re-fire a milestone').toEqual(afterScroll)

    // The regression the human reported: section changes are not milestones.
    const sections = await page.evaluate(
      () => document.querySelectorAll('.toc button:not(.toc-close)').length,
    )
    expect(sections, 'the rail should have section buttons to click').toBeGreaterThan(2)
    for (let i = 0; i < Math.min(6, sections); i += 1) {
      await page.locator('.toc button:not(.toc-close)').nth(i).click()
      await page.waitForTimeout(200)
    }
    expect(
      await celebrations(page),
      'navigating the rail fired extra celebrations — §7.10 says never on a section change',
    ).toEqual(afterScroll)

    console_.assertQuiet()
  })
})

test.describe('§8 reduced motion: the celebration is silent', () => {
  // Its own describe, and deliberately NOT inheriting the
  // `no-preference` above. `test.use` applies to a whole describe block, so
  // putting this test inside it meant it ran with motion *allowed* and failed
  // for the right reason at the wrong layer — a reduced-motion test that is not
  // running reduced motion is worse than no test.
  test.use({ contextOptions: { reducedMotion: 'reduce' } })

  test('reduced motion announces nothing at all', async ({ page }) => {
    // The suite default is already `reduce`; this states the expectation at the
    // layer that matters, so the reduced-motion contract has its own test rather
    // than being implied by another one passing.
    await recordCelebrations(page)
    await page.goto('/')
    await waitForDocument(page)
    for (const f of [0.25, 0.5, 0.75, 1]) {
      await page.evaluate((fr) => {
        const doc = document.documentElement
        window.scrollTo(0, (doc.scrollHeight - doc.clientHeight) * fr)
      }, f)
      await page.waitForTimeout(80)
    }
    expect(await celebrations(page), 'reduced motion must announce no celebrations (§8)').toEqual([])
  })
})
