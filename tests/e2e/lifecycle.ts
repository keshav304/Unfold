/**
 * The test host's lifetime, shared by global setup and global teardown.
 *
 * Playwright 1.61 runs those as two entry points (a `globalSetup` that returns
 * a teardown function was the old API), but in one process, so a module-level
 * handle is how the server survives between them.
 */

import type { Server } from 'node:http'
import { PREVIEW_PORT, startServer } from './server'

let server: Server | null = null

export async function start(): Promise<void> {
  if (server !== null) return
  server = await startServer(PREVIEW_PORT)
}

/**
 * Close the host, and do not wait politely for the browser to hang up.
 *
 * `server.close()` alone resolves only once every connection is idle-closed, and
 * a headless Chrome that just audited the site holds keep-alives open for
 * seconds. `closeAllConnections()` is what makes teardown prompt; without it the
 * step looks like a hang rather than a slow close.
 */
export async function stop(): Promise<void> {
  const running = server
  server = null
  if (running === null) return
  running.closeAllConnections()
  await new Promise<void>((done) => {
    running.close(() => done())
  })
}
