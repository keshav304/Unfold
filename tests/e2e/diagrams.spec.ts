/**
 * M4.13 + M4.14 — the reader's diagrams, in a real engine.
 *
 * jsdom can assert that an SVG element exists and that an `aria-label` is a
 * string. It cannot tell whether the drawing is *legible*, whether the canvas is
 * 360px, whether a page scrolls sideways because of a diagram, or whether the
 * dashed connector's crawl is really stopped for a reader who asked for reduced
 * motion. All four are questions only an engine can answer, and all four are
 * questions a reader will answer with their eyes.
 *
 * The console assertion is on every scenario, as everywhere else in this suite:
 * a diagram that renders *and warns* is still broken.
 */

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openReader, snapshot, watchConsole } from './helpers'
import { useDocument } from './server'

const KITCHEN_SINK = '/testdocs/kitchen-sink.md'
const ASCII_FIXTURE = '/testdocs/ascii-diagrams.md'

async function openFixture(page: Page, docPath: string): Promise<void> {
  await useDocument(page, docPath)
  await openReader(page)
}

/** The axe violations as readable strings, so a failure says what and where. */
async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => `${n.target} ${n.html.slice(0, 80)}`).join(' | ')}`,
  )
}

test.describe('M4.13.1 an explicit `graph` block is a canvas in the reader', () => {
  test.beforeEach(async ({ page }) => {
    await openFixture(page, KITCHEN_SINK)
  })

  test('the canvas is on screen and the DSL source is not the reader\'s picture', async ({ page }) => {
    const console_ = watchConsole(page)
    const canvas = page.locator('.graph-inline')
    await expect(canvas).toBeVisible()
    // Nodes and edges: the graph the document declared, drawn by the same code
    // the workbench draws it with.
    await expect(page.locator('.graph-inline .react-flow__node')).toHaveCount(4)
    await expect(page.locator('.graph-inline .react-flow__edge').first()).toBeVisible()

    // Read-only: no zoom controls, and nothing drags.
    await expect(page.locator('.graph-inline .react-flow__controls')).toHaveCount(0)
    await expect(page.locator('.graph-inline .react-flow__node.draggable')).toHaveCount(0)

    // The source is not what the reader sees for this block.
    await expect(page.locator('.code-block[data-lang="graph"]')).toHaveCount(0)
    // Nor is the code block the reader used to render in place of the graph.
    expect(await page.locator('.reader').innerText()).not.toContain('edges:')

    await canvas.scrollIntoViewIfNeeded()
    await snapshot(page, '50-reader-graph-inline')
    console_.assertQuiet()
  })

  test('the canvas is a diagram in a document, not a workbench: sized to the graph, with a link out', async ({ page }) => {
    const console_ = watchConsole(page)
    const canvas = page.locator('.graph-inline')
    await expect(canvas).toBeVisible()
    const box = await canvas.boundingBox()
    // Sized to the graph: kitchen-sink's graph is one row of four nodes, so the
    // box is the short end of the 168–360px band rather than a fixed 360px of
    // mostly nothing. The ceiling still exists — it is what a taller graph gets.
    expect(box?.height ?? 0, 'the inline canvas is outside its band').toBeGreaterThanOrEqual(168)
    expect(box?.height ?? 0, 'the inline canvas is outside its band').toBeLessThanOrEqual(360)
    // And the graph really does fill it, rather than sitting in a void. The claim
    // is a *share* rather than a margin, because a one-row graph fitted to a
    // column is a fifth of the box by design — what would be wrong is for it to
    // be a twentieth, which is what a fixed 360px around it produced.
    const node = page.locator('.graph-inline .react-flow__node').first()
    const nodeBox = await node.boundingBox()
    const share = (nodeBox?.height ?? 0) / (box?.height ?? 1)
    expect(share, 'the graph is a speck in its own box').toBeGreaterThan(0.15)
    // …and it is centred, not stranded at the top of the frame.
    const above = (nodeBox?.y ?? 0) - (box?.y ?? 0)
    const below = (box?.y ?? 0) + (box?.height ?? 0) - ((nodeBox?.y ?? 0) + (nodeBox?.height ?? 0))
    expect(Math.abs(above - below), 'the graph is not centred in the canvas').toBeLessThan(4)
    expect(above, 'the graph is stranded at the top').toBeLessThan((box?.height ?? 0) / 2)

    // The full experience is one link away, and the link really goes there.
    const link = page.getByRole('link', { name: /open in graph view/i })
    await expect(link).toBeVisible()
    await link.click()
    await expect(page.locator('.graph-workbench')).toBeVisible()
    await expect(page.locator('.graph-workbench .react-flow__controls')).toBeVisible()
    console_.assertQuiet()
  })

  test('and the workbench the graph view already had is untouched by any of it', async ({ page }) => {
    const console_ = watchConsole(page)
    // The regression this protects: a reader-only mini-canvas that quietly took
    // the workbench's options with it. Controls, panel, keyboard, selection.
    await page.getByRole('navigation', { name: 'View' }).getByRole('button', { name: 'Graph' }).click()
    await expect(page.locator('.graph-workbench')).toBeVisible()
    const node = page.locator('.graph-workbench .react-flow__node').first()
    await expect(node).toBeVisible()
    await expect(page.locator('.graph-workbench .react-flow__node.draggable')).toHaveCount(4)
    await node.click()
    await expect(page.locator('.inspector')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.inspector')).toHaveCount(0)
    console_.assertQuiet()
  })
})

test.describe('M4.13.2 an explicit `steps` block is a stepper in the reader', () => {
  test.beforeEach(async ({ page }) => {
    await openFixture(page, KITCHEN_SINK)
  })

  test('the stepper is on screen, walks, and is not the DSL source', async ({ page }) => {
    const console_ = watchConsole(page)
    const stepper = page.locator('.stepper--embedded')
    await expect(stepper).toBeVisible()
    await expect(stepper).toHaveAttribute('data-step', '1')
    await expect(stepper.locator('.step-title')).toHaveText('Submit')
    // A real tablist, so arrows work inside it and a screen reader announces
    // "pick one of three" rather than a pile of buttons.
    await expect(stepper.getByRole('tablist', { name: 'Walkthrough steps' })).toBeVisible()
    await expect(stepper.getByRole('tab')).toHaveCount(3)

    // The source is gone from the reader's rendering of this block.
    await expect(page.locator('.code-block[data-lang="steps"]')).toHaveCount(0)

    // The next step, from the reader's own control.
    await stepper.getByRole('button', { name: 'Next' }).click()
    await expect(stepper).toHaveAttribute('data-step', '2')
    await expect(stepper.locator('.step-title')).toHaveText('Plan')

    await stepper.scrollIntoViewIfNeeded()
    await snapshot(page, '51-reader-steps-inline')
    console_.assertQuiet()
  })

  test('the `@slug` link navigates the reader, and the walkthrough view still works', async ({ page }) => {
    const console_ = watchConsole(page)
    const stepper = page.locator('.stepper--embedded')
    await stepper.getByRole('link', { name: /source section/i }).click()
    await expect(page).toHaveURL(/#environment$/)
    await expect(page.locator('[data-slug="environment"]')).toBeVisible()

    // …and the view this used to be the *only* presentation of is still there.
    await page.getByRole('navigation', { name: 'View' }).getByRole('button', { name: 'Stepper' }).click()
    await expect(page.locator('.stepper').first()).toBeVisible()
    await expect(page.locator('.step-title')).toHaveText('Submit')
    // Its own ids are still §7.7's: the embedded one namespaces its own, so the
    // two can never collide on a page that has both.
    await expect(page.locator('#step-panel')).toHaveCount(1)
    await expect(page.locator('#reader-step-panel')).toHaveCount(0)
    console_.assertQuiet()
  })
})


test.describe('M4.14 ASCII fences become SVG diagrams', () => {
  test.beforeEach(async ({ page }) => {
    await openFixture(page, ASCII_FIXTURE)
  })

  test('the four parseable fences are diagrams and the two refused ones are terminals', async ({ page }) => {
    const console_ = watchConsole(page)
    // A: the vertical flow, B: the same in Unicode, C: interior junctions,
    // D: a vertical arrow.
    await expect(page.locator('.ascii-diagram')).toHaveCount(4)
    // E: hostile prose, F: dangling arrows. Both keep the §1.3 terminal.
    await expect(page.locator('.terminal')).toHaveCount(2)
    // A terminal window is not an error state: it still has its chrome.
    await expect(page.locator('.terminal-light')).toHaveCount(6)
    await page.locator('.ascii-diagram').first().scrollIntoViewIfNeeded()
    await snapshot(page, '52-ascii-fixture-flow')
    await page.locator('.ascii-diagram').nth(1).scrollIntoViewIfNeeded()
    await snapshot(page, '53-ascii-fixture-unicode')
    await page.locator('.ascii-diagram').nth(2).scrollIntoViewIfNeeded()
    await snapshot(page, '54-ascii-fixture-junctions')
    await page.locator('.terminal').first().scrollIntoViewIfNeeded()
    await snapshot(page, '56-ascii-fixture-hostile')
    console_.assertQuiet()
  })

  test('a parseable fence is a diagram with boxes, edges and an accessible name', async ({ page }) => {
    const console_ = watchConsole(page)
    const first = page.locator('.ascii-diagram').first()
    await expect(first).toHaveAttribute('data-nodes', '4')
    await expect(first).toHaveAttribute('data-edges', '4')
    await expect(first.locator('rect.ascii-node__box')).toHaveCount(4)
    await expect(first.locator('polyline.ascii-edge__path')).toHaveCount(4)
    // Every connector ends in an arrowhead marker, and none of them is left
    // pointing at empty space.
    await expect(first.locator('marker-end, polyline.ascii-edge__path')).toHaveCount(4)

    // The name is generated from the parsed graph — the fixture's own boxes — and
    // the raw ASCII is not the diagram's accessible representation.
    const label = await first.locator('svg').getAttribute('aria-label')
    expect(label).toContain('Diagram: ')
    expect(label).toContain('Browser → Dev server')
    expect(label).not.toContain('+--')
    console_.assertQuiet()
  })

  test('the Unicode fence normalises to the same diagram as the ASCII one', async ({ page }) => {
    const console_ = watchConsole(page)
    const ascii = page.locator('.ascii-diagram').nth(0)
    const unicode = page.locator('.ascii-diagram').nth(1)
    for (const diagram of [ascii, unicode]) {
      await expect(diagram.locator('rect.ascii-node__box')).toHaveCount(4)
      await expect(diagram.locator('polyline.ascii-edge__path')).toHaveCount(4)
    }
    // Identical semantics, identical text — the only difference is the ink. (Read
    // through `textContent`, not `innerText`: an SVG `<text>` has no layout box,
    // so `innerText` is `undefined` for all of them and the comparison would pass
    // on two lists of `undefined`.)
    const textOf = async (diagram: import('@playwright/test').Locator): Promise<string[]> =>
      diagram.locator('text.ascii-node__label').evaluateAll((nodes) =>
        nodes.map((node) => (node.textContent ?? '').trim()),
      )
    expect(await textOf(unicode)).toEqual(await textOf(ascii))
    expect(await textOf(ascii)).toEqual(['Browser', 'Dev server', 'API', 'PostgreSQL'])
    console_.assertQuiet()
  })


  test("the author's spatial arrangement is preserved, not laid out again", async ({ page }) => {
    // The assertion that would fail for a diagram engine: the four boxes of
    // Fixture A sit on a 2×2 grid at the columns the ASCII put them in, and the
    // source grid is 44 cells wide. An auto-layout would place them somewhere
    // else entirely — and would place them *equally* far apart, which the source
    // does not: the gap between these two columns is whatever the author typed.
    const diagram = page.locator('.ascii-diagram').first()
    const boxes = await diagram.locator('rect.ascii-node__box').evaluateAll((rects) =>
      rects.map((rect) => ({ x: Number(rect.getAttribute('x')), y: Number(rect.getAttribute('y')) })),
    )
    expect(boxes).toHaveLength(4)
    const columns = [...new Set(boxes.map((box) => box.x))].sort((a, b) => a - b)
    const rows = [...new Set(boxes.map((box) => box.y))].sort((a, b) => a - b)
    expect(columns).toHaveLength(2)
    expect(rows).toHaveLength(2)
    // Grid fidelity: one cell is 7.2px (0.6em of `--text-code-md-size`), so
    // column 28 sits at 28 × 7.2 + half a cell. This is the author's column.
    expect(columns[0]).toBeCloseTo(3.6, 1)
    expect(columns[1]).toBeCloseTo(28 * 7.2 + 3.6, 1)
    // And the right-hand column is not "one column plus a uniform gap": the
    // left box is 15 cells wide and the gap is 8, which is the author's spacing.
    expect(columns[1] - columns[0]).toBeCloseTo(28 * 7.2, 1)
  })

  test("connector labels are drawn where the author wrote them", async ({ page }) => {
    const console_ = watchConsole(page)
    const first = page.locator('.ascii-diagram').first()
    // `innerText` is a *layout* property and an SVG `<text>` has no box, so it
    // comes back undefined for every one of them — the labels are read through
    // `textContent` and their geometry through attributes, which is what the
    // assertions below are actually about.
    const labels = await first.locator('text.ascii-edge__label').evaluateAll((nodes) =>
      nodes.map((node) => node.textContent ?? ''),
    )
    // Three of Fixture A's four connectors are labelled, one of them twice.
    expect(labels).toContain('request')
    expect(labels).toContain('client')
    expect(labels).toContain('fetch')

    // "request" is on the row of the top borders, above the arrow; "client" is
    // on the row of the bottom ones. Both are at the row the source wrote them
    // in — which is the check. A label centred on its edge would be at a row the
    // source never used, and the two would be one row apart instead of three.
    const positions = await first.locator('text.ascii-edge__label').evaluateAll((texts) =>
      texts.map((node) => ({ x: Number(node.getAttribute('x')), y: Number(node.getAttribute('y')) })),
    )
    const byText = new Map(labels.map((text, index) => [text, positions[index]]))
    expect(byText.get('request')?.y, '"request" left the top-border row').toBeLessThan(20)
    expect(byText.get('client')?.y, '"client" left the bottom-border row').toBeGreaterThan(45)
    // Row 0 to row 2 is two rows of 18px.
    expect((byText.get('client')?.y ?? 0) - (byText.get('request')?.y ?? 0)).toBeCloseTo(36, 0)
    console_.assertQuiet()
  })

  test('the interior-junction box is one box, drawn as one box', async ({ page }) => {
    const console_ = watchConsole(page)
    const junctions = page.locator('.ascii-diagram').nth(2)
    await expect(junctions.locator('rect.ascii-node__box')).toHaveCount(2)
    await expect(junctions.locator('polyline.ascii-edge__path')).toHaveCount(1)
    // The connector that exits from an interior `+` is the one edge, pointing
    // down — its direction came from the arrowhead. And its route is the drawn
    // one: from the upper box's border cell, down through the `|`, the `|`, the
    // `v`, to the lower box's border cell. Four points, not a curve between two
    // box centres, and not a route that stops short of either box.
    const edge = junctions.locator('g.ascii-edge')
    await expect(edge).toHaveAttribute('data-direction', 'down')
    const points = ((await edge.locator('polyline').getAttribute('points')) ?? '').split(' ')
    expect(points).toHaveLength(4)
    const rows = points.map((pair) => Number(pair.split(',')[1]))
    // Row 3 is the upper box's bottom border and row 7 the lower box's top, at
    // 18px per row plus the 9px half-cell that a cell centre sits at.
    expect(rows[0]).toBeCloseTo(3 * 18 + 9, 1)
    expect(rows[3]).toBeCloseTo(7 * 18 + 9, 1)
    // Every point is in the junction's own column, so the drop is vertical.
    expect(new Set(points.map((pair) => pair.split(',')[0])).size).toBe(1)
    console_.assertQuiet()
  })


  test('no horizontal overflow at desktop or at 375px', async ({ page }) => {
    const console_ = watchConsole(page)
    // The point of capping the drawing at its own natural width: a fence drawn to
    // a fixed width is the one block kind that overflows a phone.
    const overflow = async (): Promise<number> =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(await overflow()).toBeLessThanOrEqual(0)
    await page.setViewportSize({ width: 375, height: 812 })
    await page.reload()
    await expect(page.locator('.ascii-diagram').first()).toBeVisible()
    expect(await overflow(), 'the reader scrolls sideways at 375px').toBeLessThanOrEqual(0)
    await page.locator('.ascii-diagram').first().scrollIntoViewIfNeeded()
    await snapshot(page, '57-ascii-diagram-375')
    console_.assertQuiet()
  })

  test('the reader is axe-clean with diagrams on the page, at both widths', async ({ page }) => {
    const console_ = watchConsole(page)
    // `role="img"` with a generated name, a tablist with a roving tabindex, and a
    // named region — each is a §9 obligation a diagram can break, and the reader
    // with six diagrams in it is the page where they are all true at once.
    expect(await violations(page), 'violations with diagrams at 1440px').toEqual([])
    await page.setViewportSize({ width: 375, height: 812 })
    await page.reload()
    await expect(page.locator('.ascii-diagram').first()).toBeVisible()
    expect(await violations(page), 'violations with diagrams at 375px').toEqual([])
    console_.assertQuiet()
  })

  test('reduced motion: the connectors are static, and the dash is not motion', async ({ page }) => {
    const console_ = watchConsole(page)
    // The suite runs `reducedMotion: 'reduce'`, so nothing may be moving here.
    const paths = page.locator('.ascii-diagram').first().locator('polyline.ascii-edge__path')
    const motions = await paths.evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = window.getComputedStyle(node)
        return { duration: style.animationDuration, iteration: style.animationIterationCount }
      }),
    )
    expect(motions.length).toBeGreaterThan(0)
    for (const motion of motions) {
      expect(motion.duration, 'a connector is still animating under reduced motion').toBe('0s')
      expect(motion.iteration).toBe('1')
    }
    console_.assertQuiet()
  })
})

test.describe('M4.14 with motion allowed, a solid connector is not dashed', () => {
  // The one per-test override, and the reason it exists is in `motion.spec.ts`:
  // a suite that only ever runs reduced can pass with no animation at all. The
  // half proven here is the other direction — that a connector the source drew
  // solid is *not* given a dash, and that the shared ambient keyframes are still
  // reachable from the diagram stylesheet.
  test.use({ contextOptions: { reducedMotion: 'no-preference' } })

  test('the source-fence connectors carry no dash of their own', async ({ page }) => {
    const console_ = watchConsole(page)
    await openFixture(page, ASCII_FIXTURE)
    // Fixture A's connectors are solid in the source. A dash here would be the
    // renderer inventing a distinction the document never made.
    const dash = await page
      .locator('.ascii-diagram')
      .first()
      .locator('polyline.ascii-edge__path')
      .first()
      .evaluate((node) => window.getComputedStyle(node).strokeDasharray)
    expect(dash).toBe('none')

    // The shared crawl is one stylesheet rule away, and the graph canvas has used
    // this keyframe since M3: the diagram adds a selector, not an animation.
    const reach = await page.evaluate(() =>
      Array.from(document.styleSheets).some((sheet) => {
        try {
          return Array.from(sheet.cssRules).some(
            (rule) => rule.cssText.includes('edge-trace') && rule.cssText.includes('.ascii-edge'),
          )
        } catch {
          return false
        }
      }),
    )
    expect(reach, 'the diagram stylesheet no longer reaches the shared edge-trace keyframes').toBe(true)
    console_.assertQuiet()
  })
})

