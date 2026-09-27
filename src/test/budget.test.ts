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
    // Reported so a regression is visible in CI output, not just on failure.
    expect(`${(gz / 1024).toFixed(1)}KB gz (${(raw / 1024).toFixed(1)}KB raw)`).toBeTypeOf('string')
    expect(gz).toBeLessThanOrEqual(INITIAL_JS_BUDGET_GZ)
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

  it('the deferred milestone libraries are absent from the whole build', () => {
    if (!available) return
    const names = allJs.join(' ')
    // `cmdk` left this list in M2: the palette ships it in M2.2. These three
    // remain M3/M4 and must not have crept in early.
    for (const deferred of ['framer-motion', 'canvas-confetti', 'xyflow']) {
      expect(names).not.toContain(deferred)
    }
  })
})

/* ------------------------------------------------------------------ *
 * The deployable unit is dist/ PLUS the documents it is configured to
 * read. A correct `docPath` that 404s (or, worse, hits the SPA fallback)
 * is a deployment bug, not a runtime one.
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
