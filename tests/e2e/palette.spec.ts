/**
 * M2.PW3 — the palette in a real engine.
 *
 * This file exists because jsdom cannot verify the thing that matters most
 * about a dialog. It has no focus ring, no tab order and no concept of what
 * `document.activeElement` will be after an overlay unmounts — so the jsdom
 * palette tests are fast smoke, and *this* is the authority on focus behaviour.
 *
 * Nothing here sleeps. The app already zeroes every animation under reduced
 * motion, so a wait on a transition would be a wait on nothing; each assertion
 * is on state.
 */

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openPaletteWithKeyboard, snapshot, waitForDocument, watchConsole , openReader } from './helpers'
import { useDocument } from './server'

/** The element that currently has focus, described for an assertion message. */
async function activeElement(page: Page): Promise<{ tag: string; class: string; text: string }> {
  return page.evaluate(() => {
    const el = document.activeElement
    if (el === null) return { tag: '(none)', class: '', text: '' }
    return {
      tag: el.tagName,
      class: typeof el.className === 'string' ? el.className : '',
      text: (el.textContent ?? '').trim().slice(0, 40),
    }
  })
}

/** The axe violations as readable strings, so a failure says what and where. */
async function violations(page: Page, include?: string): Promise<string[]> {
  const builder = new AxeBuilder({ page })
  const results = include === undefined ? await builder.analyze() : await builder.include(include).analyze()
  return results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target).join(', ')}`)
}

test.describe('the palette in a real browser', () => {
  test.beforeEach(async ({ page }) => {
    await useDocument(page, '/testdocs/kitchen-sink.md')
    await openReader(page)
  })

  test('Cmd+K opens it, arrows move, Enter navigates, Esc restores focus', async ({ page }) => {
    const console_ = watchConsole(page)

    // The trigger is where focus starts, and where it must come back to.
    await page.locator('.app-search').focus()
    expect((await activeElement(page)).class).toContain('app-search')

    await openPaletteWithKeyboard(page)
    await expect(page.locator('.palette-input')).toBeFocused()

    // Arrows move the selection; cmdk marks it with data-selected.
    await expect(page.locator('.palette-item').first()).toHaveAttribute('data-selected', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.palette-item').nth(1)).toHaveAttribute('data-selected', 'true')

    // Type a query so the artifact shows a real result set, then capture the
    // palette while it is OPEN — a screenshot of a dismissed dialog is not
    // evidence of anything.
    await page.keyboard.type('operational')
    await expect(page.locator('.palette-item').first()).toContainText('Operational notes')
    await snapshot(page, '06-palette-open')

    await page.keyboard.press('Enter')
    await expect(page.locator('.palette')).toHaveCount(0)
    // The result navigated: the hash is the section that was selected...
    expect(page.url()).toMatch(/#\S+/)
    // ...and the reader actually scrolled to it. Polled rather than slept on,
    // because the scroll is asynchronous and a fixed wait is a race.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const target = document.querySelector('[data-slug="operational-notes"]')
          return target === null ? null : Math.round(target.getBoundingClientRect().top)
        }),
      )
      .toBeLessThan(120)

    // Esc, and focus is back on the trigger — the whole point of the exercise.
    await page.keyboard.press('Meta+k')
    await expect(page.locator('.palette')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.palette')).toHaveCount(0)
    expect((await activeElement(page)).class, 'focus did not return to the trigger').toContain('app-search')

    console_.assertQuiet()
  })

  test('Tab cycles inside the open palette and never reaches the page behind', async ({ page }) => {
    const console_ = watchConsole(page)
    await openPaletteWithKeyboard(page)

    // A dialog that lets Tab out is the classic defect. Press it more times
    // than there are focusable things inside; focus must never leave.
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press('Tab')
      const inside = await page.evaluate(() => {
        const palette = document.querySelector('.palette')
        return palette !== null && palette.contains(document.activeElement)
      })
      expect(inside, `focus escaped the palette after ${step + 1} Tab presses`).toBe(true)
    }
    // And the page behind is genuinely still there to be escaped into.
    await expect(page.locator('.reader')).toBeVisible()
    console_.assertQuiet()
  })

  test('/ is inert while focus is in a text field', async ({ page }) => {
    const console_ = watchConsole(page)

    // In an input, a slash is a slash: it goes into the query rather than
    // being swallowed as a shortcut.
    await openPaletteWithKeyboard(page)
    const input = page.locator('.palette-input')
    await input.fill('opera')
    await input.press('/')
    await expect(input).toHaveValue('opera/')
    await expect(page.locator('.palette')).toBeVisible()

    // And the palette still filters, so the field is live rather than stuck.
    await expect(page.locator('.palette-item').first()).toContainText('Operational notes')
    console_.assertQuiet()
  })

  test('Esc on a focused chip popover returns focus to the chip', async ({ page }) => {
    const console_ = watchConsole(page)
    const chip = page.locator('.entity-chip').first()
    await chip.scrollIntoViewIfNeeded()
    await chip.focus()

    const card = page.locator('.popover')
    await expect(card).toBeVisible()
    // Portalled out of the reader and positioned fixed: a chip inside the
    // `overflow-x: auto` table wrapper would otherwise have it clipped.
    await expect(card).toHaveCSS('position', 'fixed')
    // Captured while the card is open, for the same reason as the palette.
    await snapshot(page, '07-chip-popover')

    await page.keyboard.press('Escape')
    await expect(card).toHaveCount(0)
    expect((await activeElement(page)).class, 'focus did not return to the chip').toContain('entity-chip')
    console_.assertQuiet()
  })

  test('every action row actually runs when it is clicked', async ({ page }) => {
    const console_ = watchConsole(page)
    // A regression test for a defect four milestones old. The overlay closed the
    // palette on `onMouseDown`, so the press unmounted the row before the
    // `click` that would have selected it: in a real browser every static row —
    // the graph, the stepper, and now the reading mode — closed the palette and
    // did nothing. jsdom could not see it, because `fireEvent.click` sends no
    // mousedown; the M2/M3 suites only ever *located* these rows.
    await openPaletteWithKeyboard(page)
    await expect(page.locator('[data-action="graph"]')).toBeVisible()
    await page.locator('[data-action="graph"]').click()

    // Both halves: the palette closed *and* the view changed. Asserting only the
    // first is what let this through the first time.
    await expect(page.locator('.palette')).toHaveCount(0)
    await expect(page.locator('.app')).toHaveAttribute('data-view', 'graph')
    expect(page.url()).toContain('#/graph')
    console_.assertQuiet()
  })

  test('a press on the scrim still dismisses, and so does Esc', async ({ page }) => {
    const console_ = watchConsole(page)
    // The other half of the fix above: the scrim must still be a scrim.
    await openPaletteWithKeyboard(page)
    // The overlay's own padding is the backdrop; the centre is the dialog.
    await page.locator('.palette-overlay').click({ position: { x: 5, y: 5 } })
    await expect(page.locator('.palette')).toHaveCount(0)

    await openPaletteWithKeyboard(page)
    await page.keyboard.press('Escape')
    await expect(page.locator('.palette')).toHaveCount(0)
    console_.assertQuiet()
  })

  test('the open palette is clean under axe-core', async ({ page }) => {
    const console_ = watchConsole(page)
    await openPaletteWithKeyboard(page)
    await expect(page.locator('.palette-item').first()).toBeVisible()
    // Zero violations, not "fewer than before". A palette is a dialog with a
    // listbox inside it, which is the structure axe is strictest about.
    expect(await violations(page, '.palette')).toEqual([])
    console_.assertQuiet()
  })

  test('the reader page introduces no new axe violations', async ({ page }) => {
    const console_ = watchConsole(page)
    // Zero violations, not "fewer than before".
    //
    // This gate used to name one audit and print it: `KNOWN_OWNED_BY_M4_3`
    // carried `color-contrast`, because `--text-subtle` was failing AA on
    // informational text. M4.3 ratified the fix (see DECISIONS.md) and migrated
    // every informational use to `--text-muted`, which clears AA on all four
    // surfaces. The named exception is deleted rather than commented out: an
    // allowlist entry that is no longer needed is a hole in the gate, and a
    // comment is not a reason to keep one.
    //
    // `landmark-unique` used to be in that list too — two table scrollers both
    // called "Table" — and M2 fixed it by naming each after its header row.
    expect(await violations(page)).toEqual([])
    console_.assertQuiet()
  })
})