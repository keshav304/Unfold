/**
 * M4.1 — reading modes in a real engine (spec §7.8).
 *
 * jsdom proves the rule; this file proves the three things only a browser can.
 *
 *  1. **It persists across a real navigation.** `localStorage` in jsdom is a
 *     plain object; here it is the origin's, so a reload is an honest test of
 *     §7.8's "persists in localStorage" — and it is the only place the *first
 *     paint* can be checked, which is the half that matters. A reader who chose
 *     executive mode must never watch the full document render and then shrink.
 *  2. **It is keyboard-operable and axe-clean** with the toggle and the palette
 *     row both present — a control added to the header is a new thing for every
 *     accessibility gate in the suite to have an opinion about.
 *  3. **No-structure is unaffected**, which is a real rendering fact and not a
 *     string comparison.
 */

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openPaletteWithKeyboard, snapshot, waitForDocument, watchConsole , openReader } from './helpers'
import { useDocument } from './server'

/** The axe violations as readable strings, so a failure says what and where. */
async function violations(page: Page, include?: string): Promise<string[]> {
  const builder = new AxeBuilder({ page })
  const results = include === undefined ? await builder.analyze() : await builder.include(include).analyze()
  return results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => `${n.target} ${n.html.slice(0, 100)}`).join(' | ')}`,
  )
}

/** How many blocks one section is showing. */
function sectionBlocks(page: Page, slug: string): Promise<number> {
  return page.evaluate((target) => {
    const section = document.querySelector(`[data-slug="${target}"]`)
    if (section === null) return -1
    return Array.from(section.children).filter(
      (node) => !node.classList.contains('reader-heading') && !node.classList.contains('section-expand'),
    ).length
  }, slug)
}

test.describe('the reading modes in a real browser', () => {
  test.beforeEach(async ({ page }) => {
    await useDocument(page, '/testdocs/kitchen-sink.md')
    await openReader(page)
  })

  test('the header toggle reduces the document, and a reload comes back reduced', async ({ page }) => {
    const console_ = watchConsole(page)

    const section = 'runtime-shape'
    const full = await sectionBlocks(page, section)
    expect(full, 'the fixture section should not be trivially small').toBeGreaterThan(3)

    // A screenshot of each mode of the SAME section, and the scroll is re-taken
    // after every mode change: the document re-flows, so a scroll position
    // carried over from the other mode shows two different sections and the pair
    // — which is the only way to *see* what the heuristic did — proves nothing.
    const frame = async (name: string): Promise<void> => {
      await page.locator(`[data-slug="${section}"]`).scrollIntoViewIfNeeded()
      await snapshot(page, name)
    }
    await frame('10-reading-mode-reference')

    await page.getByRole('button', { name: 'Executive' }).click()
    await expect(page.locator('.reader')).toHaveAttribute('data-reading-mode', 'executive')
    await expect(page.getByRole('button', { name: 'Executive' })).toHaveAttribute('aria-pressed', 'true')
    expect(await sectionBlocks(page, section)).toBeLessThan(full)
    // The heavy blocks are gone, not merely shorter.
    await expect(page.locator(`[data-slug="${section}"] .code-block`)).toHaveCount(0)
    await frame('11-reading-mode-executive')

    // Reload. The mode is in localStorage, and the assertion is made before
    // anything can settle: the document is already executive on arrival.
    await page.reload()
    await expect(page.locator('.reader')).toHaveAttribute('data-reading-mode', 'executive')
    expect(await sectionBlocks(page, section)).toBeLessThan(full)
    console_.assertQuiet()
  })

  test('the per-section override reveals one section, and the mode clears it', async ({ page }) => {
    const console_ = watchConsole(page)
    const section = page.locator('[data-slug="runtime-shape"]')

    await page.getByRole('button', { name: 'Executive' }).click()
    await expect(page.locator('.section-expand').first()).toBeVisible()

    const before = await sectionBlocks(page, 'runtime-shape')
    // `>` — the button that controls *this* section. The H2 contains its H3s,
    // and each of those has a button of its own.
    await section.locator('> .section-expand').click()
    await expect(section).toHaveAttribute('data-expanded', 'true')
    expect(await sectionBlocks(page, 'runtime-shape')).toBeGreaterThan(before)
    await expect(section.locator('> .section-expand')).toHaveText('Show less')

    // Back to reference: the override is gone, because in reference mode every
    // section is already showing all of itself.
    await page.getByRole('button', { name: 'Executive' }).click()
    await expect(page.locator('.reader')).toHaveAttribute('data-reading-mode', 'reference')
    await expect(page.locator('.section-expand')).toHaveCount(0)
    console_.assertQuiet()
  })

  test('the palette row switches the mode, and the app is axe-clean either way', async ({ page }) => {
    const console_ = watchConsole(page)

    await openPaletteWithKeyboard(page)
    const row = page.locator('[data-action="mode:executive"]')
    await expect(row).toBeVisible()
    await expect(row).toContainText('Switch to executive mode')
    // A palette with a new group in it is a new listbox shape; the scan runs on
    // the open palette, which is where the M2 audit found its violations.
    // Scoped to the palette's *dialog* rather than to `.palette`, because M4.3
    // gave the overlay `role="dialog"` and the `region` findings it used to
    // raise live on the overlay and cmdk's own wrappers — outside the subtree
    // the M2 scope covered. The whole page is scanned with the palette closed in
    // the scenario below, so this is a widening of what is *checked*, never a
    // narrowing of what must pass.
    expect(await violations(page, '.palette-overlay')).toEqual([])
    await snapshot(page, '12-palette-reading-mode-row')

    await row.click()
    await expect(page.locator('.palette')).toHaveCount(0)
    await expect(page.locator('.reader')).toHaveAttribute('data-reading-mode', 'executive')
    // And the reader *in* executive mode is clean too: the override buttons are
    // new interactive elements, one per reduced section.
    expect(await violations(page)).toEqual([])
    console_.assertQuiet()
  })

  test('a document with no sections renders identically in both modes', async ({ page }) => {
    const console_ = watchConsole(page)
    await useDocument(page, '/testdocs/no-structure.md')
    await openReader(page)

    // §7.8's rule is stated per H2. With no H2s there is nothing to reduce, and
    // the honest assertion is that: no sections, no override controls, and the
    // introduction still has all of its blocks.
    const before = await page.locator('.reader-intro > *').count()
    expect(before).toBeGreaterThan(1)

    await page.getByRole('button', { name: 'Executive' }).click()
    await expect(page.locator('.reader')).toHaveAttribute('data-reading-mode', 'executive')
    await expect(page.locator('.reader-section')).toHaveCount(0)
    await expect(page.locator('.section-expand')).toHaveCount(0)
    expect(await page.locator('.reader-intro > *').count()).toBe(before)
    console_.assertQuiet()
  })

  test('every header control is still named at 375px', async ({ page }) => {
    const console_ = watchConsole(page)
    // The <768px header sheds the search trigger's word and its `⌘K` hint with
    // `display: none`, and `display: none` takes content out of the
    // accessibility tree. A button named only by a child span therefore loses
    // its name at exactly one width — the width the whole app is designed for.
    // Lighthouse caught it; this asserts it at the width it happens.
    //
    // This test deliberately does **not** run axe over the 375px page. Doing so
    // surfaces two more findings that are not M4.1's — `scrollable-region-
    // focusable` on the terminal `<pre>`, which only overflows at this width,
    // and `link-in-text-block` on `.inline-link--internal` — and neither has
    // ever been scanned at 375px by anything. They are recorded in
    // `docs/DECISIONS.md` for M4.3, which owns the §9 sweep; quietly asserting
    // them green here would either fail CI or buy a pass by scoping the scan
    // away, and neither is the honest move.
    await page.setViewportSize({ width: 375, height: 812 })
    await page.reload()
    await waitForDocument(page)

    // The name is still there even though the word is not on screen.
    await expect(page.locator('.app-search')).toHaveAccessibleName('Search')
    await expect(page.getByRole('button', { name: 'Executive mode' })).toBeVisible()
    console_.assertQuiet()
  })
})
