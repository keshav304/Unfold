/**
 * M2.PW4 — Lighthouse against the preview server, in CI.
 *
 * Two rules, and they are not negotiable in the same direction:
 *
 *  - **a11y ≥ 95 is a HARD FAIL.** This retires the item that has been open
 *    since G2. It is the threshold the spec states (§10), so anything softer
 *    would be a threshold invented here.
 *  - **Performance is RECORDED, never asserted.** The LCP waterfall fix is
 *    deferred to M4.6 per amendment A6, so a perf gate today would fail on work
 *    that is explicitly not scheduled. The numbers are written to
 *    `artifacts/lighthouse.json` so M4.6 has a baseline to beat.
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
  categories?: Record<string, { score?: number | null; auditRefs?: { id: string }[] }>
  audits?: Record<string, { score?: number | null; title?: string }>
}

/** The a11y audits that scored below 1, named — a bare score is not actionable. */
function failingA11yAudits(report: LighthouseReport): string[] {
  const audits = report.audits ?? {}
  const refs = report.categories?.['accessibility']?.['auditRefs'] ?? []
  return refs
    .map((ref) => ref.id)
    .filter((id) => typeof audits[id]?.score === 'number' && (audits[id]?.score as number) < 1)
    .map((id) => `${id} — ${audits[id]?.title ?? ''}`)
}

async function main() {
  if (!existsSync(join(distDir(), 'index.html'))) {
    process.stdout.write('lighthouse: dist/ is missing; run `npm run build` first\n')
    process.exitCode = 1
    return
  }

  const server = await startServer(PREVIEW_PORT)
  const url = `http://127.0.0.1:${PREVIEW_PORT}/`
  process.stdout.write(`lighthouse: auditing ${url}\n`)

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

    const { stdout: raw } = await run('npx', args, {
      cwd: repoRoot(),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })

    const report = JSON.parse(raw)
    mkdirSync(dirname(ARTIFACT), { recursive: true })
    writeFileSync(ARTIFACT, JSON.stringify(report, null, 2))

    const scores = Object.fromEntries(
      CATEGORIES.map((name) => [name, Math.round((report.categories[name]?.score ?? 0) * 100)]),
    )
    process.stdout.write(`lighthouse: ${JSON.stringify(scores)}\n`)
    process.stdout.write(`lighthouse: report written to artifacts/lighthouse.json\n`)

    // A11y is the gate. Everything else is recorded, per A6.
    const a11y = scores['accessibility'] ?? 0
    if (a11y < A11Y_FLOOR) {
      process.stdout.write(`lighthouse: a11y ${a11y} is below the §10 floor of ${A11Y_FLOOR}\n`)
      for (const line of failingA11yAudits(report)) process.stdout.write(`  ✗ ${line}\n`)
      process.exitCode = 1
      return
    }

    process.stdout.write('lighthouse: a11y gate passed; perf recorded only (A6 defers that gate to M4.6)\n')
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