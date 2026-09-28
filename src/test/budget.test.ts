/**
 * §10 budget: initial JS ≤ 200KB gz, with the heavy renderers in lazy chunks.
 *
 * This runs against a real `vite build` output, because the only honest way to
 * measure an initial bundle is to look at what index.html actually pulls in.
 * It is skipped when `dist/` is absent so `vitest` alone stays fast.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { beforeAll, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
/**
 * The budget is measured against a build this test owns, in its own output
 * directory. Measuring `dist/` meant spawning `vite build` alongside the other
 * workers, which wiped `dist/` out from under them — a self-inflicted flake.
 */
const distDir = join(repoRoot, 'dist-budget')

/** §10. */
const INITIAL_JS_BUDGET_GZ = 200 * 1024

let available = false
let entryChunks: string[] = []
let allJs: string[] = []

beforeAll(() => {
  rmSync(distDir, { recursive: true, force: true })
  execFileSync('npx', ['vite', 'build', '--outDir', 'dist-budget', '--emptyOutDir'], {
    cwd: repoRoot,
    stdio: 'ignore',
    // **Production mode, explicitly.** Vitest sets `NODE_ENV=test` for every
    // process it spawns, and Vite builds a materially different bundle from
    // that: `process.env.NODE_ENV` is substituted at build time, so the
    // dev-only branches survive and the tree-shaking that makes the shipped
    // bundle small never happens. The symptom was an "entry" of 681KB raw /
    // 204.8KB gz against a real production entry of 418KB raw / 132.4KB gz —
    // the same application, measured with the wrong environment.
    //
    // It went unnoticed because the inflated figure only crossed 200KB once M2
    // added the palette, chips and popovers. The budget has been measuring a
    // bundle nobody ships since M0.
    env: { ...process.env, NODE_ENV: 'production' },
  })
  if (!existsSync(join(distDir, 'index.html'))) return
  available = true

  const html = readFileSync(join(distDir, 'index.html'), 'utf8')
  entryChunks = [...html.matchAll(/assets\/([^"']+\.js)/g)].map((match) => match[1] as string)
  allJs = readdirSync(join(distDir, 'assets')).filter((name) => name.endsWith('.js'))
}, 180_000)

describe('§10 bundle budgets', () => {
  it('a build exists to measure', () => {
    expect(available).toBe(true)
  })

  it('initial JS is at or under 200KB gzipped', () => {
    if (!available) return
    const raw = entryChunks.reduce((sum, name) => sum + statSync(join(distDir, 'assets', name)).size, 0)
    const gz = entryChunks.reduce(
      (sum, name) => sum + gzipSync(readFileSync(join(distDir, 'assets', name))).length,
      0,
    )
    // Printed, not just asserted: a budget that only speaks when it fails tells
    // you nothing until it is already broken, and §10 is a number a human reads.
    process.stdout.write(
      `  entry: ${entryChunks.join(', ')} — ${(gz / 1024).toFixed(1)}KB gz (${(raw / 1024).toFixed(1)}KB raw)\n`,
    )
    expect(gz).toBeLessThanOrEqual(INITIAL_JS_BUDGET_GZ)
  })

  it('cmdk lands in the entry chunk, not a lazy one (M2.8)', () => {
    if (!available) return
    // The palette is the one interaction that must feel instant (spec §7.4), so
    // splitting cmdk out would add a round trip to opening it. cmdk is ~11KB, so
    // this is a placement decision rather than a size one.
    const entry = entryChunks.join(' ')
    const lazy = allJs.filter((name) => !entry.includes(name))
    expect(lazy.join(' ')).not.toContain('cmdk')
  })

  it('the entry chunk pulls in React but not the syntax highlighters', () => {
    if (!available) return
    const entry = entryChunks
      .map((name) => readFileSync(join(distDir, 'assets', name), 'utf8'))
      .join('')
    expect(entry).toContain('react')
    // Shiki's WASM regex engine and its TextMate runtime must stay lazy.
    expect(entry).not.toContain('oniguruma')
    expect(entry).not.toContain('vscode-textmate')
  })

  it('shiki and mermaid are separate lazy chunks, not part of the entry', () => {
    if (!available) return
    const entry = entryChunks.join(' ')
    const lazy = allJs.filter((name) => !entry.includes(name))
    // Mermaid's core is a large standalone chunk; its presence in `lazy` is
    // the proof that the reader does not download it up front.
    expect(lazy.some((name) => name.includes('mermaid'))).toBe(true)
    // Shiki ships its languages as their own chunks too.
    expect(lazy.length).toBeGreaterThan(5)
  })

  it('the still-deferred milestone libraries are absent from the whole build', () => {
    if (!available) return
    const names = allJs.join(' ')
    // `cmdk` left this list in M2, and `xyflow` in M3. **Framer Motion stays on
    // it** — M4.4 audited the motion budget and found one misfiled tier, not a
    // shortage; the three signature moments are CSS keyframes, and the spec's
    // §4 "Framer Motion" line was a stack choice that the audit showed to be
    // unnecessary. `canvas-confetti` joined it in M4.5 and left it again when the
    // delight feature was removed outright: the library is no longer a lazy
    // chunk, it is not a dependency at all.
    expect(names).not.toContain('framer-motion')
    expect(names).not.toContain('OffscreenCanvasRenderingContext2D')
  })

  it('React Flow is a lazy chunk and never part of the entry (M3.1, spec §10)', () => {
    if (!available) return
    // §10 names React Flow as a lazy chunk explicitly. Asserting only that it
    // appears *somewhere* would pass even if a stray import in the shell pulled
    // it into the entry — which is the failure this rule exists to catch.
    //
    // The marker is a string from the library's own bundle rather than a chunk
    // *filename*: Vite names chunks after the importing module, and the graph
    // view's name would not prove which library is inside it.
    const MARKER = 'xyflow'
    const entry = entryChunks
      .map((name) => readFileSync(join(distDir, 'assets', name), 'utf8'))
      .join('')
    expect(entry, 'React Flow leaked into the entry chunk').not.toContain(MARKER)

    const lazy = allJs
      .filter((name) => !entryChunks.includes(name))
      .map((name) => readFileSync(join(distDir, 'assets', name), 'utf8'))
      .join('')
    expect(lazy, 'React Flow is in no chunk at all — the graph view may not be built').toContain(
      MARKER,
    )
  })
  it('the built HTML preloads the config and the document (M4.6, §10)', () => {
    if (!available) return
    // The M1.9e waterfall fix, asserted in the artifact it produces. A preload
    // hint that is silently absent costs nothing to notice and everything to
    // miss, which is why the first version of this — a `generateBundle` hook
    // that ran before Vite emitted the HTML — passed for two builds before
    // anyone looked at `dist/index.html`.
    //
    // The *configured* path comes from the repo root rather than from the build
    // output: the deployable copy is written to `dist/` by `closeBundle`, and this
    // test measures a build made in `dist-budget/`, which has no config of its
    // own. Reading the source of truth is also the stronger assertion — it checks
    // the hint against what the deployer actually wrote.
    const html = readFileSync(join(distDir, 'index.html'), 'utf8')
    const config = JSON.parse(readFileSync(join(repoRoot, 'unfold.config.json'), 'utf8')) as {
      docPath?: string
    }
    const docPath = (config.docPath as string).replace(/^\.\//u, '')

    // `as="fetch"` + `crossorigin` together, or not at all: a preload without
    // `crossorigin` is fetched in no-cors mode, lands in a different cache entry,
    // and is then fetched *again* by the real request — a wasted round trip that
    // looks like it is working.
    for (const href of ['/unfold.config.json', `/${docPath}`]) {
      expect(html, `no preload hint for ${href}`).toContain(
        `<link rel="preload" href="${href}" as="fetch" crossorigin`,
      )
    }
  })

  it('and the document it preloads is one the build ships (M4.6)', () => {
    if (!available) return
    // A hint for a document that is not deployed is not a hint, it is a 404 on
    // the critical path — strictly worse than no hint, because the browser
    // starts the real fetch only after the hint has failed.
    const config = JSON.parse(readFileSync(join(repoRoot, 'unfold.config.json'), 'utf8')) as {
      docPath?: string
    }
    const docPath = (config.docPath as string).replace(/^\.\//u, '')
    expect(existsSync(join(repoRoot, docPath)), `${docPath} is preloaded but does not exist`).toBe(true)
  })
})

describe('the build ships what it is configured to read', () => {
  it('dist/ contains the config the app fetches', () => {
    expect(existsSync(join(repoRoot, 'dist', 'unfold.config.json'))).toBe(true)
  })

  it('the configured docPath exists inside dist/', () => {
    const config = JSON.parse(
      readFileSync(join(repoRoot, 'dist', 'unfold.config.json'), 'utf8'),
    ) as { docPath?: string }
    expect(typeof config.docPath).toBe('string')
    const shipped = join(repoRoot, 'dist', (config.docPath as string).replace(/^\.\//u, ''))
    expect(existsSync(shipped), `${config.docPath} is missing from dist/`).toBe(true)
  })

  it('every fixture named by the config is actually in dist/', () => {
    const config = JSON.parse(
      readFileSync(join(repoRoot, 'dist', 'unfold.config.json'), 'utf8'),
    ) as { docPath?: string }
    const dir = (config.docPath as string).replace(/^\.\//u, '').split('/')[0] as string
    const shipped = readdirSync(join(repoRoot, 'dist', dir)).filter((name) => name.endsWith('.md'))
    const source = readdirSync(join(repoRoot, dir)).filter((name) => name.endsWith('.md'))
    expect(shipped.sort()).toEqual(source.sort())
  })

  it('the shipped document is byte-identical to the source of truth', () => {
    const config = JSON.parse(
      readFileSync(join(repoRoot, 'dist', 'unfold.config.json'), 'utf8'),
    ) as { docPath?: string }
    const relative = (config.docPath as string).replace(/^\.\//u, '')
    expect(readFileSync(join(repoRoot, 'dist', relative), 'utf8')).toBe(
      readFileSync(join(repoRoot, relative), 'utf8'),
    )
  })
})

/* ------------------------------------------------------------------ *
 * The deployable unit is dist/ PLUS the documents it is configured to
 * read. A correct `docPath` that 404s (or, worse, hits the SPA fallback)
 * is a deployment bug, not a runtime one — and with M4.6's preload hint, a
 * docPath that 404s is now a 404 on the critical path as well.
 * ------------------------------------------------------------------ */

describe('the build ships what it is configured to read', () => {
  it('dist/ contains the config the app fetches', () => {
    expect(existsSync(join(repoRoot, 'dist', 'unfold.config.json'))).toBe(true)
  })

  it('the configured docPath exists inside dist/', () => {
    const config = JSON.parse(
      readFileSync(join(repoRoot, 'dist', 'unfold.config.json'), 'utf8'),
    ) as { docPath?: string }
    expect(typeof config.docPath).toBe('string')
    const shipped = join(repoRoot, 'dist', (config.docPath as string).replace(/^\.\//u, ''))
    expect(existsSync(shipped), `${config.docPath} is missing from dist/`).toBe(true)
  })

  it('every fixture named by the config is actually in dist/', () => {
    const config = JSON.parse(
      readFileSync(join(repoRoot, 'dist', 'unfold.config.json'), 'utf8'),
    ) as { docPath?: string }
    const dir = (config.docPath as string).replace(/^\.\//u, '').split('/')[0] as string
    const shipped = readdirSync(join(repoRoot, 'dist', dir)).filter((name) => name.endsWith('.md'))
    const source = readdirSync(join(repoRoot, dir)).filter((name) => name.endsWith('.md'))
    expect(shipped.sort()).toEqual(source.sort())
  })

  it('the shipped document is byte-identical to the source of truth', () => {
    const config = JSON.parse(
      readFileSync(join(repoRoot, 'dist', 'unfold.config.json'), 'utf8'),
    ) as { docPath?: string }
    const relative = (config.docPath as string).replace(/^\.\//u, '')
    expect(readFileSync(join(repoRoot, 'dist', relative), 'utf8')).toBe(
      readFileSync(join(repoRoot, relative), 'utf8'),
    )
  })
})
