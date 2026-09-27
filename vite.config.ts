import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const CONFIG_FILE = 'unfold.config.json'

/**
 * `unfold.config.json` lives at the repo root (§1.4) but has to be fetchable by
 * the app. Copy it into the build output and serve it in dev, so the root file
 * stays the single source of truth instead of being duplicated under `public/`.
 */
function serveRootConfig(): Plugin {
  return {
    name: 'unfold:serve-root-config',
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
      if (existsSync(CONFIG_FILE)) copyFileSync(CONFIG_FILE, resolve('dist', CONFIG_FILE))
    },
  }
}

// P0.1 scaffold + the M1 reader. `index.html` mounts the shell; the pipeline in
// src/pipeline is what turns markdown into anything renderable.
export default defineConfig({
  plugins: [react(), serveRootConfig()],
  build: { outDir: 'dist', sourcemap: false },
})
