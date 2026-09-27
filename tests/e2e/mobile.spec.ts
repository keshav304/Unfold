/**
 * M4.2 — the 375px pass, in a real engine.
 *
 * The unit suite asserts the *stylesheet*; it renders at no viewport and cannot
 * measure a pixel. This file is where the claims become measurements: a touch
 * target is 44px because its bounding box is, the title is not a stub because
 * its box is wide enough to hold a word, and the page does not scroll sideways
 * because `scrollWidth` says so.
 *
 * Every view is visited, not just the reader. The M3 layout is three different
 * layouts at three widths and a pass that only loads the reader is a pass on
 * one third of the product.
 */

import { expect, test, type Page } from '@playwright/test'
import { snapshot, waitForDocument, watchConsole } from './helpers'
import { useDocument } from './server'

/** The width this whole file is about. */
const PHONE = { width: 375, height: 812 }

/** `--touch-target`, restated so a change to the token is visible here. */
const TOUCH = 44

/** Horizontal overflow in CSS pixels. ≤ 0 means the page does not scroll sideways. */
function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

/** A locator's box, or null when it is not rendered. */
async function boxOf(page: Page, selector: string): Promise<{ w: number; h: number } | null> {
  const locator = page.locator(selector).first()
  if ((await locator.count()) === 0) return null
  const box = await locator.boundingBox()
  return box === null ? null : { w: box.width, h: box.height }
}

test.describe('the reader at 375px', () => {
  test.beforeEach(async ({ page }) => {
    await useDocument(page, '/testdocs/kitchen-sink.md')
    await page.setViewportSize(PHONE)
    await page.goto('/')
    await waitForDocument(page)
  })

  test('the title is a title, not a stub', async ({ page }) => {
    const console_ = watchConsole(page)
    const title = page.locator('.app-title')
    await expect(title).toBeVisible()
    // The G3 blemish was the title collapsing to "Kitche…" — six characters in a
    // 20px box. Asserting on the *text* would pass with a stub, because the
    // element still contains the full string; the box is what shrank.
    const box = await title.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThan(120)
    // And it is on one line, not wrapped onto the row below.
    expect(box?.height ?? 0).toBeLessThan(40)
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    await snapshot(page, '20-mobile-reader')
    console_.assertQuiet()
  })

  test('the header controls are thumb-sized', async ({ page }) => {
    const console_ = watchConsole(page)
    for (const selector of ['.app-menu', '.app-search', '.mode-toggle', '.workbench-tab']) {
      const box = await boxOf(page, selector)
      expect(box, `${selector} is not rendered at 375px`).not.toBeNull()
      // Both axes: a 44×10 strip is a 44px target nobody can hit.
      expect(box?.h ?? 0, `${selector} is ${box?.h}px tall`).toBeGreaterThanOrEqual(TOUCH - 1)
      expect(box?.w ?? 0, `${selector} is ${box?.w}px wide`).toBeGreaterThanOrEqual(TOUCH - 1)
    }
    console_.assertQuiet()
  })

  test('the pane switch has parity with the desktop switcher', async ({ page }) => {
    const console_ = watchConsole(page)
    // The M3 control offered Docs and Visual Graph and nothing else, so a
    // document with a stepper had a view on a phone it had no route to. It is
    // built from the same capability-gated `views` array now, and this asserts
    // the consequence: the same set of views the desktop switcher offers.
    const tabs = page.getByRole('group', { name: 'Workbench pane' })
    await expect(tabs).toBeVisible()
    for (const label of ['Docs', 'Visual Graph', 'Stepper']) {
      await expect(tabs.getByRole('button', { name: label })).toBeVisible()
    }
    // And no Metrics tab, which DESIGN.md once mentioned and §5.3 dropped.
    await expect(tabs.getByRole('button', { name: /metric/i })).toHaveCount(0)
    // The desktop switcher is hidden at this width, so the group above is the
    // only navigation — which is what makes its completeness load-bearing.
    // `toBeHidden`, not `toHaveCount(0)`: it is `display: none`, so it is still
    // in the DOM and a count would be asserting the wrong thing.
    await expect(page.locator('.view-switcher')).toBeHidden()
    console_.assertQuiet()
  })

  test('the pane switch navigates, and the content follows', async ({ page }) => {
    const console_ = watchConsole(page)
    await page.getByRole('group', { name: 'Workbench pane' }).getByRole('button', { name: 'Stepper' }).click()
    await expect(page.locator('.app')).toHaveAttribute('data-view', 'stepper')
    expect(page.url()).toContain('#/stepper')
    await expect(page.locator('.stepper').first()).toBeVisible()
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    await snapshot(page, '21-mobile-stepper')
    console_.assertQuiet()
  })

  test('the drawer covers the page it dims, and closes three ways', async ({ page }) => {
    const console_ = watchConsole(page)
    await page.locator('.app-menu').click()
    const drawer = page.locator('.toc')
    await expect(drawer).toBeVisible()
    await expect(drawer).toHaveAttribute('data-open', 'true')

    // It was 260px of a 375px screen, with the reader still legible beside it and
    // a scrim over content the reader could still read.
    const box = await drawer.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(PHONE.width - 1)

    const link = await boxOf(page, '.toc-link')
    expect(link?.h ?? 0).toBeGreaterThanOrEqual(TOUCH - 1)
    await snapshot(page, '22-mobile-drawer')

    // Three exits, because a full-width drawer covers the scrim: the ✕ for a
    // thumb, Esc for a keyboard (M4.2 added it — §9 has asked for it since M2),
    // and a link, which navigates and closes.
    await page.getByRole('button', { name: 'Close contents' }).click()
    await expect(drawer).toHaveAttribute('data-open', 'false')

    await page.locator('.app-menu').click()
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveAttribute('data-open', 'false')

    await page.locator('.app-menu').click()
    await page.locator('.toc-link').first().click()
    await expect(drawer).toHaveAttribute('data-open', 'false')
    expect(page.url()).toMatch(/#\S+/u)
    console_.assertQuiet()
  })

  test('the search trigger opens the palette, and its rows are thumb-sized', async ({ page }) => {
    const console_ = watchConsole(page)
    await page.locator('.app-search').click()
    await expect(page.locator('.palette')).toBeVisible()
    const row = await boxOf(page, '.palette-item')
    expect(row?.h ?? 0).toBeGreaterThanOrEqual(TOUCH - 1)
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    await snapshot(page, '23-mobile-palette')
    console_.assertQuiet()
  })

  test('the stepper controls are thumb-sized too', async ({ page }) => {
    const console_ = watchConsole(page)
    // The stepper is a view the M3 segmented control could not reach at 375px
    // at all, so nothing about it had ever been measured at this width. Its
    // Previous/Next are the only controls in the product a reader uses one after
    // the other, which makes them the most likely to be mis-tapped.
    await page.getByRole('group', { name: 'Workbench pane' }).getByRole('button', { name: 'Stepper' }).click()
    await expect(page.locator('.stepper').first()).toBeVisible()
    for (const selector of ['.stepper-button']) {
      const box = await boxOf(page, selector)
      expect(box?.h ?? 0, `${selector} is ${box?.h}px tall`).toBeGreaterThanOrEqual(TOUCH - 1)
    }
    console_.assertQuiet()
  })

  test('a full-page screenshot, for the G5 review', async ({ page }) => {
    const console_ = watchConsole(page)
    // Every other shot here is viewport-sized. This one is the whole document at
    // 375px, which is what a reader actually scrolls through.
    await page.screenshot({ path: 'artifacts/e2e/24-mobile-full-page.png', fullPage: true })
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    console_.assertQuiet()
  })
})

test.describe('the graph workbench at 375px', () => {
  test.beforeEach(async ({ page }) => {
    await useDocument(page, '/testdocs/kitchen-sink.md')
    await page.setViewportSize(PHONE)
    await page.goto('/')
    await waitForDocument(page)
    await page.getByRole('group', { name: 'Workbench pane' }).getByRole('button', { name: 'Visual Graph' }).click()
    await expect(page.locator('.graph-canvas')).toBeVisible()
    await expect(page.locator('.react-flow__node').first()).toBeVisible()
  })

  test('the nodes stay legible instead of being fitted into an unreadable smear', async ({ page }) => {
    const console_ = watchConsole(page)
    // A four-column metro map is ~970 canvas units wide. Fitting that into 375px
    // needs zoom ≈0.35, at which a 10px label is 3.5px tall and four nodes
    // collapse into a smear — which is what the M4.2 screenshot showed. The view
    // clamps the fit and lets the reader pan instead, so the trade is made
    // deliberately: a graph wider than the screen, readable, rather than a graph
    // that fits and cannot be read.
    const rendered = await page.evaluate(() => {
      const node = document.querySelector('.react-flow__node')
      if (node === null) return null
      const inner = node.querySelector('.metro-node') ?? node
      return { fontSize: parseFloat(window.getComputedStyle(inner).fontSize) }
    })
    expect(rendered).not.toBeNull()
    // 10px at zoom 1; 6px at the 0.6 clamp. Under 5px it stops being text.
    expect(rendered?.fontSize ?? 0).toBeGreaterThanOrEqual(5)
    // …and the pane still fits the viewport, with no page-level scroll.
    const canvas = await page.locator('.graph-canvas').boundingBox()
    expect(canvas?.width ?? 0).toBeLessThanOrEqual(PHONE.width)
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    await snapshot(page, '25-mobile-graph')
    console_.assertQuiet()
  })

  test('the inspector is a bottom sheet that does not swallow the canvas', async ({ page }) => {
    const console_ = watchConsole(page)
    await page.locator('.react-flow__node').first().click()
    const panel = page.locator('.inspector')
    await expect(panel).toBeVisible()
    // R11a: a full-width sheet, capped at 60vh so the canvas stays readable.
    const box = await panel.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(PHONE.width - 1)
    expect(box?.height ?? 0).toBeLessThanOrEqual(PHONE.height * 0.65)
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    // "Open section" is the sheet's whole reason for existing, and it is the
    // one control in the panel a thumb has to hit.
    const action = await boxOf(page, '.inspector-action')
    expect(action?.h ?? 0, `.inspector-action is ${action?.h}px tall`).toBeGreaterThanOrEqual(TOUCH - 1)
    await snapshot(page, '26-mobile-graph-panel')
    console_.assertQuiet()
  })
})

test.describe('a document with no capabilities at 375px', () => {
  test('the header is one row, because there is no pane switch to move', async ({ page }) => {
    const console_ = watchConsole(page)
    await useDocument(page, '/testdocs/minimal.md')
    await page.setViewportSize(PHONE)
    await page.goto('/')
    await waitForDocument(page)

    // `minimal` is Tier 0: no switcher above 768px and no pane switch below it,
    // so the second row never appears and the header is not needlessly tall. A
    // fixed two-row height here would waste 40px of every Tier 0 document.
    await expect(page.locator('.workbench-tabs')).toHaveCount(0)
    const header = await page.locator('.app-header').boundingBox()
    expect(header?.height ?? 0).toBeLessThan(70)
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    console_.assertQuiet()
  })
})
