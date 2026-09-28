/**
 * M4.6b — PROFILE the two long tasks. Do not fix.
 *
 * The M4.6 gate fails at 86/90 and named TBT as the cause. That names the
 * *symptom*. This script exists to name the *work*, so any later attempt to
 * move the number is aimed at something.
 *
 * ## The constraint that shapes this file
 *
 * **No product changes.** No `performance.mark()` in the app, no change to how
 * anything renders. The breakdown is assembled entirely from outside the app:
 *
 *  - a **CDP trace** (`browser.startTracing`) with `devtools.timeline` and the
 *    **V8 CPU profiler** enabled;
 *  - a **PerformanceObserver** in the page for `longtask` and `resource`.
 *
 * ## Three things that had to be true for the numbers to mean anything
 *
 * **1. It profiles an unminified build.** The production entry minifies its
 * hot functions to `mk`, `Ol`, `lC`, `dc`. A profile of that build can only
 * report that 178 samples went into `mk` — the whole point is to *name* the
 * work. So this script builds `dist-profile/` with minification off and serves
 * *that*, through the same static-host implementation the e2e suite uses,
 * because a profiler served by a different kind of server would be profiling a
 * different app.
 *
 * The cost is stated plainly: unminified code parses and evaluates slower, so
 * **absolute** times here are pessimistic. The *ranking* between buckets is
 * what survives, and the ranking is the question.
 *
 * **2. It throttles the CPU 4x.** Lighthouse's default mobile simulation is a
 * 4x slowdown, and the failing score is a Lighthouse score. Measured
 * unthrottled, this page has **zero** long tasks and the report comes back
 * empty — which is a fact about the machine being fast, not about the app.
 *
 * **3. It counts `samples`, not `hitCount`.** The V8 CPU profile arrives as
 * `ProfileChunk` events whose `cpuProfile.samples` lists *node ids* over time,
 * with per-sample durations in `timeDeltas`. The obvious first attempt —
 * summing `hitCount` — returns zero everywhere, because that field does not
 * exist in this format.
 *
 * ## Attribution
 *
 * Node ids are delta-encoded across chunks, so all chunks merge into one
 * id→node table before counting. Each sample is attributed to its **nearest
 * interesting ancestor**, not to the leaf: otherwise a leaf inside
 * `Array.prototype.push`, called from the MiniSearch indexer, files as
 * "unattributed" and the 100ms that actually costs us goes missing.
 *
 * The last line of the report evaluates the M4.6c precondition. It is
 * **printed, not acted on** — this file changes no product behaviour.
 *
 * Disposable dev tooling. Not in the app bundle, not in CI, no tests.
 */

import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { chromium, type Browser } from 'playwright'
import { repoRoot, startServer } from '../tests/e2e/server'

const run = promisify(execFile)

const RUNS = 3
/** A second port, so profiling never collides with a running e2e host. */
const PORT = 4184
const URL = `http://127.0.0.1:${PORT}/`

/** Lighthouse's default mobile CPU simulation. See the header, point 2. */
const CPU_THROTTLE = 4

/**
 * `devtools.timeline` for the event stream and the V8 CPU profiler for the
 * per-sample stacks. Both are needed: the timeline says *when* and *which
 * script*, the profile says *which function*.
 */
const CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-v8.cpu_profiler',
  'v8.execute',
  'blink.user_timing',
]

// ── trace shape ────────────────────────────────────────────────────────────

type TraceEvent = {
  name?: string
  ph?: string
  pid?: number
  dur?: number
  args?: Record<string, unknown>
}

type Node = {
  id: number
  parent?: number
  callFrame?: { functionName?: string; url?: string }
}

/** One `ProfileChunk`'s payload, as it actually arrives. */
type Chunk = {
  cpuProfile?: { nodes?: Node[]; samples?: number[] }
  timeDeltas?: number[]
}

/** The renderer's main-thread pid, which is what owns the profile. */
function rendererPid(events: TraceEvent[]): number | undefined {
  const meta = events.find((e) => e.name === 'thread_name' && e.ph === 'M' && e.args?.name === 'CrRendererMain')
  return meta?.pid
}

/** Collapse a hashed bundle URL to something readable in a report. */
function label(url: string): string {
  const file = (url.split('/').pop() ?? url).replace(/[?#].*$/, '')
  const m = /^(index|react-dom|react|scheduler|cmdk|minisearch|mermaid)-[A-Za-z0-9_-]{6,}\./.exec(file)
  return m ? `${m[1]}.js` : file
}

// ── Q1: entry eval — React, or our code? ───────────────────────────────────

/**
 * Eval and call time grouped by bundle URL.
 *
 * This answers "is the 330ms React or is it us", and the timeline alone can
 * answer it because React, ReactDOM and the app entry are **separate files on
 * the wire** — the split is measured rather than inferred from whichever
 * library a stack frame claims to belong to.
 *
 * `EvaluateScript` does not appear in a module build. The equivalents are
 * `v8.evaluateModule` and `FunctionCall`, and only those are counted.
 */
function evalByBundle(events: TraceEvent[], pid: number | undefined): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of events) {
    if (e.pid !== pid) continue
    const isEval = e.name === 'EvaluateScript' || e.name === 'v8.evaluateModule' || e.name === 'FunctionCall'
    if (!isEval) continue
    const url = (e.args?.data as { url?: string } | undefined)?.url ?? ''
    if (!url) continue
    const k = label(url)
    out.set(k, (out.get(k) ?? 0) + (e.dur ?? 0) / 1000)
  }
  return out
}

// ── Q2: mount — render, index construction, or chip processing? ────────────

/**
 * Buckets for the main-thread samples.
 *
 * Order is the order of resolution and it matters: a bucket matching
 * `react-dom` would otherwise sweep React's *evaluation* into
 * `react: render/reconcile`, filing two very different costs under one name.
 */
const BUCKETS: { name: string; re: RegExp }[] = [
  { name: 'search: index construction', re: /MiniSearch|createSearchIndex|useSearchIndex|\baddAll\b/i },
  { name: 'react: eval (module init)', re: /react-dom|\breact\.|scheduler/i },
  { name: 'react: render/reconcile', re: /performWork|renderRoot|commitRoot|reconcile|flushSync|scheduleUpdate|beginWork|completeWork/i },
  { name: 'entities: chip processing', re: /extractEntities|collectEntities|[Cc]hip|backlink|filePath|glossary/i },
  { name: 'markdown: parse', re: /parseDocument|countWords|parseMarkdown|parseBlocks|micromark|mdast|tokeniz|parseFrontmatter|parseInline|fromMarkdown/i },
  { name: 'app: shiki highlight', re: /shiki|onig|highlightBlock/i },
]

function bucketFor(name: string, url: string): string | null {
  const hay = `${name} ${url}`
  for (const b of BUCKETS) if (b.re.test(hay)) return b.name
  return null
}

/**
 * V8's own pseudo-frames, which are **not application work** and must never be
 * lumped in with it.
 *
 * This matters more than it sounds. `(idle)` is the profiler's way of saying
 * "the main thread had nothing to do" — it is the *good* outcome, and on a page
 * that spends most of its life waiting for a network and then for the user, it
 * is the largest single entry in the profile. The first version of this script
 * filed it under "unattributed", which produced a report whose top line was
 * 94% unattributed and whose actual answer was invisible underneath it.
 *
 * These are reported in their own rows so the real buckets are read against a
 * denominator that is work rather than waiting.
 */
const PSEUDO: { name: string; re: RegExp }[] = [
  { name: '· idle (main thread free)', re: /^\(idle\)$/ },
  { name: '· program (V8 internal)', re: /^\(program\)$/ },
  { name: '· garbage collection', re: /^\(garbage collector\)$/ },
]

/**
 * Merge every `ProfileChunk`, then attribute each sample to its nearest
 * interesting ancestor, walking up from the sampled leaf.
 *
 * Two details are load-bearing:
 *
 *  - Node ids are delta-encoded. Each chunk carries only its *new* nodes, so
 *    all chunks must merge into one id→node table before counting, or a parent
 *    link resolves to nothing and every sample orphans.
 *  - `timeDeltas` is what makes these milliseconds. `samples` is just a list of
 *    node ids; without the deltas there is no duration, and assuming 1ms per
 *    sample is a guess dressed as a measurement.
 */
function samplesByBucket(events: TraceEvent[], pid: number | undefined): Map<string, number> {
  const nodes = new Map<number, Node>()
  const out = new Map<string, number>()
  const interesting = (n: Node | undefined): string | null => {
    if (!n) return null
    const name = n.callFrame?.functionName ?? ''
    for (const p of PSEUDO) if (p.re.test(name)) return p.name
    return bucketFor(name, n.callFrame?.url ?? '')
  }

  for (const e of events) {
    if (e.name !== 'ProfileChunk' || e.pid !== pid) continue
    const d = e.args?.data as Chunk | undefined
    if (!d) continue
    for (const n of d.cpuProfile?.nodes ?? []) nodes.set(n.id, n)

    const samples = d.cpuProfile?.samples ?? []
    const deltas = d.timeDeltas ?? []
    samples.forEach((id, i) => {
      const ms = (deltas[i] ?? 0) / 1000
      if (ms <= 0) return
      let cur: Node | undefined = nodes.get(id)
      let bucket: string | null = null
      let depth = 0
      while (cur && depth < 64) {
        bucket = interesting(cur)
        if (bucket) break
        cur = cur.parent === undefined ? undefined : nodes.get(cur.parent)
        depth++
      }
      const key = bucket ?? 'unattributed (leaf frames)'
      out.set(key, (out.get(key) ?? 0) + ms)
    })
  }
  return out
}

// ── in-page observer ───────────────────────────────────────────────────────

type PageProfile = {
  longTasks: { name: string; start: number; duration: number }[]
  resources: { name: string; start: number; end: number; size: number }[]
  lcp: number
}

/**
 * Installed via `addInitScript`, so it is listening before the entry chunk runs.
 *
 * `buffered: true` matters more than it looks: an observer registered after
 * load misses everything before it, and on this page every long task happens
 * before load. A non-buffered observer reports a clean sheet and the profile
 * looks perfect.
 */
const OBSERVER = () => {
  const w = window as unknown as { __profile: PageProfile; __observerInstalled?: boolean }
  if (w.__observerInstalled) return
  w.__observerInstalled = true
  w.__profile = { longTasks: [], resources: [], lcp: 0 }

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        w.__profile.longTasks.push({ name: e.name, start: e.startTime, duration: e.duration })
      }
    }).observe({ type: 'longtask', buffered: true })
  } catch {
    /* longtask unsupported — the trace is the primary source anyway */
  }

  try {
    new PerformanceObserver((list) => {
      // `resource` entries are `PerformanceResourceTiming`; lib.dom types the
      // observer's entries as the base `PerformanceEntry`, so the two fields
      // that matter here need the narrowing spelled out.
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        w.__profile.resources.push({ name: e.name, start: e.startTime, end: e.responseEnd, size: e.transferSize })
      }
    }).observe({ type: 'resource', buffered: true })
  } catch {
    /* ignore */
  }

  // LCP is only exposed through a PerformanceObserver. Reading it back with
  // `getEntriesByType('largest-contentful-paint')` returns an empty list —
  // which is why the first four runs of this script all reported `LCP 0ms`
  // and looked like a broken page rather than a broken measurement.
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__profile.lcp = e.startTime
    }).observe({ type: 'largest-contentful-paint', buffered: true })
  } catch {
    /* ignore */
  }
}

// ── one run ────────────────────────────────────────────────────────────────

type Breakdown = {
  evalByUrl: Map<string, number>
  cpu: Map<string, number>
  longTasks: { start: number; duration: number }[]
  totalBlocking: number
  lcp: number
  entryBytes: number
}

async function profileOnce(): Promise<Breakdown> {
  const browser: Browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    await context.addInitScript(OBSERVER)
    const page = await context.newPage()

    // The same slowdown Lighthouse applies. Without it there are no long tasks
    // at all and the report is empty — see the header, point 2.
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })

    await browser.startTracing(page, { categories: CATEGORIES })

    await page.goto(URL, { waitUntil: 'load' })
    // Long enough for the idle-deferred mermaid/shiki work to land, so the
    // profile covers the whole page lifecycle rather than just first paint.
    await page.waitForTimeout(4000)

    const buffer = await browser.stopTracing()
    const events = (JSON.parse(buffer.toString('utf8')).traceEvents ?? []) as TraceEvent[]
    const pid = rendererPid(events)

    const observed = await page.evaluate(() => (window as unknown as { __profile: PageProfile }).__profile)
    const lcp = observed.lcp

    // §10's TBT: the sum of (long task − 50ms). Recomputed here from the same
    // definition so this profile and the gate cannot silently disagree about
    // what TBT means.
    const longTasks = observed.longTasks.map((t) => ({ start: t.start, duration: t.duration }))
    const totalBlocking = longTasks.reduce((s, t) => s + Math.max(0, t.duration - 50), 0)

    const entryBytes = observed.resources
      .filter((r) => /\/assets\/index-[^/]*\.js/.test(r.name))
      .reduce((s, r) => s + (r.size || 0), 0)

    return {
      evalByUrl: evalByBundle(events, pid),
      cpu: samplesByBucket(events, pid),
      longTasks,
      totalBlocking,
      lcp,
      entryBytes,
    }
  } finally {
    await browser.close()
  }
}

// ── report ─────────────────────────────────────────────────────────────────

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

const PSEUDO_PREFIX = '· '

/** Pseudo-frames are V8 bookkeeping and waiting, not work. See `PSEUDO`. */
const isWork = (key: string): boolean => !key.startsWith(PSEUDO_PREFIX)

function fmtMap(m: Map<string, number>, total: number): string {
  if (total <= 0) return '        (no samples)'
  // Percentages are against **work**, not against wall time, so the real
  // buckets stay legible next to a multi-second idle row.
  const work = [...m.entries()].filter(([k]) => isWork(k)).reduce((a, [, v]) => a + v, 0)
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => {
      const pct = isWork(k) ? ((v / work) * 100).toFixed(0).padStart(4) : '     '
      return `        ${k.padEnd(34)} ${v.toFixed(1).padStart(8)}ms ${pct}%`
    })
    .join('\n')
}

function mergeMedians(runs: Breakdown[], pick: (r: Breakdown) => Map<string, number>): Map<string, number> {
  const byKey = new Map<string, number[]>()
  for (const r of runs) {
    for (const [k, v] of pick(r)) {
      const arr = byKey.get(k)
      if (arr) arr.push(v)
      else byKey.set(k, [v])
    }
  }
  return new Map([...byKey].map(([k, v]) => [k, median(v)]))
}

/**
 * An unminified build, because a minified profile names its hot functions `mk`
 * and `Ol` and so cannot answer the question. Same app, same host, different
 * bytes.
 */
async function buildProfileBundle(): Promise<string> {
  process.stdout.write('building an unminified bundle to profile (dist-profile/)…\n')
  await run('npx', ['vite', 'build', '--outDir', 'dist-profile', '--minify', 'false'], { cwd: repoRoot() })
  return join(repoRoot(), 'dist-profile')
}

const main = async (): Promise<void> => {
  const root = await buildProfileBundle()
  const server = await startServer(PORT, root)
  const runs: Breakdown[] = []
  try {
    for (let i = 0; i < RUNS; i++) {
      process.stdout.write(`profiling run ${i + 1}/${RUNS}…\n`)
      runs.push(await profileOnce())
    }
  } finally {
    await server.close()
  }

  const out: string[] = [
    '',
    '══ M4.6b — profile of the two long tasks ══',
    '',
    `URL ${URL} · CPU throttled ${CPU_THROTTLE}x · ${RUNS} runs · medians below`,
    'Profiled an UNMINIFIED build: absolute times are pessimistic, the ranking is the finding.',
    '',
  ]

  for (const [i, r] of runs.entries()) {
    const eT = [...r.evalByUrl.values()].reduce((a, b) => a + b, 0)
    const cT = [...r.cpu.values()].reduce((a, b) => a + b, 0)
    out.push(`── run ${i + 1} ──`)
    out.push(`  long tasks ${r.longTasks.length} · TBT ${r.totalBlocking.toFixed(0)}ms · LCP ${r.lcp.toFixed(0)}ms · entry ${(r.entryBytes / 1024).toFixed(0)}KB`)
    out.push('  Q1  eval/call time, by bundle:')
    out.push(fmtMap(r.evalByUrl, eT))
    out.push('  Q2  main-thread samples, by bucket:')
    out.push(fmtMap(r.cpu, cT))
    out.push('')
  }

  const medEval = mergeMedians(runs, (r) => r.evalByUrl)
  const medCpu = mergeMedians(runs, (r) => r.cpu)
  const eT = [...medEval.values()].reduce((a, b) => a + b, 0)
  const cT = [...medCpu.values()].reduce((a, b) => a + b, 0)

  out.push('── MEDIAN of 3 ──')
  out.push('  Q1  eval/call time, by bundle:')
  out.push(fmtMap(medEval, eT))
  out.push('  Q2  main-thread samples, by bucket:')
  out.push(fmtMap(medCpu, cT))
  out.push('')
  out.push(`  TBT median ${median(runs.map((r) => r.totalBlocking)).toFixed(0)}ms · LCP median ${median(runs.map((r) => r.lcp)).toFixed(0)}ms`)

  const index = medCpu.get('search: index construction') ?? 0
  out.push('')
  out.push(`  M4.6c precondition: index construction ≈ ${index.toFixed(0)}ms`)
  out.push(
    `    ${index >= 100 ? 'MEETS the ≥100ms half of the gate — the first-keystroke test is still required before any deferral.' : 'BELOW 100ms — M4.6c is skipped entirely.'}`,
  )

  const report = out.join('\n')
  process.stdout.write(report)
  const dir = join(repoRoot(), 'artifacts')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'profile-long-tasks.txt'), report)
}

void main()
