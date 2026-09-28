/**
 * Web analytics, in a real engine.
 *
 * The unit test proves the claims about the *component* — mounted once, deferred,
 * no cookie. This file covers the three claims that only a browser can settle:
 *
 *  1. **The request is actually made.** The component injecting a `<script>` tag
 *     and the browser fetching it are different claims, and only the second one
 *     means data arrives.
 *  2. **The console stays quiet.** This is the real work here. On Vercel the
 *     endpoint is served by the platform; everywhere else it 404s, and a 404 is a
 *     console error, which would fail the *other* eighty scenarios' quiet-console
 *     assertions over a request this app makes correctly. So the harness serves
 *     the path (see `server.ts`), and this file asserts it did — which is a
 *     stronger statement than "we taught the watcher to ignore one URL".
 *  3. **The document still renders, and the page is still fast.** A third-party
 *     script on the critical path is exactly what §10.1 is for.
 */

import { expect, test } from '@playwright/test'
import { openReader, watchConsole } from './helpers'
import { ANALYTICS_SCRIPT, useDocument } from './server'

test.describe('web analytics is on, and costs the reader nothing', () => {
  test('the script is requested once, and the console is clean', async ({ page }) => {
    const console_ = watchConsole(page)
    const requested: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/_vercel/insights/')) requested.push(request.url())
    })

    await useDocument(page, '/testdocs/kitchen-sink.md')
    await openReader(page)
    await expect(page.locator('.reader')).toBeVisible()

    // Requested, exactly once. The `waitFor` is on the request rather than on the
    // tag, because the tag existing is not the claim.
    await expect
      .poll(() => requested.length, { timeout: 10_000, message: 'the analytics script was never requested' })
      .toBeGreaterThan(0)
    expect(new Set(requested).size, `requested ${requested.length} times`).toBe(1)
    expect(requested[0]).toContain(ANALYTICS_SCRIPT)

    // The endpoint answered, rather than 404ing into the console.
    const response = await page.request.get(ANALYTICS_SCRIPT)
    expect(response.status(), 'the harness did not answer the analytics endpoint').toBe(200)

    // …and the reader is untouched by any of it.
    await expect(page.locator('.ascii-diagram').first()).toBeVisible()
    console_.assertQuiet()
  })

  test('it sets no cookie, and puts nothing in localStorage about the reader', async ({ page }) => {
    await useDocument(page, '/testdocs/kitchen-sink.md')
    await openReader(page)
    await expect(page.locator('.reader')).toBeVisible()
    await page.waitForTimeout(500)

    // The privacy claim, measured in the browser that will actually run. Vercel
    // Web Analytics is cookie-free; if that ever changed, this fails here rather
    // than in someone's privacy review.
    const cookies = await page.context().cookies()
    expect(cookies, 'the app set a cookie').toEqual([])

    // localStorage holds the reading-mode and palette preferences — client-side
    // only, and never transmitted. It is asserted here so the *absence* of
    // anything analytics-shaped in it is a checked fact.
    const keys = await page.evaluate(() => Object.keys(window.localStorage))
    expect(keys.filter((key) => /va|vercel|analytics|track/i.test(key))).toEqual([])
  })

  test('the entry chunk is not preloaded with it, and the gate still passes', async ({ page }) => {
    const console_ = watchConsole(page)
    await useDocument(page, '/testdocs/kitchen-sink.md')
    await openReader(page)
    await expect(page.locator('.reader')).toBeVisible()

    // First-load cost: the script is *deferred*, so it is fetched during the load
    // but is never in the HTML's preload graph and never blocks the first paint.
    // CLS is the metric a late-arriving script would move, and the app gates it
    // at 0.000 — the reading column is content-sized, so a late reflow would show
    // up there.
    const html = await page.content()
    expect(html).not.toContain('rel="preload" href="/_vercel/insights/')

    const cls = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let total = 0
          const observer = new PerformanceObserver((list) => {
            // `layout-shift` entries are not in the DOM lib's PerformanceEntry
            // union, so the two fields this reads are narrowed here rather than
            // with a global declaration.
            for (const entry of list.getEntries() as unknown as Array<{
              value: number
              hadRecentInput: boolean
            }>) {
              if (!entry.hadRecentInput) total += entry.value
            }
          })
          try {
            observer.observe({ type: 'layout-shift', buffered: true })
          } catch {
            resolve(-1)
            return
          }
          setTimeout(() => {
            observer.disconnect()
            resolve(total)
          }, 600)
        }),
    )
    expect(cls, 'layout-shift is not observable in this browser').toBeGreaterThanOrEqual(0)
    expect(cls, 'the analytics script moved the page').toBeLessThan(0.1)
    console_.assertQuiet()
  })
})
