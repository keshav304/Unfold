/**
 * M4.4 — the §8 motion contract, in a real engine.
 *
 * The whole suite runs `reducedMotion: 'reduce'` (see `playwright.config.ts`),
 * and that is deliberate: the app zeroes every animation under reduced motion,
 * so the rest of the suite never waits on a transition. It also means the
 * reduced-motion half of §8 is verified by *every other test* — if an animation
 * did not neutralise, a test elsewhere would time out on it.
 *
 * So this file is about the half that needs motion to exist. There is exactly
 * one describe with a per-test override, and it exists for one reason: a suite
 * that only ever runs reduced can pass with **no animation at all** and still
 * call itself green. The three signature moments have to be proven to exist, to
 * be named, and to be timed — otherwise "reduced motion → everything is
 * instant" is a claim about a product that does not move.
 */

import { expect, test } from '@playwright/test'
import { snapshot, waitForDocument, watchConsole } from './helpers'
import { useDocument } from './server'

/** Computed motion on one element, as a plain object for an assertion message. */
async function motionOf(page: import('@playwright/test').Page, selector: string): Promise<{
  name: string
  duration: string
  iteration: string
} | null> {
  return page.evaluate((target) => {
    const el = document.querySelector(target)
    if (el === null) return null
    const style = window.getComputedStyle(el)
    return {
      name: style.animationName,
      duration: style.animationDuration,
      iteration: style.animationIterationCount,
    }
  }, selector)
}

/**
 * Record every distinct `animation-name`/duration/iteration a selector shows
 * over a window, sampled on every animation frame.
 *
 * ## Why this exists
 *
 * The mode-flip test used to click, then `await expect(...).toHaveAttribute(...)`
 * — which polls — and only then read the computed style. The transition is
 * **250ms**. On a loaded machine the poll outlasts the transition, the computed
 * style has already reverted to `none`, and the test failed on a correct
 * implementation with `Received: "none"`. That is not a flake in the app; it is
 * a test that measures its own subject after the subject is gone.
 *
 * The fix is not to sleep longer. It is to **sample while the animation is
 * running** and assert that the expected value was *observed*, which is a
 * stronger claim than "the value is there at some arbitrary later moment": a
 * transition that never started produces no reading, and this fails.
 */
async function motionDuring(
  page: import('@playwright/test').Page,
  selector: string,
  act: () => Promise<void>,
  windowMs = 1200,
): Promise<{ name: string; duration: string; iteration: string }[]> {
  await page.evaluate((target) => {
    const w = window as unknown as { __samples: { name: string; duration: string; iteration: string }[] }
    w.__samples = []
    const until = performance.now() + 3000
    const tick = (): void => {
      const el = document.querySelector(target)
      if (el !== null) {
        const style = window.getComputedStyle(el)
        const last = w.__samples[w.__samples.length - 1]
        const reading = {
          name: style.animationName,
          duration: style.animationDuration,
          iteration: style.animationIterationCount,
        }
        // Only keep transitions in the *recorded* set, but sample continuously so
        // a later change is still caught.
        if (last === undefined || last.name !== reading.name || last.duration !== reading.duration) {
          w.__samples.push(reading)
        }
      }
      if (performance.now() < until) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, selector)
  await act()
  await page.waitForTimeout(windowMs)
  return page.evaluate(() => (window as unknown as { __samples: { name: string; duration: string; iteration: string }[] }).__samples)
}

test.describe('§8 reduced motion: the suite default, everything instant', () => {
  test.beforeEach(async ({ page }) => {
    await useDocument(page, '/testdocs/kitchen-sink.md')
    await page.goto('/')
    await waitForDocument(page)
  })

  test('the ambient loops run once and not at all', async ({ page }) => {
    const console_ = watchConsole(page)
    // An infinite loop under reduced motion is the one §8 failure that would
    // never time out a test: it just keeps running, forever, silently burning
    // frames on a reader who asked it not to. `animation-iteration-count: 1`
    // and `animation-duration: 0ms` are what stop it.
    const loop = await motionOf(page, '.loop-edge--closing')
    expect(loop, 'the loop diagram is missing from the reader').not.toBeNull()
    expect(loop?.duration).toBe('0s')
    expect(loop?.iteration).toBe('1')
    console_.assertQuiet()
  })

  test('the palette spring is a zero-duration no-op', async ({ page }) => {
    const console_ = watchConsole(page)
    await page.locator('.app-search').click()
    await expect(page.locator('.palette')).toBeVisible()
    const spring = await motionOf(page, '.palette')
    // The name is still there — the stylesheet is unchanged — but there is no
    // time to play it in. That is the correct static fallback, not a missing
    // animation: the palette appears instantly and fully formed.
    expect(spring?.name).toBe('palette-spring')
    expect(spring?.duration).toBe('0s')
    console_.assertQuiet()
  })

  test('the graph panel arrives without animating', async ({ page }) => {
    const console_ = watchConsole(page)
    await page.goto('/#/graph')
    await expect(page.locator('.react-flow__node').first()).toBeVisible()
    await page.locator('.react-flow__node').first().click()
    const panel = await motionOf(page, '.inspector')
    expect(panel?.name).toBe('panel-in')
    expect(panel?.duration).toBe('0s')
    console_.assertQuiet()
  })

  test('the stepper transition is a no-op', async ({ page }) => {
    const console_ = watchConsole(page)
    await page.goto('/#/stepper/2')
    await expect(page.locator('.stepper').first()).toBeVisible()
    const step = await motionOf(page, '.stepper-panel')
    expect(step?.name).toBe('step-in')
    expect(step?.duration).toBe('0s')
    console_.assertQuiet()
  })
})

test.describe('§8 the signature moments, with motion actually allowed', () => {
  // The one per-test override in the suite. `contextOptions` rather than a bare
  // `reducedMotion`, because in `@playwright/test` 1.61 that option lives on
  // `BrowserContextOptions` rather than on `PlaywrightTestOptions` — so this is
  // both the documented form and the only one that type-checks.
  //
  // It is one describe rather than a whole project because a second project would
  // run the *entire* suite with motion on, and the rest of the suite is written
  // on the assumption that it is not — reduced motion is what makes "assert on
  // state, never on sleeps" possible.
  test.use({ contextOptions: { reducedMotion: 'no-preference' } })

  test.beforeEach(async ({ page }) => {
    await useDocument(page, '/testdocs/kitchen-sink.md')
    await page.goto('/')
    await waitForDocument(page)
  })

  test('the palette springs in — signature moment #1', async ({ page }) => {
    const console_ = watchConsole(page)
    await page.locator('.app-search').click()
    await expect(page.locator('.palette')).toBeVisible()
    const spring = await motionOf(page, '.palette')
    // Named, present, and on the §8 non-signature ceiling with the spring curve.
    // A palette that simply appeared would pass every other test in this suite.
    expect(spring?.name).toBe('palette-spring')
    expect(spring?.iteration).toBe('1')
    const seconds = parseFloat(spring?.duration ?? '0')
    expect(seconds).toBeGreaterThan(0)
    expect(seconds).toBeLessThanOrEqual(0.25)
    const timing = await page.evaluate(() => {
      const el = document.querySelector('.palette')
      return el === null ? '' : window.getComputedStyle(el).animationTimingFunction
    })
    // The overshoot is what makes it a spring rather than a fade, and it is the
    // one curve in the app that is not `--ease-out`.
    expect(timing).toContain('cubic-bezier')
    await snapshot(page, '40-motion-palette-spring')
    console_.assertQuiet()
  })

  test('the graph panel slides in — signature moment #2', async ({ page }) => {
    const console_ = watchConsole(page)
    await page.goto('/#/graph')
    await expect(page.locator('.react-flow__node').first()).toBeVisible()
    await page.locator('.react-flow__node').first().click()
    const panel = await motionOf(page, '.inspector')
    expect(panel?.name).toBe('panel-in')
    expect(panel?.duration).toBe('0.25s')
    expect(panel?.iteration).toBe('1')
    console_.assertQuiet()
  })

  test('the stepper transitions — signature moment #3', async ({ page }) => {
    const console_ = watchConsole(page)
    await page.goto('/#/stepper')
    await expect(page.locator('.stepper').first()).toBeVisible()
    const step = await motionOf(page, '.stepper-panel')
    expect(step?.name).toBe('step-in')
    expect(step?.duration).toBe('0.25s')
    console_.assertQuiet()
  })

  test('the ambient loops are slow when they are allowed to run', async ({ page }) => {
    const console_ = watchConsole(page)
    // §8 asks for ambient loops to be slow. The reduced-motion tests above prove
    // they stop; this proves that when they run they are a 6.4s drift rather
    // than the 560ms flicker `--motion-reveal` would have given them — which is
    // what M4.4 changed, and what no other assertion in the suite would notice.
    const loop = await motionOf(page, '.loop-edge--closing')
    expect(loop?.iteration).toBe('infinite')
    const seconds = parseFloat(loop?.duration ?? '0')
    expect(seconds, 'the ambient loop is not slow').toBeGreaterThan(2)
    expect(seconds).toBeLessThanOrEqual(10)
    console_.assertQuiet()
  })

  test('the mode flip is on the ceiling and is not a signature moment', async ({ page }) => {
    const console_ = watchConsole(page)
    // §8 says exactly three. The mode flip is a whole-document reflow and the
    // tempting move is to give it signature treatment; it stays at 250ms, and
    // this is the assertion that says so in a browser.
    const samples = await motionDuring(page, '.reader', async () => {
      await page.getByRole('button', { name: 'Executive mode' }).click()
    })

    // The mode actually changed...
    await expect(page.locator('.reader')).toHaveAttribute('data-reading-mode', 'executive')

    // ...and the flip was *observed* while it ran, at the §8 ceiling.
    const flip = samples.find((s) => /^mode-flip-[ab]$/u.test(s.name))
    expect(
      flip,
      `no mode-flip animation was observed; saw ${JSON.stringify(samples.map((s) => `${s.name}@${s.duration}`))}`,
    ).toBeDefined()
    expect(flip?.duration).toBe('0.25s')
    console_.assertQuiet()
  })
})
