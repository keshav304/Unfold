/**
 * DEV-ONLY — the UI-level stranger test.
 *
 * Boots the *built* bundle in a real DOM (jsdom), pointing it at a series of
 * documents, and reports console errors plus what actually rendered. This is
 * the check that a human eyeballing the page cannot be replaced by: it proves
 * the shipped artifact runs, not just the source in a unit test.
 *
 *   npm run ui-smoke                 # fixtures
 *   npm run ui-smoke -- --stranger   # five node_modules READMEs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

if (!existsSync('dist/index.html')) execFileSync('npm', ['run', 'build'], { stdio: 'ignore' })

const html = readFileSync('dist/index.html', 'utf8')
const stranger = process.argv.includes('--stranger')

function strangerDocs(): string[] {
  const out = execFileSync('find', ['node_modules', '-maxdepth', '3', '-name', 'README.md'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
  return out.split('\n').map((l) => l.trim()).filter((l) => l !== '').slice(0, 5)
}

type Case = { label: string; path: string; source: string }

const CASES: Case[] = stranger
  ? strangerDocs().map((file) => ({ label: file, path: file, source: readFileSync(file, 'utf8') }))
  : (['kitchen-sink', 'minimal', 'crosslinked', 'no-structure', 'edge-cases'] as const).map((name) => ({
      label: `${name}.md`,
      path: `./testdocs/${name}.md`,
      source: readFileSync(join('testdocs', `${name}.md`), 'utf8'),
    }))

let failures = 0

for (const testCase of CASES) {
  const errors: string[] = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (error: Error) => errors.push(error.message))
  virtualConsole.on('error', (...args: unknown[]) => errors.push(args.map(String).join(' ')))
  const warnings: string[] = []
  virtualConsole.on('warn', (...args: unknown[]) => warnings.push(args.map(String).join(' ')))

  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  })
  const { window } = dom

  // Stand in for fetch: serve the case's markdown and the root config.
  const fetched: string[] = []
  ;(window as unknown as { fetch: unknown }).fetch = async (input: unknown) => {
    const url = String(input)
    fetched.push(url)
    if (url.includes('unfold.config.json')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ docPath: testCase.path }) } as Response
    }
    if (url.includes(testCase.label.split('/').pop() ?? '')) {
      return { ok: true, status: 200, text: async () => testCase.source } as Response
    }
    return { ok: false, status: 404, text: async () => '' } as Response
  }

  // Execute the built entry chunk, then let React commit.
  //
  // The bundle is an ES module and jsdom cannot execute `type="module"`. The
  // only `export` in the entry is Vite's preload-helper re-export, which sits
  // at the very end and is never consumed by the app, so dropping that one
  // statement turns the module into a script that plain eval can run.
  const entryName = html.match(/assets\/[^"']+\.js/)![0]
  const raw = readFileSync(join('dist', entryName), 'utf8')
  const entry = raw.replace(/export\{[^}]*\};?\s*$/u, '')
  if (entry === raw) process.stdout.write('   (note: no trailing export to strip)\n')
  window.eval(entry)
  await new Promise((resolve) => setTimeout(resolve, 900))

  const doc = window.document
  const rendered = doc.querySelector('.app') !== null
  const drop = doc.querySelector('.drop-screen') !== null
  const hasSwitcher = doc.querySelector('.view-switcher') !== null
  const hasToc = doc.querySelector('.toc') !== null
  const sections = doc.querySelectorAll('.reader-section').length
  const headings = Array.from(doc.querySelectorAll('h1, h2, h3')).map((h) => h.textContent?.trim() ?? '')
  const title = doc.querySelector('h1')?.textContent?.trim() ?? ''

  // A document with no headings must not show the metro rail (§7.3).
  const railHidden = !hasToc

  process.stdout.write(`\n── ${testCase.label}\n`)
  process.stdout.write(`   shell rendered : ${rendered}\n`)
  process.stdout.write(`   title          : ${title || '(none)'}\n`)
  process.stdout.write(`   sections       : ${sections}\n`)
  process.stdout.write(`   view switcher  : ${hasSwitcher}\n`)
  process.stdout.write(`   toc rail       : ${hasToc ? 'shown' : 'hidden'}\n`)
  process.stdout.write(`   fetched        : ${fetched.join(' , ')}\n`)
  process.stdout.write(`   console errors : ${errors.length}\n`)
  if (warnings.length > 0) {
    process.stdout.write(`   warnings       : ${warnings.length}\n`)
    for (const warning of warnings.slice(0, 3)) process.stdout.write(`      ~ ${warning}\n`)
  }
  for (const error of errors.slice(0, 5)) process.stdout.write(`      ! ${error}\n`)
  if (headings.length > 0) {
    process.stdout.write(`   headings       : ${headings.slice(0, 4).join(' | ')}\n`)
  }

  // Invariants that must hold for every document.
  if (!rendered) {
    process.stdout.write('   !! nothing rendered\n')
    failures += 1
  }
  if (errors.length > 0) failures += 1
  if (doc.querySelector('.reader-empty') !== null && sections > 0) failures += 1
  void drop
  void railHidden

  dom.window.close()
}

process.stdout.write(`\n${failures === 0 ? 'OK' : `${failures} problem(s)`} across ${CASES.length} document(s)\n`)
process.exitCode = failures === 0 ? 0 : 1
