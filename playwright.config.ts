/**
 * M2.PW1 — the Playwright project.
 *
 * A real browser, because the classes of defect that needed human eyes are all
 * engine-level: focus traps, focus restore, layout geometry, served-artifact
 * rendering and axe. jsdom can assert that an attribute exists; only a browser
 * can prove that Tab actually cycles.
 *
 * Every context runs with `reducedMotion: 'reduce'`. That is not a convenience:
 * the app already zeroes all animation when reduced motion is requested (spec
 * §8), so a test that waits on a transition to finish would be waiting on
 * nothing. Assert on state, never on sleeps.
 */
import { defineConfig, devices } from '@playwright/test'

/** The port the preview server binds. Fixed, so a stray server is obvious. */
export const PREVIEW_PORT = 4183
export const BASE_URL = `http://127.0.0.1:${PREVIEW_PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './artifacts/e2e/results',
  /* The cap is deliberate: Playwright supplements the unit suite, it does not
   * become a second 500-test project. */
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: 'artifacts/e2e/results.json' }]],
  use: {
    baseURL: BASE_URL,
    /* Spec §8: the app's own a11y feature zeroes every animation, so the suite
     * never has to wait for one. */
    reducedMotion: 'reduce',
    trace: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})