/**
 * M2.PW2 — the served artifact, in a real engine.
 *
 * These are the cases `ui-smoke` covers in jsdom, ported to a browser because
 * two of them were never really tested there: horizontal overflow is a layout
 * fact jsdom does not have, and a "single column" claim is a bounding box, not
 * a CSS string.
 *
 * Every scenario asserts the console stayed clean. A served-artifact bug that
 * logs a warning is still a bug, and that is exactly the class of defect that
 * reached a human's eyes in previous milestones.
 */

import { expect, test } from '@playwright/test'
import { renderedTitle, snapshot, waitForDocument, watchConsole , openReader } from './helpers'
import { MISSING_DOC, useDocument } from './server'

test.describe('the served build renders the document', () => {
  test('kitchen-sink: frontmatter title, every block kind, no overflow', async ({ page }) => {
    await useDocument(page, '/testdocs/kitchen-sink.md')
    const console_ = watchConsole(page)
    await openReader(page)

    // The title comes from frontmatter...
    expect(await renderedTitle(page)).toBe('Kitchen Sink Fixture')
    // ...and the frontmatter is gone, not rendered as text. Asserted on the
    // first rendered block rather than the whole body: the document legitimately
    // contains `---` later on (a thematic break), so a body-wide check would
    // fail for the right reason and the wrong one.
    const firstBlock = (await page.locator('.reader > *').first().textContent()) ?? ''
    expect(firstBlock).not.toContain('---')
    expect(firstBlock).not.toContain('title:')

    // The block kinds this milestone's predecessor shipped, verified against
    // the *served* artifact rather than a jsdom boot.
    await expect(page.locator('.terminal').first()).toBeVisible()
    await expect(page.locator('.loop-svg').first()).toBeVisible()
    await expect(page.locator('.code-block').first()).toBeVisible()
    await expect(page.locator('.reader-table').first()).toBeVisible()

    // Mermaid is lazy: wait for it to settle rather than sleeping.
    const mermaid = page.locator('.mermaid').first()
    await expect(mermaid).toHaveAttribute('data-theme', 'dark')
    await expect(mermaid.locator('svg, pre').first()).toBeVisible()

    // No horizontal overflow at desktop width. This is a real layout fact and
    // jsdom has no opinion about it at all.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, 'the page scrolls horizontally at 1440px').toBeLessThanOrEqual(0)

    await snapshot(page, '01-kitchen-sink-desktop')
    console_.assertQuiet()
  })

  test('kitchen-sink: no horizontal overflow at 375px', async ({ page }) => {
    await useDocument(page, '/testdocs/kitchen-sink.md')
    const console_ = watchConsole(page)
    await page.setViewportSize({ width: 375, height: 812 })
    await openReader(page)

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, 'the page scrolls horizontally at 375px').toBeLessThanOrEqual(0)
    // The table wrapper is allowed to scroll; the page is not.
    await expect(page.locator('.app-main').first()).toBeVisible()

    await snapshot(page, '02-kitchen-sink-mobile')
    console_.assertQuiet()
  })

  test('a wrong docPath is refused with the actionable drop screen (A5)', async ({ page }) => {
    await useDocument(page, MISSING_DOC)
    const console_ = watchConsole(page)
    /*
     * M4.12: `#/` is the front door and does not fetch, so a configured-but-
     * missing document no longer fails on arrival — it is simply not opened.
     * The reader has to ask for it, and *then* §6.1's contract applies: a 404
     * is the designed path to the drop screen, never a blank screen and never
     * the shell pretending to be a document. That is a real behaviour change
     * and it is asserted here rather than assumed.
     */
    await page.goto('/')
    await expect(page.locator('.welcome')).toBeVisible()
    await page.getByRole('button', { name: /open the bundled document/i }).click()
    await expect(page.locator('.drop-screen')).toBeVisible()

    // A5: the shell must be refused, never rendered as a document. This is
    // the escape hatch, verified in a real engine over real HTTP.
    await expect(page.locator('.app')).toHaveCount(0)
    await expect(page.locator('.reader-section')).toHaveCount(0)

    // Actionable: it names the path and points at the config.
    const message = (await page.locator('.drop-message').textContent()) ?? ''
    expect(message).toMatch(/app shell/i)
    expect(message).toContain('definitely-not-deployed.md')
    expect(message).toMatch(/unfold\.config\.json/)

    // And it still offers a way forward.
    await expect(page.locator('.drop-screen input[type="file"]')).toHaveCount(1)

    await snapshot(page, '03-wrong-docpath-dropscreen')
    console_.assertQuiet()
  })

  test('a document with no H2s has no rail and one full-width column', async ({ page }) => {
    await useDocument(page, '/testdocs/no-structure.md')
    const console_ = watchConsole(page)
    await openReader(page)

    // The rail is absent (§7.3) - hidden, not empty.
    await expect(page.locator('.toc')).toHaveCount(0)

    // And the grid collapsed with it, asserted as geometry rather than as a
    // CSS string: the content really does span the main column.
    const main = page.locator('.app-main').first()
    const box = await main.boundingBox()
    expect(box, '.app-main has no box').not.toBeNull()
    const viewport = page.viewportSize()
    expect(box!.width, 'the content column is narrower than the viewport')
      .toBeGreaterThan(viewport!.width * 0.8)

    await snapshot(page, '04-no-structure-single-column')
    console_.assertQuiet()
  })

  test('a document with no capabilities has no view switcher', async ({ page }) => {
    await useDocument(page, '/testdocs/minimal.md')
    const console_ = watchConsole(page)
    await openReader(page)

    await expect(page.locator('.view-switcher')).toHaveCount(0)
    // Search is Tier 0, so the trigger is always there (§1.1).
    await expect(page.locator('.app-search')).toBeVisible()

    await snapshot(page, '05-minimal-no-switcher')
    console_.assertQuiet()
  })
})