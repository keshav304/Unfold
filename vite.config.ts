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
    /**
     * M4.6 — preload the config and the document from the built HTML.
     *
     * The app's critical path is `index.html → entry.js → config → document →
     * render`, and the last two steps are two round trips that the *build* can
     * take off it. This plugin is the only place that knows the configured
     * `docPath`, which is exactly why the hint has to be here and not in
     * `index.html`: a document deployed at `./docs/spec.md` needs
     * `<link rel="preload" href="/docs/spec.md">`, and nobody editing the
     * template is going to remember to change it when they change the config.
     *
     * `as="fetch"` + `crossorigin` is the pair `fetch()` actually matches on.
     * A preload without `crossorigin` is fetched in "no-cors" mode, lands in a
     * *different* cache entry, and is then fetched a second time by the real
     * request — so it costs a round trip and saves nothing, which is worse than
     * having no hint at all because it looks like it is working.
     */
    transformIndexHtml() {
      const docPath = configuredDocPath()
      if (docPath === null) return
      const url = docPath.startsWith('./') ? `/${docPath.slice(2)}` : `/${docPath}`
      return [
        {
          tag: 'link',
          attrs: { rel: 'preload', href: `/${CONFIG_FILE}`, as: 'fetch', crossorigin: '' },
          injectTo: 'head-prepend' as const,
        },
        {
          tag: 'link',
          attrs: { rel: 'preload', href: url, as: 'fetch', crossorigin: '' },
          injectTo: 'head-prepend' as const,
        },
      ]
    },
    /**
     * M4.6 — the same two hints, applied to the written HTML.
     *
     * The font preload lives here rather than in `generateBundle` because Vite
     * emits `index.html` from its *own* HTML plugin, and a plugin that runs
     * `generateBundle` first simply does not see the file yet — the first
     * version of this did exactly that and silently emitted nothing, which is
     * the failure mode of a hint whose absence costs nothing until the day it
     * would have helped. `closeBundle` runs after the whole output is on disk,
     * so the file exists and the asset names are final.
     *
     * `as="font"` needs `crossorigin` for the same reason `as="fetch"` does:
     * fonts are always fetched in CORS mode, and a preload without the
     * attribute is fetched in no-cors mode, lands in a different cache entry,
     * and is then fetched *again* by the real request — a whole second download
     * of every typeface, caused by a hint that looks like it is working.
     *
     * Only the `latin` subsets. The stylesheet declares cyrillic, greek and
     * vietnamese faces too, and hinting all of them would put four extra
     * requests on every page load for readers whose text is in English. The
     * others are still declared and still load; they load when they are needed.
     */
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
