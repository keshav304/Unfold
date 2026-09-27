/**
 * M2.PW1 — build once, serve `dist/`, share the server with every worker.
 *
 * The build runs here rather than per test file because it is by far the slowest
 * thing in the suite, and the artifact under test is the *served* build — a dev
 * server would prove nothing about what ships.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { distDir, repoRoot } from './server'
import { start } from './lifecycle'

export default async function globalSetup(): Promise<void> {
  if (!existsSync(join(distDir(), 'index.html'))) {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot(), stdio: 'ignore' })
  }
  await start()
}
