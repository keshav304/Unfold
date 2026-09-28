/**
 * M4.3 — the §9 sweep, in a real engine.
 *
 * Everything here is a **whole-page** scan or a focus assertion on state, and
 * both choices are the point. The M2 audit scoped its open-palette scan to
 * `.palette`, which meant the overlay, cmdk's own wrappers and every
 * 375px-only finding sat outside the gate for four milestones; the contrast
 * migration then made "zero violations" true only for the surfaces that
 * happened to be scanned. This file scans whole pages, at both widths, with
 * each overlay open, because that is the only scope in which "zero" means what
 * a reader would experience.
 *
 * The other half of §9 is behavioural — skip link, focus trap, focus restore —
 * and those are asserted on `document.activeElement`, which jsdom cannot do.
 */

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { snapshot, waitForDocument, watchConsole } from './helpers'
import { useDocument } from './server'

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 375, height: 812 }

/** Whole-page axe. Zero violations, named if not. */
async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => `${n.target} ${n.html.slice(0, 90)}`).join(' | ')}`,
  )
}

/** The element that has focus, as a short description for a failure message. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement
    if (el === null) return '(none)'
    const cls = typeof el.className === 'string' ? el.className : ''
    return `${el.tagName.toLowerCase()}.${cls}`.slice(0, 60)
  })
}

test.describe('§9 zero violations, on whole pages, at both widths', () => {
  for (const [name, size] of [
    ['desktop', DESKTOP],
    ['phone', PHONE],
  ] as const) {
    test(`the reader at ${name} width`, async ({ page }) => {
      const console_ = watchConsole(page)
      await useDocument(page, '/testdocs/kitchen-sink.md')
      await page.setViewportSize(size)
      await page.goto('/')
      await waitForDocument(page)
      // M4.3 widened this from the M2 scope. Three findings lived outside what
      // CI had ever scanned — a colour-only inline link, a code scroller that
      // only overflows on a phone, and the missing `dialog` on the palette — and
      // two of the three are invisible at the other width, so both are run.
      expect(await violations(page)).toEqual([])
      console_.assertQuiet()
    })
  }

  test('with the palette open, overlay included', async ({ page }) => {
    const console_ = watchConsole(page)
    await useDocument(page, '/testdocs/kitchen-sink.md')
    await page.setViewportSize(DESKTOP)
    await page.goto('/')
    await waitForDocument(page)
    await page.locator('.app-search').click()
    await expect(page.locator('.palette')).toBeVisible()
    // Whole page, palette open. The `region` findings lived on the *overlay*,
    // outside the `.palette` subtree M2's scan covered.
    expect(await violations(page)).toEqual([])
    console_.assertQuiet()
  })

  test('with the drawer open', async ({ page }) => {
    const console_ = watchConsole(page)
    await useDocument(page, '/testdocs/kitchen-sink.md')
    await page.setViewportSize(PHONE)
    await page.goto('/')
    await waitForDocument(page)
    await page.locator('.app-menu').click()
    await expect(page.locator('.toc')).toHaveAttribute('data-open', 'true')
    expect(await violations(page)).toEqual([])
    console_.assertQuiet()
  })

  test('in executive mode, where every section has a new control in it', async ({ page }) => {
    const console_ = watchConsole(page)
    await useDocument(page, '/testdocs/kitchen-sink.md')
    await page.setViewportSize(DESKTOP)
    await page.goto('/')
    await waitForDocument(page)
    await page.getByRole('button', { name: 'Executive mode' }).click()
    await expect(page.locator('.reader')).toHaveAttribute('data-reading-mode', 'executive')
    await expect(page.locator('.section-expand').first()).toBeVisible()
    expect(await violations(page)).toEqual([])
    console_.assertQuiet()
  })
})

test.describe('§9 the skip link moves focus, and it is outside the landmark', () => {
  test.beforeEach(async ({ page }) => {
    await useDocument(page, '/testdocs/kitchen-sink.md')
    await page.setViewportSize(DESKTOP)
    await page.goto('/')
    await waitForDocument(page)
  })

  test('it is the first focusable thing on the page', async ({ page }) => {
    const console_ = watchConsole(page)
    // It used to be rendered *inside* `<main>` — the first child of the element
    // it points at — so activating it moved focus nowhere. A skip link is the one
    // control whose entire job is to move focus somewhere it is not.
    await page.keyboard.press('Tab')
    await expect(page.locator('.skip-link')).toBeFocused()
    expect(await focused(page), 'the skip link is not the first stop').toContain('skip-link')
    console_.assertQuiet()
  })

  test('it is visibly rendered once focused, not just present', async ({ page }) => {
    const console_ = watchConsole(page)
    const skip = page.locator('.skip-link')
    // Parked off-screen at `left: -9999px` until focused. A skip link that is
    // technically focusable and still invisible is the same defect wearing a hat.
    const parked = await skip.boundingBox()
    expect(parked?.x ?? 0, 'the unfocused skip link should be parked off-screen').toBeLessThan(-1000)
    await page.keyboard.press('Tab')
    const shown = await skip.boundingBox()
    expect(shown?.x ?? -9999, 'focus did not bring the skip link on screen').toBeGreaterThan(0)
    expect(shown?.x ?? 9999).toBeLessThan(DESKTOP.width)
    await snapshot(page, '30-a11y-skip-link')
    console_.assertQuiet()
  })

  test('activating it puts focus on the main landmark', async ({ page }) => {
    const console_ = watchConsole(page)
    // The second half of the same bug: `<main>` had no `tabindex`, so even a
    // correctly-placed link would have scrolled without moving focus, and the
    // next Tab would have resumed from the top of the document.
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(page.locator('main')).toBeFocused()
    expect(await focused(page)).toContain('app-main')
    console_.assertQuiet()
  })
})

test.describe('§9 the drawer: focus in, focus out, focus trapped', () => {
  test.beforeEach(async ({ page }) => {
    await useDocument(page, '/testdocs/kitchen-sink.md')
    await page.setViewportSize(PHONE)
    await page.goto('/')
    await waitForDocument(page)
  })

  test('a closed drawer is not in the tab order at all', async ({ page }) => {
    const console_ = watchConsole(page)
    // `translateX(-100%)` moved it off the screen and did nothing to the tab
    // order: every section link stayed reachable, and a keyboard user landed in
    // an off-screen list with no way to see where they were.
    const tabbable = await page.evaluate(() => {
      const drawer = document.querySelector('.toc')
      if (drawer === null) return -1
      // `offsetParent` is the wrong probe here and was the first thing this test
      // got wrong: it is null for `display: none` and for positioned elements,
      // but **not** for `visibility: hidden` — which is precisely the property
      // that removes an element from the tab order. `checkVisibility` asks the
      // engine the question we actually mean.
      return Array.from(drawer.querySelectorAll('a[href], button')).filter((el) =>
        (el as HTMLElement).checkVisibility({ visibilityProperty: true }),
      ).length
    })
    expect(tabbable, 'links inside a closed drawer are still tab stops').toBe(0)
    console_.assertQuiet()
  })

  test('opening it moves focus inside, and Tab never leaves', async ({ page }) => {
    const console_ = watchConsole(page)
    await page.locator('.app-menu').click()
    await expect(page.locator('.toc')).toHaveAttribute('data-open', 'true')
    // Focus lands on the close button: the one control in the drawer whose
    // meaning does not depend on having read the list.
    await expect(page.getByRole('button', { name: 'Close contents' })).toBeFocused()

    const inside = (): Promise<boolean> =>
      page.evaluate(() => {
        const drawer = document.querySelector('.toc')
        return drawer !== null && drawer.contains(document.activeElement)
      })

    for (let step = 0; step < 10; step += 1) {
      await page.keyboard.press('Tab')
      expect(await inside(), `focus escaped after ${step + 1} Tab presses`).toBe(true)
    }
    // …and backwards too, which is the half a forward-only trap misses.
    for (let step = 0; step < 4; step += 1) {
      await page.keyboard.press('Shift+Tab')
      expect(await inside(), `focus escaped backwards after ${step + 1} Shift+Tab`).toBe(true)
    }
    console_.assertQuiet()
  })

  test('closing it returns focus to the button that opened it', async ({ page }) => {
    const console_ = watchConsole(page)
    // A drawer that swallows focus and does not give it back strands a keyboard
    // user at the top of the document — the exact defect the palette's focus
    // restore was written to avoid, in a different component.
    await page.locator('.app-menu').click()
    await expect(page.locator('.toc')).toHaveAttribute('data-open', 'true')
    await page.keyboard.press('Escape')
    await expect(page.locator('.toc')).toHaveAttribute('data-open', 'false')
    await expect(page.locator('.app-menu')).toBeFocused()
    console_.assertQuiet()
  })

  test('following a link closes it and hands focus back', async ({ page }) => {
    const console_ = watchConsole(page)
    await page.locator('.app-menu').click()
    await page.locator('.toc-link').first().click()
    await expect(page.locator('.toc')).toHaveAttribute('data-open', 'false')
    await expect(page.locator('.app-menu')).toBeFocused()
    expect(page.url()).toMatch(/#\S+/u)
    console_.assertQuiet()
  })
})

test.describe('§9 the document title is the document title', () => {
  test('it is the parsed title, not the product name', async ({ page }) => {
    const console_ = watchConsole(page)
    await useDocument(page, '/testdocs/kitchen-sink.md')
    await page.goto('/')
    await waitForDocument(page)
    // `index.html` ships a hardcoded "Unfold", so the tab strip, the bookmark,
    // the screen-reader window title and the search result all named the product
    // rather than the document being read.
    await expect(page).toHaveTitle('Kitchen Sink Fixture')
    console_.assertQuiet()
  })

  test('it follows the document across views', async ({ page }) => {
    const console_ = watchConsole(page)
    await useDocument(page, '/testdocs/kitchen-sink.md')
    await page.goto('/#/stepper')
    await waitForDocument(page)
    await expect(page).toHaveTitle('Kitchen Sink Fixture')
    console_.assertQuiet()
  })
})
