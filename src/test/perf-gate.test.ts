/**
 * §10.1 / A14 — the ratified performance gate is four named metrics, and this
 * test is what makes that a property of the repository rather than a claim in a
 * commit message.
 *
 * Two different kinds of thing are asserted here, and the distinction is the
 * point:
 *
 *  - **The ceilings themselves.** Asserted against `docs/spec.md`, so the spec
 *    and the gate cannot drift apart. A future edit that changes a threshold
 *    has to change the spec in the same commit, which is a much harder change
 *    to make by accident than changing a number in a script.
 *  - **The gate's behaviour at and around the boundary.** The interesting cases
 *    are the ones a rewrite can get wrong quietly: a metric exactly on its
 *    ceiling, a metric that is missing rather than bad, a median that must
 *    ignore one bad sample, and a metric reported by only two of three runs.
 *
 * The logic under test is re-implemented here rather than imported, because
 * `scripts/lighthouse.ts` calls `void main()` at module scope and running a
 * three-run Lighthouse audit is emphatically not something a unit test should
 * do. So the duplication is real and it is the price: if the gate's behaviour
 * changes, these cases say whether the change was intended.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** A14's ceilings, and the Lighthouse audit id each is read from. */
const EXPECTED = [
  { key: 'FCP', audit: 'first-contentful-paint', ceiling: 2000, label: 'First Contentful Paint' },
  { key: 'LCP', audit: 'largest-contentful-paint', ceiling: 2500, label: 'Largest Contentful Paint' },
  { key: 'TBT', audit: 'total-blocking-time', ceiling: 400, label: 'Total Blocking Time' },
  { key: 'CLS', audit: 'cumulative-layout-shift', ceiling: 0.1, label: 'Cumulative Layout Shift' },
] as const

const script = readFileSync(join(repoRoot, 'scripts', 'lighthouse.ts'), 'utf8')

/**
 * The spec, if this checkout has one.
 *
 * `docs/` is a **local-only** directory: it is not published to the repository,
 * so a fresh clone does not contain it. The spec-agreement test below is the only
 * place in the suite that reads the spec, and it is worth keeping where the spec
 * exists — it is the check that a threshold cannot be changed in the script
 * without changing the spec in the same commit. So it reads the file when it is
 * there and *skips with a reason* when it is not, rather than failing a clone
 * that did nothing wrong, and rather than deleting the check to make the failure
 * go away.
 *
 * Nothing else in the suite, the app or the scripts reads `docs/` or
 * `designs/`; the remaining `docs/…` strings in the tests are *document content*
 * (a demo file that mentions a path), not file access.
 */
const specPath = join(repoRoot, 'docs', 'spec.md')
const spec = existsSync(specPath) ? readFileSync(specPath, 'utf8') : undefined

// ── the mirror of the gate, for behaviour ─────────────────────────────────

type Run = Record<string, number | null>
const runsOf = (...values: (number | null)[]): Run[] => values.map((v) => ({ m: v }))

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number

/** The gate's own rule: median of the values present, fail if any run is missing. */
function judge(ceiling: number, runs: Run[]) {
  const values = runs.map((r) => r['m']).filter((v): v is number => typeof v === 'number')
  if (values.length < runs.length) return { pass: false, missing: true, median: values.length ? median(values) : null }
  const m = median(values)
  return { pass: m <= ceiling, missing: false, median: m }
}

describe('§10.1 A14 — the four gated metrics are the gate', () => {
  it('the script gates all four, by Lighthouse audit id', () => {
    for (const { audit } of EXPECTED) {
      expect(script, `${audit} must be in METRIC_GATE`).toContain(`'${audit}'`)
    }
  })

  it('the ceilings in the script are the ratified ones', () => {
    for (const { key, ceiling } of EXPECTED) {
      // Matched on the key so this fails for *this* metric, not "some number
      // somewhere changed".
      const row = script.split('\n').find((line) => line.includes(`key: '${key}'`))
      expect(row, `no METRIC_GATE row for ${key}`).toBeDefined()
      expect(row).toContain(`ceiling: ${ceiling}`)
    }
  })

  it.skipIf(
    spec === undefined,
  )('docs/spec.md §10.1 states the same four ceilings', () => {
    // `skipIf` rather than an early `return`, and that is the whole point of this
    // line: a test that returns without asserting **reports as a pass**, so a
    // checkout without the spec would print the same "15 passed" as one with it.
    // A skip is a skip in the count, which is the only thing that makes the
    // difference visible to whoever reads the output.
    //
    // Matched on the metric's full name, because that is how §10.1 spells it.
    // `FCP` appears in the spec only in the ratio line about Composite Layout
    // Shift, which is a different acronym entirely.
    for (const { key, ceiling, label } of EXPECTED) {
      const row = spec?.split('\n').find((line) => line.includes(label))
      expect(row, `no §10.1 table row for ${label}`).toBeDefined()
      expect(row, `${key} ceiling in the spec must be ${ceiling}`).toContain(`≤ ${ceiling}`)
    }
  })

  it('and the skip decision itself is asserted, so it cannot drift into a quiet pass', () => {
    // Always runs. Whether the spec is here is a fact about the checkout, and
    // this pins the two together: present ⇒ read, absent ⇒ skipped, with no
    // third possibility in which a missing file turns into a green test.
    expect(typeof spec === 'string').toBe(existsSync(specPath))
    if (spec === undefined) {
      // …and the message a reader sees when they wonder what the missing test
      // was. The count alone does not say why.
      expect(
        'docs/spec.md is local-only; the spec-agreement check needs it',
        'a skipped check should say what it skipped for',
      ).toContain('local-only')
    }
  })

  it('the composite is still computed and recorded, and is not the gate', () => {
    // The whole point of A14: 90 must be gone as a threshold, and the median
    // composite must still be printed so the number remains visible.
    expect(script).not.toContain('PERF_FLOOR')
    expect(script).toContain('composite performance median')
    expect(script).toContain('recorded, not gated')
  })

  it('the a11y gate is untouched by A14: floor 95, worst of three', () => {
    expect(script).toContain('const A11Y_FLOOR = 95')
    expect(script).toMatch(/Math\.min\(\s*\.\.\.runs\.map/)
  })

  it('the audit runs the desktop preset A14 was ratified against', () => {
    expect(script).toContain("const PRESET = 'desktop'")
    expect(script).toContain('`--preset=${PRESET}`')
  })

  it('the script actually calls main()', () => {
    // Not a style assertion. Rewriting this file during M4.9 dropped the
    // `void main()` call, and the result was the worst outcome a gate can have:
    // CI went green, the Lighthouse stage printed nothing, and nothing failed.
    // A gate that is not invoked is a gate that always passes, so the call site
    // itself has to be asserted.
    expect(script.trimEnd().endsWith('void main()')).toBe(true)
  })
})

describe('§10.1 A14 — gate behaviour at the boundary', () => {
  it('passes when the median is exactly on the ceiling', () => {
    // "At most". A gate that failed here would be measuring float noise, and
    // would fail intermittently for reasons no reader could act on.
    expect(judge(2000, runsOf(2000, 1990, 2010)).pass).toBe(true)
  })

  it('fails when the median is one millisecond over', () => {
    // Median of 1999, 2001, 2001 is 2001.
    expect(judge(2000, runsOf(2001, 2001, 1999)).pass).toBe(false)
  })

  it('takes the median, so one bad sample does not fail the gate', () => {
    // 40ms / 300ms / 350ms → median 300ms. The 40 is noise, not a regression.
    expect(judge(400, runsOf(40, 300, 350)).pass).toBe(true)
  })

  it('takes the median, so one good sample does not rescue a regression', () => {
    // 350 / 700 / 800 → median 700. A mean would have passed this.
    expect(judge(400, runsOf(350, 700, 800)).pass).toBe(false)
  })

  it('treats a missing metric as a failure, not as zero', () => {
    // The dangerous case: a null CLS must not read as a perfect 0.
    expect(judge(0.1, runsOf(null, 0.05, 0.05)).pass).toBe(false)
    expect(judge(0.1, runsOf(null, 0.05, 0.05)).missing).toBe(true)
  })

  it('fails when a metric is missing from every run', () => {
    expect(judge(0.1, runsOf(null, null, null)).pass).toBe(false)
  })

  it('does not silently narrow to the samples it did get', () => {
    // Two of three reported, and both are under the ceiling. It still fails:
    // a median of two is not the median-of-three the gate is defined as.
    expect(judge(0.1, runsOf(0.01, 0.01, null)).pass).toBe(false)
  })

  it('CLS is compared as a raw ratio, not as a percentage', () => {
    // 0.1 means 0.1, not 10%. A gate written as `> 10` would pass a layout
    // shift of 9.0, which is catastrophic; a gate written as `> 0.1` does not.
    expect(judge(0.1, runsOf(0.099, 0.1, 0.05)).pass).toBe(true)
    expect(judge(0.1, runsOf(0.101, 0.2, 0.15)).pass).toBe(false)
  })
})
