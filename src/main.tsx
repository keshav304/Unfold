// P0.1 entry point. Intentionally renders nothing: the reader UI arrives in M1,
// and this milestone ships the content pipeline only (spec §6).
import './styles/tokens.css'
import './styles/app.css'

const root = document.getElementById('root')
if (root) root.dataset.appBootstrapped = 'true'
