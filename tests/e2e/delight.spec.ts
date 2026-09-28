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
