/**
 * M2.PW4 — Lighthouse against the preview server, in CI.
 *
 * Two rules, and they are not negotiable in the same direction:
 *
 *  - **a11y ≥ 95 and perf ≥ 90 are HARD FAILs.** Both are §10's stated floors.
 *    a11y has been gated since M2; perf became a gate at M4.6, the milestone
 *    that paid the deferred A6 waterfall debt.
 *  - **The perf score is the MEDIAN of three runs, not one.** M4.6's own finding
 *    is that a single headless run of the same build on the same machine
 *    produced 61, 63 and 72. A gate on one sample is a gate on the weather, and
 *    a weather gate is a gate that gets ignored. The median shrugs off one slow
 *    run in either direction, which is the only property a threshold needs.
 *
 * If headless Lighthouse turns out to be flaky in CI, the right response is to
 * report that and drop the assertion — not to widen the threshold.
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
 * §10's performance floor, and the number of runs the gate takes the median of.
 *
 * Three, not one, for the reason in the file header: one headless run of one
 * build on one machine produced 61, 63 and 72 during M4.6. The median of three
 * is the cheapest estimator that shrugs off one bad sample in either direction.
 */
const PERF_FLOOR = 90
const PERF_RUNS = 3

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
  audits?: Record<string, { score?: number | null; title?: string }>
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
  process.stdout.write(`lighthouse: auditing ${url} — ${PERF_RUNS} runs, the perf gate takes the median\n`)

  try {
    const args = [
      '--yes',
      `lighthouse@${LIGHTHOUSE_VERSION}`,
      url,
      '--output=json',
      '--output-path=stdout',
      '--quiet',
      `--only-categories=${CATEGORIES.join(',')}`,
      '--chrome-flags=--headless=new --no-sandbox --disable-gpu',
    ]
    const path = chromePath()
    if (path !== undefined) {
      process.env['CHROME_PATH'] = path
      args.push(`--chrome-path=${path}`)
    }

    const runs: LighthouseReport[] = []
    for (let index = 1; index <= PERF_RUNS; index += 1) {
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
      process.stdout.write(`lighthouse: run ${index}/${PERF_RUNS} — ${JSON.stringify(scoreOf(report))}\n`)
      // The *last* report is what lands in `artifacts/`, so the file always
      // describes one real run rather than a merge of three. Nothing merges it;
      // the median is computed from the three scores and printed alongside.
      mkdirSync(dirname(ARTIFACT), { recursive: true })
      writeFileSync(ARTIFACT, JSON.stringify(report, null, 2))
    }

    const perfs = runs.map((report) => Math.round((report.categories?.['performance']?.score ?? 0) * 100))
    const median = medianOf(perfs)
    // A11y is gated on the **worst** run, not the median. An accessibility score
    // does not vary with machine load, so a low sample there is a real finding
    // and averaging it away would be exactly the wrong instinct.
    const worstA11y = Math.min(
      ...runs.map((report) => Math.round((report.categories?.['accessibility']?.score ?? 0) * 100)),
    )
    const last = runs[runs.length - 1] as LighthouseReport
    process.stdout.write(
      `lighthouse: perf ${JSON.stringify(perfs)} → median ${median} (floor ${PERF_FLOOR})\n` +
        `lighthouse: a11y ${worstA11y}, worst of ${PERF_RUNS} (floor ${A11Y_FLOOR})\n` +
        `lighthouse: report written to artifacts/lighthouse.json\n`,
    )

    if (worstA11y < A11Y_FLOOR) {
      process.stdout.write(`lighthouse: a11y ${worstA11y} is below the §10 floor of ${A11Y_FLOOR}\n`)
      for (const line of failingA11yAudits(last)) process.stdout.write(`  ✗ ${line}\n`)
      process.exitCode = 1
      return
    }

    if (median < PERF_FLOOR) {
      process.stdout.write(`lighthouse: perf ${median} is below the §10 floor of ${PERF_FLOOR}\n`)
      for (const line of failingPerfAudits(last)) process.stdout.write(`  ✗ ${line}\n`)
      process.exitCode = 1
      return
    }

    process.stdout.write(
      `lighthouse: both §10 gates passed (a11y ${worstA11y} ≥ ${A11Y_FLOOR}, perf ${median} ≥ ${PERF_FLOOR})\n`,
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

await main()