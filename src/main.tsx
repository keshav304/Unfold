/**
 * App entry. Reads `unfold.config.json` at startup (optional, §1.4) and mounts
 * the shell. Everything else is the pipeline's job.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/app.css'
import './styles/reader.css'
import { App } from './app/App'
import { normalizeConfig } from './pipeline/config'

/** Zero-config must work: a missing or broken config is not a failure. */
async function readConfig(): Promise<string> {
  try {
    const response = await fetch('/unfold.config.json')
    if (!response.ok) return '{}'
    return await response.text()
  } catch {
    return '{}'
  }
}

void readConfig().then((raw) => {
  const config = normalizeConfig(JSON.parse(raw))
  const container = document.getElementById('root')
  if (container === null) return
  createRoot(container).render(
    <StrictMode>
      <App config={config} />
    </StrictMode>,
  )
})
