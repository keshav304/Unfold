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
import { PREVIEW_PORT } from './tests/e2e/server'

export const BASE_URL = `http://127.0.0.1:${PREVIEW_PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './artifacts/e2e/results',
  /* Build once, serve `dist/` once, share the server with every worker. */
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
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
    trace: 'off',
    video: 'off',
    /**
     * Spec §8: the app's own a11y feature zeroes every animation, so the suite
     * never has to wait for one. This is a *browser context* option, which is
     * why it lives here rather than at the top level of `use`.
     */
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})