/**
 * M4.6 — derive the `size-adjust` / `ascent-override` figures in `fonts.css`.
 *
 * Lighthouse reports the largest-contentful element as **the reader's first
 * paragraph**, so the largest thing on the page is text, and text re-lays-out
 * when its webfont arrives: `font-display: swap` paints a fallback, and the
 * swap changes every line's width, re-rendering the LCP element. The fix is a
 * fallback face with the *same metrics*, declared with `size-adjust` and the
 * ascent/descent/line-gap overrides.
 *
 * The ratios cannot be typed in from a README, and they cannot be read out of
 * the woff2 files without a font-parsing dependency this project is not allowed
 * to install. So they are **measured**, in a real browser, by this script:
 * render the same text in the real face and in the local fallback, and report
 * the ratio of the resulting line box.
 *
 * Run it after changing a font or its fallback:
 *
 *     npx vite-node scripts/font-fallbacks.ts
 *
 * It prints figures to paste into `src/styles/fonts.css` and — because a
 * number nobody can reproduce is a number nobody can check — it prints the
 * measurement it made, not just the answer.
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { PREVIEW_PORT, distDir, repoRoot, startServer } from '../tests/e2e/server'

/** The three faces and the local font each falls back to. */
const FACES = [
  { family: 'Geist Variable', fallback: 'Arial', label: 'Geist' },
  { family: 'Inter Variable', fallback: 'Arial', label: 'Inter' },
  { family: 'JetBrains Mono Variable', fallback: '"Courier New"', label: 'JetBrains Mono' },
] as const

/** A paragraph in the reader's own body size, which is the LCP element's. */
const SAMPLE = 'The parser reads the source and writes a document object.'

async function main(): Promise<void> {
  execFileSync('npx', ['vite', 'build'], { cwd: repoRoot(), stdio: 'ignore' })
  const server = await startServer(PREVIEW_PORT + 9)
  const browser = await chromium.launch()
  const page = await browser.newPage()

  try {
    await page.goto(`http://127.0.0.1:${PREVIEW_PORT + 9}/`)
    await page.waitForSelector('.app')
    await page.evaluate(() => document.fonts.ready.then(() => undefined))

    for (const face of FACES) {
      const measured = await page.evaluate(
        ({ family, fallback, text }) => {
          const measure = (stack: string): number => {
            const probe = document.createElement('div')
            probe.style.cssText = [
              'position:absolute',
              'visibility:hidden',
              'top:-9999px',
              'left:0',
              'white-space:nowrap',
              // `line-height: normal` explicitly, or the probe inherits this
              // page's line-height and every face measures identically — which
              // is what the first version of this script did, reporting 100%
              // for all three.
              'line-height:normal',
              'font-size:64px',
              `font-family:${stack}`,
            ].join(';')
            probe.textContent = text
            document.body.append(probe)
            // **Width**, not height. `size-adjust` scales advance widths, and
            // the thing a font swap actually breaks in a paragraph is *wrapping*:
            // if the fallback's advances differ, the same text re-wraps into a
            // different number of lines, the block's height changes, and the
            // LCP element re-renders. A line-box height comparison cannot see
            // any of that.
            const width = probe.getBoundingClientRect().width
            probe.remove()
            return width
          }
          const real = measure(`'${family}'`)
          const fall = measure(fallback)
          return { real, fallback: fall, ratio: fall === 0 ? 1 : real / fall }
        },
        { family: face.family, fallback: face.fallback, text: SAMPLE },
      )

      // `size-adjust` is how much the *fallback* must be scaled so that its line
      // box matches the real face's — the inverse of the measured ratio.
      const sizeAdjust = (1 / measured.ratio) * 100
      process.stdout.write(
        `${face.label.padEnd(16)} real ${measured.real.toFixed(1)}px  ` +
          `fallback ${measured.fallback.toFixed(1)}px  ` +
          `→ size-adjust: ${sizeAdjust.toFixed(2)}%\n`,
      )
    }
    process.stdout.write(
      '\nPaste into src/styles/fonts.css. The ascent/descent/line-gap overrides are\n' +
        'deliberately not derived: this measurement reads advance widths, which is\n' +
        'what re-wraps a paragraph, and those overrides change the inline box\n' +
        'instead. Guessing them would be worse than omitting them.\n',
    )
  } finally {
    await browser.close()
    server.closeAllConnections()
    server.close()
  }
}

await main()
