/**
 * M2.PW4 — Lighthouse against the preview server, in CI.
 *
 * ## What is gated, and how
 *
 *  - **a11y ≥ 95**, on the **worst** of three runs. Unchanged since M2, and
 *    unchanged by the A14 amendment: an accessibility score does not vary with
 *    machine load, so a low sample is a real finding and averaging it away
 *    would be exactly the wrong instinct.
 *  - **The four named metrics** of §10.1 (A14, ratified at M4.9): FCP ≤ 2000ms,
 *    LCP ≤ 2500ms, TBT ≤ 400ms, CLS ≤ 0.1. Each on the **median of three**,
 *    each a hard fail.
 *  - The **composite performance score is recorded, not gated.** It is still
 *    printed every run and still written to `artifacts/lighthouse.json`, because
 *    a number you stop asserting is a number you still want to see.
 *
 * ## Why the composite stopped being the gate
 *
 * M4.6 measured one unchanged build at **86, 88 and 82** across three
 * consecutive runs, while the audit that was actually failing — TBT — moved
 * between 0.46 and 0.65. A composite is a weighted blend in which TBT carries
 * 30 of 100 points, so it both dilutes a real regression and absorbs a 6-point
 * swing in machine noise. The four ceilings have the property it lacks: each is
 * a measured quantity with an absolute meaning, and each moves only when that
 * quantity moves.
 *
 * **Ratification is not optimisation.** A14 changed a threshold, not a byte. The
 * cause of the TBT the composite was reacting to is recorded in `DECISIONS.md`
 * under M4.6b, and the short version is that the two long tasks are React
 * render/reconcile (225ms, 29%) and markdown parse (191ms, 24%) in a single
 * 139KB entry that inlines React — not, as M4.6 assumed, search index
 * construction, which is 0ms at load because the palette is not mounted until
 * someone presses its shortcut.
 *
 * ## Two things this gate will not do
 *
 *  - **It does not run on a different preset than the floors were set for.**
 *    A14 specifies the **desktop** preset, so the audit runs `--preset=desktop`.
 *    The M4.6 runs that established 86/88/82 were Lighthouse's *default* mobile
 *    emulation, and comparing a median across two presets would be comparing
 *    two different experiments.
 *  - **If it turns out flaky in CI, the response is to report that and drop the
 *    assertion — not to widen a ceiling.** Widening is the failure mode this
 *    whole amendment exists to end.
 */

import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PREVIEW_PORT, distDir, repoRoot, startServer } from '../tests/e2e/server'

/**
 * Lighthouse itself, pinned and run through `npx`.
 *
 * Two deliberate constraints:
 *
 *  - It is **not** a declared dependency. The M2 brief authorises exactly three
 *    new packages (cmdk, @playwright/test, @axe-core/playwright); adding
 *    Lighthouse and its dependency tree to `package.json` would break that.
 *    `npx` runs it from the npm cache, so the audit is reproducible at a fixed
 *    version without the app depending on it.
 *  - **12.8.2, not 13.x.** Lighthouse 13 pulls in `yargs` / `cliui` /
 *    `string-width` versions that declare `engines.node >= 20`, and this
 *    project is on Node 18.20.8, which the brief says not to upgrade
 *    unilaterally. 12.8.2 is the newest release whose own `engines` allow Node
 *    18 (`>=18.16`). Revisit with the Node bump.
 */
const LIGHTHOUSE_VERSION = '12.8.2'

/**
 * `execFile`, not `execFileSync`.
 *
 * The static host for this audit runs *in this process*, and `execFileSync`
 * blocks the event loop while it waits — so the server cannot answer the
 * browser's requests and Lighthouse waits on a host that is structurally unable
 * to reply. Awaiting the child instead keeps the loop turning.
 */
const run = promisify(execFile)

/** §10. */
const A11Y_FLOOR = 95

/**
 * §10.1 / A14 — the four gated metrics.
 *
 * `audit` is Lighthouse's own audit id, so the number is measured by Lighthouse
 * rather than re-derived here; `ceiling` is A14's ratified threshold; `digits`
 * is how many decimals the value is *reported* with.
 *
 * CLS is unitless and the rest are milliseconds, so the two are formatted
 * differently and the comparison is `<=` on the raw value in every case. A
 * metric exactly on its ceiling passes: the ceilings are "at most", and a gate
 * that failed on a boundary would be measuring floating-point noise.
 */
const METRIC_GATE = [
  { key: 'FCP', audit: 'first-contentful-paint', ceiling: 2000, unit: 'ms', digits: 0 },
  { key: 'LCP', audit: 'largest-contentful-paint', ceiling: 2500, unit: 'ms', digits: 0 },
  { key: 'TBT', audit: 'total-blocking-time', ceiling: 400, unit: 'ms', digits: 0 },
  { key: 'CLS', audit: 'cumulative-layout-shift', ceiling: 0.1, unit: '', digits: 3 },
] as const

/**
 * How many runs, and how the runs are combined.
 *
 * Three, and the **median**, for the reason in the file header: M4.6 measured
 * one build at 86, 88 and 82. The median is the cheapest estimator that shrugs
 * off one bad sample in either direction, which is the only property a
 * threshold needs. The a11y score is the exception and takes the **worst** —
 * see the header.
 */
const RUNS = 3

/**
 * A14 audits the **desktop** preset, so the audit runs it.
 *
 * This is not cosmetic. Lighthouse's default is a throttled *mobile* emulation
 * (4x CPU slowdown, simulated slow 4G); `--preset=desktop` removes both. The
 * M4.6 numbers of 86/88/82 were collected under the default, so they are not
 * comparable to a desktop median, and the ceilings in A14 were ratified
 * against desktop measurements.
 */
const PRESET = 'desktop'

/** The categories we report. */
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo']

/** Where the raw report lands, for M4.6 to compare against. */
const ARTIFACT = join(repoRoot(), 'artifacts', 'lighthouse.json')

/**
 * The chrome to audit with.
 *
 * `CHROME_PATH` is honoured so CI can point Lighthouse at the Chromium that
 * Playwright already installed, instead of downloading a second browser.
 */
function chromePath() {
  const fromEnv = process.env['CHROME_PATH']
  if (fromEnv !== undefined && fromEnv !== '' && existsSync(fromEnv)) return fromEnv
  try {
    // Synchronous on purpose: this runs before the audit starts, so nothing
    // else is waiting on the event loop yet.
    const found = execFileSync(
      'node',
      ['-e', "process.stdout.write(require('playwright-core').chromium.executablePath())"],
      { cwd: repoRoot(), encoding: 'utf8' },
    ).trim()
    return found !== '' && existsSync(found) ? found : undefined
  } catch {
    // Fall through to Lighthouse's own resolution.
    return undefined
  }
}

/** The shape of the slice of a Lighthouse report this script reads. */
type LighthouseReport = {
  categories?: Record<string, { score?: number | null; auditRefs?: AuditRef[] }>
  /**
   * `numericValue` is where the four gated metrics are read from, and it is
   * `number | null`: an audit that did not run, or that errored, has no value.
   * Coercing that to `0` would be the dangerous mistake, because a *failing*
   * CLS and a *missing* CLS are both zero-ish and only one of them is a pass.
   * A metric with no value is a hard failure, reported as missing.
   */
  audits?: Record<string, { score?: number | null; title?: string; numericValue?: number | null; errorMessage?: string }>
}

/** One entry of a category's `auditRefs`; `weight` is what makes a perf miss matter. */
type AuditRef = { id: string; weight?: number }

/** The a11y audits that scored below 1, named — a bare score is not actionable. */
function failingA11yAudits(report: LighthouseReport): string[] {
  const audits = report.audits ?? {}
  const refs = report.categories?.['accessibility']?.['auditRefs'] ?? []
  return refs
    .map((ref) => ref.id)
    .filter((id) => typeof audits[id]?.score === 'number' && (audits[id]?.score as number) < 1)
    .map((id) => `${id} — ${audits[id]?.title ?? ''}`)
}

/** The four category scores of one report, as 0–100 integers. */
function scoreOf(report: LighthouseReport): Record<string, number> {
  return Object.fromEntries(
    CATEGORIES.map((name) => [name, Math.round((report.categories?.[name]?.score ?? 0) * 100)]),
  )
}

/** The middle value of an odd-length sample. Never mutates its input. */
function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] as number
}

/** One gated metric's value across all three runs, and the verdict on it. */
type MetricResult = {
  key: string
  /** Per-run values, in run order. Empty means every run failed to report it. */
  values: number[]
  /** The gated statistic: the median of `values`, or `null` if there are none. */
  median: number | null
  ceiling: number
  unit: string
  pass: boolean
  /** Set when the metric could not be read at all — a failure, named. */
  missing?: boolean
}

/**
 * Read one audit's raw metric from a report, or `null` if it is not there.
 *
 * `null` is propagated rather than defaulted. A gate that treats "Lighthouse
 * did not measure this" as "this metric is 0" is a gate that passes when the
 * audit breaks, which is the precise failure mode this rewrite is meant to
 * remove.
 */
function metricOf(report: LighthouseReport, audit: string): number | null {
  const value = report.audits?.[audit]?.numericValue
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Reduce three runs of one metric to a verdict.
 *
 * The median of the values that exist, and a failure if fewer than `RUNS` runs
 * reported it. That second rule is deliberate: a median over one surviving
 * sample is not a median-of-three, and silently narrowing the sample would
 * reintroduce exactly the single-sample gate the whole median-of-3 design
 * exists to avoid.
 */
function judgeMetric(
  key: string,
  audit: string,
  ceiling: number,
  unit: string,
  runs: readonly LighthouseReport[],
): MetricResult {
  const values = runs.map((report) => metricOf(report, audit)).filter((v): v is number => v !== null)
  if (values.length < runs.length) {
    return { key, values, median: values.length ? medianOf(values) : null, ceiling, unit, pass: false, missing: true }
  }
  const median = medianOf(values)
  return { key, values, median, ceiling, unit, pass: median <= ceiling }
}

/** `1720ms` / `0.043` — the value, its unit, and no more precision than it has. */
function formatValue(value: number | null, unit: string, digits: number): string {
  if (value === null) return 'not reported'
  return `${value.toFixed(digits)}${unit}`
}

/**
 * The performance audits that cost the most, named — a bare score is not
 * actionable, and the same reasoning the a11y failures use.
 */
function failingPerfAudits(report: LighthouseReport): string[] {
  const audits = report.audits ?? {}
  const refs = report.categories?.['performance']?.['auditRefs'] ?? []
  return refs
    .filter((ref) => (ref.weight ?? 0) > 0)
    .map((ref) => ({ ref, audit: audits[ref.id] }))
    .filter(({ audit }) => typeof audit?.score === 'number' && (audit.score as number) < 0.9)
    .map(
      ({ ref, audit }) =>
        `${ref.id} (weight ${ref.weight ?? 0}, score ${(audit?.score as number).toFixed(2)}) — ${audit?.title ?? ''}`,
    )
}


async function main() {
  if (!existsSync(join(distDir(), 'index.html'))) {
    process.stdout.write('lighthouse: dist/ is missing; run `npm run build` first\n')
    process.exitCode = 1
    return
  }

  const server = await startServer(PREVIEW_PORT)
  const url = `http://127.0.0.1:${PREVIEW_PORT}/`
  process.stdout.write(
    `lighthouse: auditing ${url} — ${PRESET} preset, ${RUNS} runs, every metric gated on the median\n`,
  )

  try {
    const args = [
      '--yes',
      `lighthouse@${LIGHTHOUSE_VERSION}`,
      url,
      '--output=json',
      '--output-path=stdout',
      '--quiet',
      `--only-categories=${CATEGORIES.join(',')}`,
      // A14's ceilings are desktop ceilings. Lighthouse's default is a
      // throttled mobile emulation, so without this the audit would measure a
      // different experiment than the one the thresholds were set for.
      `--preset=${PRESET}`,
      '--chrome-flags=--headless=new --no-sandbox --disable-gpu',
    ]
    const path = chromePath()
    if (path !== undefined) {
      process.env['CHROME_PATH'] = path
      args.push(`--chrome-path=${path}`)
    }

    const runs: LighthouseReport[] = []
    for (let index = 1; index <= RUNS; index += 1) {
      const { stdout: raw } = await run('npx', args, {
        cwd: repoRoot(),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        // A per-run timeout, because "the gate hangs" is a worse failure than
        // "the gate fails": CI's own job timeout would fire eventually, with no
        // indication of which of the three runs was stuck, and a reader would
        // have to bisect it by hand. Loudly, in the log, at 120s.
        timeout: 120_000,
      })
      const report = JSON.parse(raw) as LighthouseReport
      runs.push(report)
      // The composite is printed per run even though it no longer gates
      // anything. It is the number a reader will look for first, and hiding it
      // would make the log harder to read to buy a tidier one.
      process.stdout.write(
        `lighthouse: run ${index}/${RUNS} — composite ${JSON.stringify(scoreOf(report))} (recorded, not gated)\n`,
      )
      // The *last* report is what lands in `artifacts/`, so the file always
      // describes one real run rather than a merge of three. Nothing merges it;
      // the medians are computed from the three reports and printed alongside.
      mkdirSync(dirname(ARTIFACT), { recursive: true })
      writeFileSync(ARTIFACT, JSON.stringify(report, null, 2))
    }

    // ── the four gated metrics ────────────────────────────────────────────
    const results = METRIC_GATE.map(({ key, audit, ceiling, unit }) =>
      judgeMetric(key, audit, ceiling, unit, runs),
    )
    const last = runs[runs.length - 1] as LighthouseReport
    const perfs = runs.map((report) => Math.round((report.categories?.['performance']?.score ?? 0) * 100))
    const composite = medianOf(perfs)
    // A11y is gated on the **worst** run, not the median. Unchanged by A14, and
    // for the same reason: an accessibility score does not vary with machine
    // load, so a low sample there is a real finding, and averaging it away
    // would be exactly the wrong instinct.
    const worstA11y = Math.min(
      ...runs.map((report) => Math.round((report.categories?.['accessibility']?.score ?? 0) * 100)),
    )

    process.stdout.write(`\nlighthouse: §10.1 (A14) — the four gated metrics, median of ${RUNS}, ${PRESET} preset\n`)
    for (const r of results) {
      const digits = METRIC_GATE.find((m) => m.key === r.key)?.digits ?? 0
      const runsText = r.values.length > 0 ? r.values.map((v) => v.toFixed(digits)).join(', ') : '—'
      const mark = r.pass ? '✓' : '✗'
      process.stdout.write(
        `  ${mark} ${r.key.padEnd(4)} median ${formatValue(r.median, r.unit, digits).padStart(9)}` +
          `  ceiling ${formatValue(r.ceiling, r.unit, digits).padStart(9)}   runs: ${runsText}\n`,
      )
    }
    process.stdout.write(
      `\nlighthouse: composite performance median ${composite} (recorded, not gated)\n` +
        `lighthouse: a11y ${worstA11y}, worst of ${RUNS} (floor ${A11Y_FLOOR})\n` +
        `lighthouse: report written to artifacts/lighthouse.json\n`,
    )

    // Every failure is reported, not just the first. A gate that stops at the
    // first problem makes the reader run it again to discover the rest.
    let failed = false

    if (worstA11y < A11Y_FLOOR) {
      process.stdout.write(`lighthouse: a11y ${worstA11y} is below the §10 floor of ${A11Y_FLOOR}\n`)
      for (const line of failingA11yAudits(last)) process.stdout.write(`  ✗ ${line}\n`)
      failed = true
    }

    for (const r of results.filter((m) => !m.pass)) {
      if (r.missing === true) {
        process.stdout.write(
          `lighthouse: ${r.key} was not reported by Lighthouse in all ${RUNS} runs — treated as a failure, not as 0\n`,
        )
        continue
      }
      const digits = METRIC_GATE.find((m) => m.key === r.key)?.digits ?? 0
      process.stdout.write(
        `lighthouse: ${r.key} median ${formatValue(r.median, r.unit, digits)} exceeds the §10.1 ceiling of ` +
          `${formatValue(r.ceiling, r.unit, digits)}\n`,
      )
    }
    if (results.some((r) => !r.pass)) {
      // The weighted audits are still listed on a metric failure, because they
      // are what tells a reader *why* the metric is where it is.
      for (const line of failingPerfAudits(last)) process.stdout.write(`  ✗ ${line}\n`)
      failed = true
    }

    if (failed) {
      process.exitCode = 1
      return
    }

    process.stdout.write(
      `\nlighthouse: §10 passed — ` +
        results.map((r) => `${r.key} ${formatValue(r.median, r.unit, METRIC_GATE.find((m) => m.key === r.key)?.digits ?? 0)}`).join(' · ') +
        `, a11y ${worstA11y} ≥ ${A11Y_FLOOR}` +
        ` (composite ${composite}, recorded)\n`,
    )
  } catch (error) {
    process.stdout.write(`lighthouse: the run failed — ${String(error)}\n`)
    process.exitCode = 1
  } finally {
    // Prompt, not polite: the headless browser holds keep-alives open.
    server.closeAllConnections()
    await new Promise<void>((done) => {
      server.close(() => done())
    })
  }
}

void main()
