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
import { createServer, type Server } from 'node:http'
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

export function repoRoot(): string {
  return resolve(here, '../..')
}

export function distDir(): string {
  return join(repoRoot(), 'dist')
}

/** The scenarios that need a document the served config points elsewhere. */
export const MISSING_DOC = '/testdocs/definitely-not-deployed.md'
export const STRANGER_PREFIX = '/node_modules/'

/** Start the host. One per test run, shared by every worker. */
export async function startServer(port = PREVIEW_PORT): Promise<Server> {
  const root = distDir()
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
        res.writeHead(200, {
          'content-type': MIME[extname(outside)] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        })
        createReadStream(outside).pipe(res)
        return
      }
      // SPA fallback, like every static host: a miss is answered with the shell.
      res.writeHead(200, { 'content-type': 'text/html' }).end(readFileSync(join(root, 'index.html')))
      return
    }

    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    createReadStream(file).pipe(res)
  })

  await new Promise<void>((done) => server.listen(port, '127.0.0.1', done))
  return server
}