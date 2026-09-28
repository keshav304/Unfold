/**
 * M1.0 — the genericity greps, promoted from "run them by hand" to CI.
 *
 * Three properties, each of which a future session could break silently:
 *   a) no colour literal anywhere in src/ except tokens.css
 *   b) no document-specific string in src/** (the denylist is a data file, so
 *      the forbidden terms live in one obvious place, not in code)
 *   c) no dependency outside the spec §4 allowlist
 *
 * These are the standing risk checks in plan §9, and a carry-forward from the
 * M0 review.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const srcDir = resolve(repoRoot, 'src')

/** The one file a colour literal is allowed to live in. */
const TOKEN_FILE = join('src', 'styles', 'tokens.css')
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/
const SNAPSHOT_DIR = '__snapshots__'
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.css'])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === SNAPSHOT_DIR) continue
      walk(full, out)
    } else if (SOURCE_EXTENSIONS.has(extname(full))) {
      out.push(full)
    }
  }
  return out
}

/** Tests and snapshots may quote literals; production source may not. */
function isProduction(relPath: string): boolean {
  return !TEST_FILE.test(relPath)
}

/* ------------------------------------------------------------------ *
 * (a) No colour literals outside tokens.css
 * ------------------------------------------------------------------ */

/** `#abc`, `#aabbcc`, `rgb(...)`, `rgba(...)`, `hsl(...)`, `oklch(...)`. */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\bcolor-mix\(/g

function colourOffenders(): string[] {
  const offenders: string[] = []
  for (const file of walk(srcDir)) {
    const rel = relative(repoRoot, file)
    if (rel === TOKEN_FILE || !isProduction(rel)) continue

    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        // A comment naming a token is fine; a literal is not.
        const code = line.replace(/\/\/.*$/u, '').replace(/\/\*.*?\*\//gu, '')
        for (const match of code.matchAll(COLOUR_LITERAL)) {
          offenders.push(`${rel}:${index + 1}  ${match[0]}  —  ${line.trim()}`)
        }
      })
  }
  return offenders
}

describe('M1.0a: colour literals live in tokens.css only', () => {
  it('finds no colour literal in production source', () => {
    expect(colourOffenders()).toEqual([])
  })

  it('would actually catch one', () => {
    // A guard that cannot fail is not a guard.
    expect([..."color: '#ff0000'".matchAll(COLOUR_LITERAL)].length).toBeGreaterThan(0)
  })

  it('every stylesheet lives under src/styles', () => {
    // tokens.css holds every literal; the rest hold only structural rules.
    // A stylesheet next to a component is a decision, not an accident.
    const cssFiles = walk(srcDir)
      .filter((file) => file.endsWith('.css'))
      .map((file) => relative(repoRoot, file))
    expect(cssFiles.length).toBeGreaterThan(0)
    for (const file of cssFiles) {
      expect(file.startsWith(join('src', 'styles')), `${file} should live in src/styles/`).toBe(true)
    }
  })
})

/* ------------------------------------------------------------------ *
 * (b) No document-specific strings in src/
 * ------------------------------------------------------------------ */

type Denylist = { description: string; terms: string[] }

const denylistFile = JSON.parse(
  readFileSync(resolve(here, 'genericity-denylist.json'), 'utf8'),
) as { $comment?: string; lists?: Denylist[] }
const denylists: Denylist[] = denylistFile.lists ?? []

function stringOffenders(): string[] {
  const offenders: string[] = []
  for (const file of walk(srcDir)) {
    const rel = relative(repoRoot, file)
    if (!isProduction(rel)) continue
    const text = readFileSync(file, 'utf8').toLowerCase()
    for (const { terms } of denylists) {
      for (const term of terms) {
        if (text.includes(term.toLowerCase())) offenders.push(`${rel}  →  "${term}"`)
      }
    }
  }
  return offenders
}

describe('M1.0b: no document-specific strings in src/', () => {
  it('finds no document-specific string in production source', () => {
    expect(stringOffenders()).toEqual([])
  })

  it('the denylist is non-empty and documented, or the check is vacuous', () => {
    expect(denylists.length).toBeGreaterThan(0)
    expect(denylists.every((entry) => entry.terms.length > 0)).toBe(true)
    expect(denylistFile.$comment).toBeTypeOf('string')
  })

  it('the denylist actually covers the bundled demo document', () => {
    const demo = readFileSync(resolve(repoRoot, 'ARCHITECTURE.md'), 'utf8')
    const headings = demo
      .split('\n')
      .filter((line) => /^#{1,3}\s/.test(line))
      .map((line) => line.replace(/^#+\s+/u, '').trim())
    const haystack = JSON.stringify(denylistFile).toLowerCase()
    // If the demo doc is renamed or rewritten, this says so rather than
    // quietly checking nothing.
    const covered = headings.filter((heading) => haystack.includes(heading.toLowerCase()))
    expect(covered.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ *
 * (c) Dependencies stay inside the spec §4 allowlist
 * ------------------------------------------------------------------ */

/**
 * Justified additions beyond the literal §4 table. Each carries its reason, so
 * a new dependency has to arrive with its justification visible in the diff
 * rather than as a bare name in an allowlist.
 */
const ALLOWED_DEPS: Record<string, string> = {
  react: '§4 Rendering — custom components per block kind',
  'react-dom': '§4 Rendering — DOM renderer for React',
  unified: '§4 MD parsing — mdast processor',
  'remark-parse': '§4 MD parsing — CommonMark parser',
  'remark-gfm': '§4 MD parsing — GFM tables are a §6.3 block kind',
  'js-yaml': '§4 frontmatter parser — pure JS, identical in Node and the browser',
  minisearch: '§4 Search — in-memory fuzzy index',
  'unist-util-visit': 'mdast traversal helper for the §6.2 transform',
  shiki: '§4 Code highlight — github-dark, lazy chunk',
  mermaid: '§4 Diagrams — lazy chunk, dark theme',
  cmdk: '§7.4 palette — headless combobox with the aria wiring §9 requires; hand-rolling it is how focus traps get subtly wrong',
  '@xyflow/react': '§4 Graph — React Flow, the library the spec names, as a lazy chunk. It owns pan/zoom, viewport transforms and node focusability, which are the three things M3.7 needs a real browser to verify; a hand-rolled canvas would be re-implementing them and would fail the keyboard walk',
  'canvas-confetti': '§4 Delight — the library the spec names, as a dynamic import inside the `features.delight` branch. The M4 brief authorised exactly this one dependency and no other; §7.10 wants confetti at reading milestones and a Konami code, and the alternative is a hand-rolled particle system, which is a second animation engine to keep inside the §8 budget for a decoration. `budget.test.ts` asserts it is a lazy chunk and that the entry does not preload it.',
}

/** Tooling; never shipped to the browser. */
const ALLOWED_DEV_DEPS: Record<string, string> = {
  typescript: '§4 TypeScript strict',
  vite: '§4 Build',
  '@vitejs/plugin-react': '§4 Build — React plugin for Vite',
  tailwindcss: '§4 Styling',
  postcss: '§4 Styling pipeline',
  autoprefixer: '§4 Styling pipeline',
  vitest: '§4 Testing',
  jsdom: '§4 Testing environment',
  '@testing-library/react': '§4 Testing',
  '@testing-library/dom': '§4 Testing',
  '@testing-library/jest-dom': '§4 Testing matchers',
  '@playwright/test': '§11 CI — a real engine for the defect classes jsdom cannot see: focus traps, focus restore, layout geometry, served artifacts',
  '@axe-core/playwright': '§9 a11y — axe-core driven through the page a real user loads, not a jsdom approximation of one',
  '@types/react': '§4 TypeScript strict',
  '@types/react-dom': '§4 TypeScript strict',
  '@types/mdast': '§4 mdast types',
  '@types/js-yaml': '§4 types for the frontmatter YAML parser',
  '@types/node': '§4 Node types for build scripts',
  '@fontsource-variable/geist': '§10 self-hosted subsets — display/headline face',
  '@fontsource-variable/inter': '§10 self-hosted subsets — body face',
  '@fontsource-variable/jetbrains-mono': '§10 self-hosted subsets — code face',
  '@types/canvas-confetti': '§4 types for the confetti delight library; dev-only, never shipped',
}

/**
 * §13: these belong to later milestones. Installing them early is the
 * "just for X" smell plan §9 says to reject.
 *
 * `cmdk` left this list in M2 and `@xyflow/react` in M3; `canvas-confetti` left
 * it in M4.5 — that is the guard doing its job: a deferred library may only be
 * promoted in the milestone that actually ships it, and only with a written
 * reason in the allowlist above.
 *
 * **Framer Motion is still here**, and M4.4 is why. Spec §4 names it for
 * "layout/gesture animation, reduced-motion API", and the M4.4 audit found the
 * opposite: all three signature moments were already CSS keyframes, the §8
 * budget was satisfiable without it, and the one real defect was an ambient loop
 * on the wrong duration token. Adding a 40KB animation library to fix a
 * misfiled token would have been the "just for X" smell this guard exists to
 * reject. The M4 brief is explicit that framer-motion is not to be installed.
 */
const DEFERRED = ['framer-motion']

function manifest(): { dependencies: Record<string, string>; devDependencies: Record<string, string> } {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  return { dependencies: pkg.dependencies ?? {}, devDependencies: pkg.devDependencies ?? {} }
}

describe('M1.0c: no dependency outside the spec §4 allowlist', () => {
  it('runtime dependencies are all justified', () => {
    const { dependencies } = manifest()
    expect(Object.keys(dependencies).filter((name) => ALLOWED_DEPS[name] === undefined)).toEqual([])
  })

  it('dev dependencies are all justified', () => {
    const { devDependencies } = manifest()
    expect(Object.keys(devDependencies).filter((name) => ALLOWED_DEV_DEPS[name] === undefined)).toEqual([])
  })

  it('defers the libraries that belong to M2/M3/M4', () => {
    const { dependencies, devDependencies } = manifest()
    const all = { ...dependencies, ...devDependencies }
    for (const name of DEFERRED) expect(all[name]).toBeUndefined()
  })

  it('the allowlists are non-empty and every entry carries a reason', () => {
    for (const table of [ALLOWED_DEPS, ALLOWED_DEV_DEPS]) {
      expect(Object.keys(table).length).toBeGreaterThan(0)
      for (const [name, reason] of Object.entries(table)) {
        expect(reason.length, `${name} needs a justification`).toBeGreaterThan(0)
      }
    }
  })
})
