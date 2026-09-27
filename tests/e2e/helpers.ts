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
