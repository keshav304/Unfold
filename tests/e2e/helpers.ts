/**
 * Shared helpers for the e2e scenarios.
 *
 * The important one is `failOnConsoleNoise`. Spec §9 and the M2 brief both treat
 * a console error or warning as a failure: a served-artifact bug that logs a
 * warning is still a bug, and the class of defect ui-smoke could not see is
 * exactly the one that arrives with a console message attached.
 */

import { expect, type ConsoleMessage, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const ARTIFACT_DIR = join('artifacts', 'e2e')

/**
 * Attach console capture to a page and assert the page was quiet.
 *
 * Call `assertQuiet()` at the end of a scenario, not inside this function: the
 * interesting question is whether the console stayed clean *throughout*, and
 * asserting on the way in would miss everything logged afterwards.
 */
export function watchConsole(page: Page): { assertQuiet: () => void; messages: string[] } {
  const messages: string[] = []
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      messages.push(`${message.type()}: ${message.text()}`)
    }
  })
  page.on('pageerror', (error: Error) => {
    messages.push(`pageerror: ${error.message}`)
  })

  return {
    messages,
    assertQuiet(): void {
      expect(messages, `the page logged:\n  ${messages.join('\n  ')}`).toEqual([])
    },
  }
}

/** Save one screenshot per scenario, for human review. Never diffed (M2 brief). */
export async function snapshot(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACT_DIR, { recursive: true })
  await page.screenshot({ path: join(ARTIFACT_DIR, `${name}.png`), fullPage: false })
}

/**
 * Get from the front door into the reader (M4.12).
 *
 * `#/` is the welcome view and does not fetch, so `goto('/')` alone no longer
 * yields a document — deliberately, because arriving at the root is not a
 * request for the configured document. 29 tests want a *reader*, so they say so
 * explicitly, the way a person would: click the button.
 *
 * The point of putting this in one helper rather than a `beforeEach` is that a
 * fixture that auto-opens the document would make the front door untestable
 * everywhere at once. This is opt-in per test, so the front door keeps its own
 * tests and its own meaning.
 */
export async function openReader(page: Page): Promise<void> {
  /*
   * Clear the "a document is already open in this session" flag *before* the
   * app mounts, then navigate. Two navigations, and the extra one is not waste:
   *
   *   - The flag is what makes a bare `#/` restore a document across a reload
   *     (M4.12), so a test that opens a reader and then calls this again would
   *     arrive at the *reader* and never see the front door or its button.
   *   - Clearing after mount is too late: `autoLoad` is read once, in a state
   *     initialiser, precisely so it cannot flip on a later navigation.
   *
   * So the flag is cleared on a throwaway load, and the real load sees a clean
   * session. Without this the helper deadlocks on the second call in a test.
   */
  await page.goto('/')
  await page.evaluate(() => sessionStorage.removeItem('unfold:opened'))
  // `reload()`, not a second `goto('/')`. Navigating to the URL you are already
  // on is a same-document navigation: nothing re-executes, the app never
  // re-initialises, and `autoLoad` is read exactly once — so the flag is cleared
  // and then never looked at again, and the front door never appears. A reload
  // is the only way to make the app read the session again.
  await page.reload()

  /*
   * `expect(...).toBeVisible()`, not `waitFor()`.
   *
   * This config sets `expect.timeout` to 10s but leaves `actionTimeout` at
   * Playwright's default of **0 — no limit** — so a `waitFor()` in a helper
   * waits forever instead of failing. A helper that hangs the whole suite is
   * strictly worse than one that fails loudly, and it is worse here because it
   * hangs *silently*: no output, no error, just a run that stops.
   */
  const open = page.getByRole('button', { name: /open the bundled document/i })
  await expect(open, 'the front door must offer the configured document').toBeVisible()
  await open.click()
  await waitForDocument(page)
}

/** Wait for the document to have rendered — the real signal, not a timeout. */
export async function waitForDocument(page: Page): Promise<void> {
  await expect(page.locator('.app').first()).toBeVisible()
}

/** Open the palette with the keyboard, the way a reader does. */
export async function openPaletteWithKeyboard(page: Page): Promise<void> {
  await page.keyboard.press('Meta+k')
  await expect(page.locator('.palette')).toBeVisible()
}

/** The document title as rendered, never as configured. */
export async function renderedTitle(page: Page): Promise<string> {
  return (await page.locator('h1').first().textContent())?.trim() ?? ''
}
