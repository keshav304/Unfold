/**
 * M2.PW1 — build once, serve `dist/`, share the server with every worker.
 *
 * The build runs here rather than per test file because it is the slowest thing
 * in the suite by an order of magnitude, and the artifact under test is the
 * *served* build — a dev server would prove nothing about what ships.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { PREVIEW_PORT } from '../../playwright.config'
import { distDir, repoRoot, startServer } from './server'

let server: Awaited<ReturnType<typeof startServer>> | null = null

export default async function globalSetup(): Promise<void> {
  if (!existsSync(join(distDir(), 'index.html'))) {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot(), stdio: 'ignore' })
  }
  server = await startServer(PREVIEW_PORT)
  return async () => {
    // Closing the server is the teardown; without it the run hangs.
    await new Promise<void>((done) => server?.close(() => done()) ?? done())
    server = null
  }
}