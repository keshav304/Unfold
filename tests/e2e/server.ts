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
import { extname, join, normalize, resolve, sep } from 'node:path'
import { PREVIEW_PORT } from '../../playwright.config'

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

/** Which document the served config advertises; swapped per scenario. */
let servedDocPath = '/testdocs/kitchen-sink.md'

export function setServedDocPath(path: string): void {
  servedDocPath = path
}

export function repoRoot(): string {
  return resolve(import.meta.dirname, '../..')
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
    const requested = decodeURIComponent((req.url ?? '/').split('?')[0] as string)

    // The config the app fetches at boot, resolved per scenario so the real
    // fetch path is exercised end to end.
    if (requested === '/unfold.config.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
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
        res.writeHead(200, { 'content-type': MIME[extname(outside)] ?? 'application/octet-stream' })
        createReadStream(outside).pipe(res)
        return
      }
      // SPA fallback, like every static host: a miss is answered with the shell.
      res.writeHead(200, { 'content-type': 'text/html' }).end(readFileSync(join(root, 'index.html')))
      return
    }

    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  })

  await new Promise<void>((done) => server.listen(port, '127.0.0.1', done))
  return server
}