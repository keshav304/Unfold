/**
 * M2.PW1 — the static host the e2e suite runs against.
 *
 * The same idea as `scripts/ui-smoke.ts` and for the same reason (see M1.9c):
 * a `fetch` stub cannot reproduce a static host answering a miss with the app
 * shell, and the A5 defect escaped 545 unit tests for exactly that reason. The
 * built `dist/` is served over real HTTP here too, so the app fetches its own
 * config and document across a network.
 *
 * Two mounts, both needed:
 *   - `dist/` as the app root, with SPA fallback, because that is what Netlify
 *     and GitHub Pages do and what the wrong-`docPath` case depends on;
 *   - a second mount outside `dist/`, so a stranger README under `node_modules/`
 *     can be fetched over the same path.
 */

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createBrotliCompress, createGzip } from 'node:zlib'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { Page } from '@playwright/test'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The port the test host binds. Fixed, so a stray server is obvious. */
export const PREVIEW_PORT = 4183

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

/**
 * Which document the served config advertises.
 *
 * This is server state, and it is set **over HTTP** rather than by importing a
 * setter. Playwright loads `global-setup.ts` and the spec files through
 * *different module registries*, so a module-level variable set by a test is a
 * different variable from the one the running server reads — the scenario then
 * silently serves the default document and passes or fails for the wrong
 * reason. A request crosses that boundary explicitly.
 */
let servedDocPath = '/testdocs/kitchen-sink.md'

/** The control endpoint a scenario uses to choose its document. */
export const SET_DOC_PATH = '/__set-doc-path'

/** Point the served config at a document, from inside a test. */
export async function useDocument(page: Page, docPath: string): Promise<void> {
  const response = await page.request.get(`${SET_DOC_PATH}?docPath=${encodeURIComponent(docPath)}`)
  if (!response.ok()) throw new Error(`the test host refused to set docPath: ${response.status()}`)
  servedDocPath = docPath
}

// `import.meta.dirname` needs Node 20; this project is on Node 18.
const here = dirname(fileURLToPath(import.meta.url))

/**
 * The static host for the Lighthouse audit compresses.
 *
 * §12's deployment target is Netlify or GitHub Pages, and **both gzip every
 * text response by default**. A test host that does not is not a stricter
 * measurement, it is a different product: it sent a 439KB entry where a real
 * host sends 136KB, and Lighthouse's performance score is dominated by bytes on
 * the wire. Every number M4.6 records — FCP, LCP, the score itself — was
 * measuring this host's silence rather than the app's weight.
 *
 * `br` when the client offers it, `gzip` otherwise, and only for types a real
 * host would compress. `no-store` is kept on the control-plane responses so
 * scenarios cannot see each other's documents, which is the one caching concern
 * this host has.
 */
const COMPRESSIBLE: Record<string, true> = {
  '.html': true,
  '.js': true,
  '.css': true,
  '.json': true,
  '.md': true,
  '.svg': true,
  '.woff2': true,
}

function send(res: ServerResponse, file: string, ext: string): void {
  const headers: Record<string, string> = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  }
  if (COMPRESSIBLE[ext] !== true) {
    res.writeHead(200, headers)
    createReadStream(file).pipe(res)
    return
  }
  const accept = String(res.req.headers['accept-encoding'] ?? '')
  if (/\bbr\b/u.test(accept)) {
    res.writeHead(200, { ...headers, 'content-encoding': 'br', vary: 'accept-encoding' })
    createReadStream(file).pipe(createBrotliCompress()).pipe(res)
    return
  }
  if (/\bgzip\b/u.test(accept)) {
    res.writeHead(200, { ...headers, 'content-encoding': 'gzip', vary: 'accept-encoding' })
    createReadStream(file).pipe(createGzip()).pipe(res)
    return
  }
  res.writeHead(200, headers)
  createReadStream(file).pipe(res)
}

export function repoRoot(): string {
  return resolve(here, '../..')
}

export function distDir(): string {
  return join(repoRoot(), 'dist')
}

/** The scenarios that need a document the served config points elsewhere. */
export const MISSING_DOC = '/testdocs/definitely-not-deployed.md'
export const STRANGER_PREFIX = '/node_modules/'

/**
 * The analytics script's path, and the body the harness answers it with.
 *
 * Exported so `analytics.spec.ts` asserts against the same constant the host
 * serves, rather than a second copy of the string in a test — a test that
 * hardcodes the URL it expects is a test that passes when the app changes both
 * halves together and breaks when only one does.
 */
export const ANALYTICS_SCRIPT = '/_vercel/insights/script.js'
export const ANALYTICS_STUB = [
  '// Served by the harness, not by the app.',
  '// On Vercel this path is answered by the platform; see startServer().',
  '',
].join('\n')

/**
 * Start the host. One per test run, shared by every worker.
 *
 * `root` is a parameter rather than a hardcoded `distDir()` because M4.6b
 * profiles an **unminified** build: a minified entry names its functions `mk`,
 * `Ol`, `lC`, so a profile of it cannot say what is costing 330ms, only that
 * something called `mk` is. The same host serves both roots — one static-host
 * implementation, two directories — because a profiler that served the app from
 * a different kind of server would be measuring a different app.
 */
export async function startServer(port = PREVIEW_PORT, root = distDir()): Promise<Server> {
  const server = createServer((req, res) => {
    const url = req.url ?? '/'
    const requested = decodeURIComponent(url.split('?')[0] as string)

    // The test control plane. Deliberately not a file path: it is a switch for
    // the harness, not content.
    if (requested === SET_DOC_PATH) {
      const wanted = new URL(url, 'http://localhost').searchParams.get('docPath')
      if (wanted === null) {
        res.writeHead(400).end('docPath is required')
        return
      }
      servedDocPath = wanted
      res.writeHead(200, { 'content-type': 'text/plain' }).end(wanted)
      return
    }

    // The config the app fetches at boot, resolved per scenario so the real
    // fetch path is exercised end to end.
    //
    // `no-store` is not decoration: without it Chromium serves scenario 2's
    // document to scenario 3 from its HTTP cache, and the whole file passes or
    // fails for reasons that have nothing to do with the app.
    if (requested === '/unfold.config.json') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ docPath: servedDocPath }))
      return
    }

    /**
     * The analytics endpoint, stubbed.
     *
     * On Vercel, `/_vercel/insights/script.js` is served by the **platform** —
     * it is not a file in this repository and never was. Everywhere else it
     * 404s, and a 404 is a console error in Chromium, which means every scenario
     * that asserts a quiet console would fail on a request the app is behaving
     * correctly in making. The alternative — teaching the console watcher to
     * ignore one URL — would trade a real signal for a convenience, and the next
     * genuine 404 would hide behind it.
     *
     * So the harness answers the request the way the host would, with an empty
     * script. What is being tested is the app's behaviour, not the platform's
     * analytics implementation; and the request itself remains observable, which
     * is what lets `analytics.spec.ts` assert that the script is fetched (and
     * only in production mode).
     */
    if (requested === ANALYTICS_SCRIPT) {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' })
      res.end(ANALYTICS_STUB)
      return
    }

    const file = normalize(join(root, requested))
    // Refuse to serve anything outside the root. A static host that does not
    // is a vulnerability, and a test host that does not is a trap.
    if (!resolve(file).startsWith(resolve(root) + sep) && resolve(file) !== resolve(root)) {
      res.writeHead(403).end()
      return
    }

    if (!existsSync(file) || statSync(file).isDirectory()) {
      const outside = join(repoRoot(), requested)
      if (
        (requested.startsWith(STRANGER_PREFIX) || requested.startsWith('/testdocs/')) &&
        existsSync(outside) &&
        !statSync(outside).isDirectory()
      ) {
        send(res, outside, extname(outside))
        return
      }
      // SPA fallback, like every static host: a miss is answered with the shell.
      res.writeHead(200, { 'content-type': 'text/html' }).end(readFileSync(join(root, 'index.html')))
      return
    }

    send(res, file, extname(file))
  })

  await new Promise<void>((done) => server.listen(port, '127.0.0.1', done))
  return server
}