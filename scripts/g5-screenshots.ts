/**
 * M4.9 / G5 — capture the release screenshots.
 *
 * Four full-page images of the **built** artifact served over real HTTP:
 * the reader in Reference mode and in Executive mode at desktop, and the same
 * pair at 375px. Full-page rather than viewport, because the question the
 * screenshots exist to answer is "what does the whole document look like in
 * each mode, and does 375px hold up top to bottom" — a viewport crop cannot
 * answer either.
 *
 * Not a test. It asserts nothing and fails nothing; a human reads the images.
 * That is deliberate: the assertions about these two surfaces already exist as
 * `reading-mode.spec.ts` and `mobile.spec.ts`, and a screenshot that also
 * asserted would be a second place for the same rule to live.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'
import { PREVIEW_PORT, repoRoot, startServer } from '../tests/e2e/server'

const OUT = join(repoRoot(), 'artifacts', 'g5')

type Shot = { file: string; width: number; mode: 'reference' | 'executive' }

const SHOTS: Shot[] = [
  { file: 'g5-01-reference-desktop.png', width: 1440, mode: 'reference' },
  { file: 'g5-02-executive-desktop.png', width: 1440, mode: 'executive' },
  { file: 'g5-03-reference-375.png', width: 375, mode: 'reference' },
  { file: 'g5-04-executive-375.png', width: 375, mode: 'executive' },
]

/** Executive mode is a per-document toggle, so it is set the way a reader sets it. */
async function setMode(page: Page, mode: Shot['mode']): Promise<void> {
  const button = page.getByRole('button', { name: 'Executive mode' })
  const pressed = (await button.getAttribute('aria-pressed')) === 'true'
  if ((mode === 'executive') !== pressed) await button.click()
}

const main = async (): Promise<void> => {
  mkdirSync(OUT, { recursive: true })
  const server = await startServer(PREVIEW_PORT)
  const browser = await chromium.launch()
  try {
    for (const shot of SHOTS) {
      const context = await browser.newContext({ viewport: { width: shot.width, height: 900 } })
      const page = await context.newPage()
      await page.goto(`http://127.0.0.1:${PREVIEW_PORT}/`, { waitUntil: 'load' })
      await page.locator('.app').first().waitFor()
      await setMode(page, shot.mode)
      // The mode flip is a 250ms transition; the reveal animation is
      // time-based, so give the page a beat to settle before capturing.
      await page.waitForTimeout(900)
      await page.screenshot({ path: join(OUT, shot.file), fullPage: true })
      const height = await page.evaluate(() => document.documentElement.scrollHeight)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      process.stdout.write(
        `g5: ${shot.file.padEnd(32)} ${String(shot.width).padStart(4)}px  ${shot.mode.padEnd(9)}  ` +
          `full height ${height}px  horizontal overflow: ${overflow ? 'YES — a defect' : 'none'}\n`,
      )
      await context.close()
    }
  } finally {
    await browser.close()
    server.closeAllConnections()
    await new Promise<void>((done) => {
      server.close(() => done())
    })
  }
}

void main()
