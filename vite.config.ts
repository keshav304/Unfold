import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// P0.1 scaffold. No UI ships in P0/M0: `index.html` mounts an empty root so the
// production build is exercised in CI while the pipeline (M0) is the real work.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
})
