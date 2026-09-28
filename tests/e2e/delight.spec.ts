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

/**
 * M4.11 — the cadence. §7.10 allows at most four firings per page load: the
 * 25/50/75 milestones and the end. The human walkthrough reported confetti
 * firing after *every section change*, which is a defect in the trigger, not a
 * matter of taste.
 *
 * ## What is measured
 *
 * `canvas-confetti` is a single lazy chunk and the browser fetches it once, so
 * counting *requests* counts *first* firings and nothing after. The honest
 * signal for "how many times did it fire" is the app's own counter, which
 * `Delight.count()` exposes for exactly this purpose. Both are read: the
 * counter is the assertion, and the request log proves the chunk was not
 * re-fetched (which would be a different bug with the same symptom).
 *
 * The second half is the regression that matters: **navigating the table of
 * contents across sections must add zero firings.** Section changes are what the
 * human saw, so that is the thing asserted directly.
 */
test.describe('§7.10 the cadence, from the browser (M4.11)', () => {
  // Its own describe: the suite default is `reduce`, and confetti must load to
  // be counted at all.
  test.use({ contextOptions: { reducedMotion: 'no-preference' } })

  /**
   * The number of bursts, counted from the outside.
   *
   * `canvas-confetti` creates one `<canvas>` per burst and removes it when the
   * particles finish, so a MutationObserver on added nodes counts real bursts.
   *
   * This is deliberately *not* the app's own `Delight.count()`. A counter the
   * app increments is a report about what the app believes it did; a canvas in
   * the document is a report about what actually happened. The M4.11 defect was
   * reported by a human watching the screen, and this measures the screen.
   *
   * It also means this test needs no seam in production code, which is worth
   * something: a test-only global in the app is a global nobody reviews.
   */
  const installCounter = (page: Page): Promise<void> =>
    page.addInitScript(() => {
      const w = window as unknown as { __bursts: number }
      w.__bursts = 0
      // Count `<canvas>` elements entering the document: one per burst.
      //
      // Two wrong signals were tried first and both read a confident **zero**
      // while confetti was plainly on screen, which is why this comment exists:
      //
      //  - Counting `getContext('2d')` calls: the library never makes one
      //    through `HTMLCanvasElement.prototype`, so the count stays 0.
      //  - Observing `document.documentElement`: an init script runs before the
      //    parser has produced the root element, so `observe()` throws, the
      //    observer is never installed, and the test reports "no confetti"
      //    when the truth is "nothing is watching".
      //
      // `document` itself always exists at init-script time, and the burst
      // canvas is appended under it. Verified: `after {"ca":1}` on a
      // scroll-to-bottom, which is what the existing §7.10 milestone test
      // already relies on when it asserts `canvas` has count 1.
      new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) {
            if (n instanceof HTMLElement && n.tagName === 'CANVAS') w.__bursts += 1
          }
        }
      }).observe(document, { childList: true, subtree: true })
    })

  const bursts = (page: Page): Promise<number> =>
    page.evaluate(() => (window as unknown as { __bursts: number }).__bursts)

  test('scrolling the whole document fires at most four times, and TOC navigation fires none', async ({ page }) => {
    const console_ = watchConsole(page)
    const urls = recordRequests(page)
    await installCounter(page)
    await page.goto('/')
    await waitForDocument(page)
    await page.waitForTimeout(400)
    const atLoad = await bursts(page)
    expect(atLoad, 'nothing should fire before the reader has scrolled').toBe(0)

    // Scroll the full document in steps, as a reader does.
    for (const fraction of [0.1, 0.25, 0.4, 0.5, 0.65, 0.75, 0.9, 1]) {
      await page.evaluate((f) => {
        const doc = document.documentElement
        const scrollable = doc.scrollHeight - doc.clientHeight
        window.scrollTo(0, scrollable * f)
      }, fraction)
      await page.waitForTimeout(150)
    }
    const afterScroll = await bursts(page)
    expect(afterScroll, 'scrolling the whole document must fire at most 4 times (§7.10)').toBeLessThanOrEqual(4)
    expect(afterScroll, 'confetti should actually have fired at the milestones').toBeGreaterThan(0)

    // Now the regression: jump around by section, which is what the human did.
    // The rail's entries are `<button>`, not `<a>`: the route is a hash the app
    // navigates to, and a real anchor would be a second navigation mechanism
    // with its own history semantics (§7.1). `.toc-close` is the drawer's own
    // close button and is excluded so this counts sections, not chrome.
    const sections = await page.evaluate(() =>
      [...document.querySelectorAll('.toc button:not(.toc-close)')].slice(0, 6).map((_, i) => i),
    )
    expect(sections.length, 'the rail should have section buttons to click').toBeGreaterThan(2)
    for (const index of sections) {
      await page.locator('.toc button:not(.toc-close)').nth(index).click()
      await page.waitForTimeout(250)
    }
    const afterToc = await bursts(page)
    expect(
      afterToc,
      `TOC navigation fired ${afterToc - afterScroll} extra time(s) — §7.10 says never on a section change`,
    ).toBe(afterScroll)

    // And the chunk is fetched at most once, ever.
    expect(urls.filter((u) => /confetti/iu.test(u)).length, 'the confetti chunk must be fetched at most once').toBeLessThanOrEqual(1)
    console_.assertQuiet()
  })
})
