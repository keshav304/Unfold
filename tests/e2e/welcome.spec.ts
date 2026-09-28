/**
 * M4.12 — the front door: the brand wordmark, the welcome view, and the
 * app-wide drop handler.
 *
 * The drop half is the one the human could not confirm, and the reason is in
 * the code: the drop screen is not mounted when a document is loaded, so a
 * handler that lives there can never see the case the brief is about. M4.11b
 * is closed by the handler being on `window` instead, and these tests are what
 * make that a fact rather than a claim.
 */
import { expect, test } from '@playwright/test'
import { waitForDocument, watchConsole } from './helpers'

test.describe('§7 the front door', () => {
  test('the wordmark is the leftmost header element and goes to #/welcome', async ({ page }) => {
    const console_ = watchConsole(page)
    await page.goto('/')
    await waitForDocument(page)

    const brand = page.locator('.app-brand')
    await expect(brand).toBeVisible()
    await expect(brand).toHaveText('UNFOLD')
    await expect(brand).toHaveAttribute('href', '#/welcome')

    // Leftmost: nothing may precede it in the header's own box order.
    const first = await page.evaluate(() => {
      const header = document.querySelector('.app-header')
      if (header === null) return null
      const items = [...header.children].filter((el) => el.offsetParent !== null || el.classList.contains('app-brand'))
      return items[0]?.className ?? null
    })
    expect(first, 'the wordmark must be the first thing in the header').toContain('app-brand')

    // The divider between the brand and the document title.
    await expect(page.locator('.app-brand__divider')).toHaveCount(1)

    await brand.click()
    await expect(page).toHaveURL(/#\/welcome$/u)
    await expect(page.locator('.welcome')).toBeVisible()
    console_.assertQuiet()
  })

  test('the welcome view states the product and offers the keyboard path', async ({ page }) => {
    const console_ = watchConsole(page)
    await page.goto('/#/welcome')
    await expect(page.locator('.welcome__title')).toHaveText('Unfold')
    await expect(page.locator('.welcome__tagline')).toHaveText('Any markdown file in. An interactive document out.')

    // The three steps, with their mono numerals.
    await expect(page.locator('.welcome__step')).toHaveCount(3)
    await expect(page.locator('.welcome__step-n').first()).toHaveText('01')

    // Eight named feature cards.
    await expect(page.locator('.welcome__feature')).toHaveCount(8)

    // The file picker is inside the drop zone: a drag target is unreachable by
    // keyboard, so the button is the contract and the dashed card is only the
    // affordance.
    const drop = page.locator('.welcome__drop')
    await expect(drop).toBeVisible()
    await expect(drop.locator('button', { hasText: 'Choose a .md file' })).toBeVisible()
    await expect(drop.locator('input[type=file]')).toHaveCount(1)

    // A configured docPath offers the secondary route, and the loaded document
    // is named.
    await expect(drop.locator('button', { hasText: 'Open the bundled document' })).toBeVisible()
    await expect(page.locator('.welcome__reading')).toContainText('Reading:')

    // Dashed, and *heavier than the 1px dividers* it is meant to stand out
    // from. Asserted as 2px, not the brief's 1.5px: Chrome snaps a dashed
    // border to whole pixels, so `1.5px dashed` computes to `1px` and would be
    // painted identically to the rules it is meant to out-weigh. See the
    // stylesheet comment.
    const border = await drop.evaluate((el) => getComputedStyle(el).borderTopWidth)
    expect(border, 'the drop zone must be visibly heavier than a 1px divider').toBe('2px')
    expect(
      await drop.evaluate((el) => getComputedStyle(el).borderTopStyle),
      'the drop zone must be dashed',
    ).toBe('dashed')
    console_.assertQuiet()
  })

  test('dropping onto a LOADED document swaps documents (M4.11b)', async ({ page }) => {
    const console_ = watchConsole(page)
    await page.goto('/')
    await waitForDocument(page)
    await expect(page.locator('.app-title')).toHaveText('Kitchen Sink Fixture')

    // The reader is up, so the drop screen is NOT mounted. If the handler still
    // works, it is app-wide; if it does not, the handler was in the drop screen.
    await expect(page.locator('.drop-screen')).toHaveCount(0)

    // A real DataTransfer, because dispatching a synthetic DragEvent with a
    // faked `dataTransfer` does not exercise the FileReader path at all.
    const buffer = await page.evaluateHandle(
      ([name, body]) =>
        new File([body as string], name as string, { type: 'text/markdown' }),
      ['dropped.md', '# Dropped\n\nA different document entirely.\n'],
    )
    const dataTransfer = await page.evaluateHandle((file) => {
      const dt = new DataTransfer()
      dt.items.add(file as File)
      return dt
    }, buffer)
    await page.dispatchEvent('body', 'drop', { dataTransfer })
    await page.waitForTimeout(600)

    // The document was replaced, and the app is still the app.
    await expect(page.locator('.app-title')).toHaveText('Dropped')
    await expect(page.locator('body')).toContainText('A different document entirely')
    console_.assertQuiet()
  })

  test('#/welcome is linkable, so it survives a reload', async ({ page }) => {
    await page.goto('/#/welcome')
    await page.reload()
    await expect(page.locator('.welcome')).toBeVisible()
  })
})
