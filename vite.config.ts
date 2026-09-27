import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const CONFIG_FILE = 'unfold.config.json'
/** The bundled documents. `testdocs/` is the source of truth; this is the
 *  directory the build ships them to, keeping the same relative `docPath`. */
const DOCS_DIR = 'testdocs'

/**
 * Static-host essentials, kept in one plugin because they are the same idea:
 * the deployable unit is not just `dist/assets` — it is the built app **plus the
 * documents it was configured to read**.
 *
 * 1. `unfold.config.json` lives at the repo root (§1.4) but has to be
 *    fetchable, so it is served in dev and copied into the build.
 * 2. The configured `docPath` points into `testdocs/`, so `testdocs/` is copied
 *    into `dist/` as well. Without this, a correct `docPath` still 404s (or,
 *    worse, hits the SPA fallback) on a real host.
 */
function shipDeployable(): Plugin {
  return {
    name: 'unfold:ship-deployable',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === `/${CONFIG_FILE}` && existsSync(CONFIG_FILE)) {
          res.setHeader('content-type', 'application/json')
          res.end(readFileSync(CONFIG_FILE))
          return
        }
        next()
      })
    },
    closeBundle() {
      if (!existsSync(CONFIG_FILE)) return
      copyInto(join('dist', CONFIG_FILE), CONFIG_FILE)

      // Only ship documents when the configured docPath actually lives here,
      // so a project with no bundled docs does not gain a stray directory.
      const docPath = configuredDocPath()
      if (docPath !== null && docPath.startsWith(`./${DOCS_DIR}/`) && existsSync(DOCS_DIR)) {
        const target = join('dist', DOCS_DIR)
        rmSync(target, { recursive: true, force: true })
        cpSync(DOCS_DIR, target, { recursive: true })
      }
    },
  }
}

/** Copy one file, creating its parent directory. */
function copyInto(target: string, source: string): void {
  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target)
}

/** The configured document path, or null when the config is absent or invalid. */
function configuredDocPath(): string | null {
  try {
    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as { docPath?: unknown }
    return typeof config.docPath === 'string' ? config.docPath : null
  } catch {
    return null
  }
}

// P0.1 scaffold + the M1 reader. `index.html` mounts the shell; the pipeline in
// src/pipeline is what turns markdown into anything renderable.
export default defineConfig({
  plugins: [react(), shipDeployable()],
  build: { outDir: 'dist', sourcemap: false },
})
