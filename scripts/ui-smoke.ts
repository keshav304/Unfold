/**
 * DEV-ONLY — the UI-level stranger test, over real HTTP.
 *
 * M1.9c: this used to boot `dist/` in jsdom and hand the document to the app
 * through a `fetch` stub. That is exactly why the A5 defect escaped 545 tests:
 * the stub could not reproduce a static host answering a miss with the app
 * shell and status 200. Now the built artifact is served by a real HTTP server
 * and the app fetches over the network, so the failure modes that matter —
 * SPA fallback, wrong MIME, a document that was never deployed — are real.
 *
 *   npm run ui-smoke                 # the five fixtures
 *   npm run ui-smoke -- --stranger   # five node_modules READMEs
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

const repoRoot = process.cwd()
const distDir = join(repoRoot, 'dist')
const stranger = process.argv.includes('--stranger')
const PORT = 5399

/* ------------------------------------------------------------------ *
 * A static host, faithfully: no SPA rewrite for asset misses, which is
 * what makes the wrong-docPath case observable.
 * ------------------------------------------------------------------ */

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
}

/** The docPath the served config will advertise; swapped per case. */
let servedDocPath = '/testdocs/kitchen-sink.md'

/** `spaFallback: true` reproduces hosts that rewrite misses to index.html. */
function serve(root: string, port: number, spaFallback: boolean): Promise<Server> {
  const server = createServer((req, res) => {
    const requested = decodeURIComponent((req.url ?? '/').split('?')[0] as string)

    // The config the app fetches at boot, resolved per case so the real fetch
    // path is exercised end to end — no stubbing of the app's own requests.
    if (requested === '/unfold.config.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ docPath: servedDocPath }))
      return
    }

    let file = normalize(join(root, requested))
    // Refuse to serve anything outside the root.
    if (!resolve(file).startsWith(resolve(root))) {
      res.writeHead(403).end()
      return
    }
    // A second mount, so a document that lives outside dist/ (a stranger
    // README under node_modules/) can be fetched over the same HTTP path.
    if (!existsSync(file) || statSync(file).isDirectory()) {
      const outside = join(repoRoot, requested)
      if (
        (requested.startsWith('/node_modules/') || requested.startsWith('/testdocs/')) &&
        existsSync(outside) &&
        !statSync(outside).isDirectory()
      ) {
        res.writeHead(200, { 'content-type': MIME[extname(outside)] ?? 'application/octet-stream' })
        createReadStream(outside).pipe(res)
        return
      }
      if (spaFallback) {
        res.writeHead(200, { 'content-type': 'text/html' }).end(readFileSync(join(root, 'index.html')))
        return
      }
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
      return
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  })
  return new Promise((resolveServer) => server.listen(port, () => resolveServer(server)))
}

/* ------------------------------------------------------------------ *
 * Documents under test
 * ------------------------------------------------------------------ */

type Case = { label: string; docPath: string; expect: 'doc' | 'shell' }

function cases(): Case[] {
  if (stranger) {
    const found = execFileSync(
      'find',
      ['node_modules', '-maxdepth', '3', '-name', 'README.md'],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    )
    return found
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .slice(0, 5)
      .map((file) => ({ label: file, docPath: `/${file}`, expect: 'doc' as const }))
  }
  return (['kitchen-sink', 'minimal', 'crosslinked', 'no-structure', 'edge-cases'] as const).map((name) => ({
    label: `${name}.md`,
    docPath: `/testdocs/${name}.md`,
    expect: 'doc' as const,
  }))
}

/** A docPath that does not exist, to prove A5 refuses the SPA fallback. */
const MISSING: Case = { label: 'a docPath that was never deployed', docPath: '/testdocs/nope.md', expect: 'shell' }

const html = readFileSync(join(distDir, 'index.html'), 'utf8')
const entryName = html.match(/assets\/[^"']+\.js/)![0] as string
const entry = readFileSync(join(distDir, entryName), 'utf8').replace(/export\{[^}]*\};?\s*$/u, '')

let failures = 0
const note = (message: string): void => {
  failures += 1
  process.stdout.write(`   !! ${message}\n`)
}

async function boot(origin: string, testCase: Case): Promise<{ errors: string[]; body: () => Document }> {
  servedDocPath = testCase.docPath
  const errors: string[] = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (error: Error) => errors.push(error.message))
  virtualConsole.on('error', (...args: unknown[]) => errors.push(args.map(String).join(' ')))

  /*
   * Booted at `#/`, not at `/` (M4.12). A bare `/` is now the front door and
   * fetches nothing, so booting the smoke test there would check that the
   * welcome view renders — sixteen times — and never check a single document.
   *
   * `#/` is the reader with nothing yet read, and it is a real URL the app
   * handles, so this exercises the ordinary load path rather than reaching into
   * the component. The missing-doc case is the point of the whole script, and it
   * is only reachable by asking for a document.
   */
  const dom = new JSDOM(html, { url: `${origin}/#/`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole })
  const { window } = dom

  // Real network fetch against the served dist — no stubbing of the app's own
  // requests. jsdom has no fetch of its own, so Node's is bound in, resolving
  // relative URLs exactly as a browser would.
  const nodeFetch = fetch
  ;(window as unknown as { fetch: unknown }).fetch = (input: unknown, init?: unknown) => {
    const url = String(input)
    const absolute = url.startsWith('http') ? url : `${origin}${url.startsWith('/') ? '' : '/'}${url}`
    return nodeFetch(absolute, init as RequestInit)
  }

  window.eval(entry)
  await new Promise((r) => setTimeout(r, 1200))
  return { errors, body: () => window.document }
}

async function run(): Promise<void> {
  process.stdout.write(`UI smoke over HTTP — serving dist/ on :${PORT}\n`)
  for (const testCase of [...cases(), MISSING]) {
    const { errors, body } = await boot(`http://localhost:${PORT}`, testCase)
    const doc = body()

    const rendered = doc.querySelector('.app') !== null
    const drop = doc.querySelector('.drop-screen') !== null
    const title = doc.querySelector('h1')?.textContent?.trim() ?? ''
    const sections = doc.querySelectorAll('.reader-section').length
    const switcher = doc.querySelector('.view-switcher') !== null
    const rail = doc.querySelector('.toc') !== null

    process.stdout.write(`\n── ${testCase.label}\n`)
    process.stdout.write(`   docPath        : ${testCase.docPath}\n`)
    process.stdout.write(`   shell rendered : ${rendered}\n`)
    process.stdout.write(`   drop screen    : ${drop}\n`)
    process.stdout.write(`   title          : ${title || '(none)'}\n`)
    process.stdout.write(`   sections       : ${sections}\n`)
    process.stdout.write(`   view switcher  : ${switcher}\n`)
    process.stdout.write(`   toc rail       : ${rail ? 'shown' : 'hidden'}\n`)
    process.stdout.write(`   console errors : ${errors.length}\n`)
    for (const error of errors.slice(0, 4)) process.stdout.write(`      ! ${error}\n`)

    if (errors.length > 0) note('console errors')
    if (testCase.expect === 'shell') {
      // A5: the shell must be refused, never rendered as a document.
      if (rendered) note('rendered the app shell as a document')
      if (!drop) note('did not show the drop screen for a missing document')
      if (sections > 0) note('invented sections from the shell')
      const message = doc.querySelector('.drop-message')?.textContent ?? ''
      if (!/app shell/i.test(message)) note('drop screen message does not mention the app shell')
    } else {
      if (!rendered) note('did not render a document')
      if (drop) note('showed the drop screen for a document that exists')
      if (title === '') note('no title')
    }
  }

  process.stdout.write(`\n${failures === 0 ? 'OK' : `${failures} problem(s)`}\n`)
  process.exitCode = failures === 0 ? 0 : 1
}

if (!existsSync(join(distDir, 'index.html'))) execFileSync('npm', ['run', 'build'], { stdio: 'ignore' })

const server = await serve(distDir, PORT, true)
await run()
server.close()
process.exit(process.exitCode ?? 0)
