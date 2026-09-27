/**
 * DEV-ONLY swatch page (P0.2). Disposable scaffolding: not product UI, not part
 * of the reader. It enumerates every custom property declared by
 * `src/styles/tokens.css` and renders it, so the token table can be eyeballed
 * against spec §5.2. Run with `npm run dev` and open `/swatch.html`.
 */
import '../styles/fonts.css'
import '../styles/tokens.css'
import '../styles/app.css'

const GROUPS: Record<string, string[]> = {
  'Canvas & surfaces': ['--canvas', '--surface-1', '--surface-2', '--surface-interactive'],
  Borders: ['--border-muted', '--border-strong', '--border-focus'],
  Accents: ['--primary', '--secondary', '--tertiary', '--accent-wash', '--active-line', '--grid-line'],
  Status: ['--error', '--error-text'],
  Text: ['--text-high', '--text-secondary', '--text-muted', '--text-subtle', '--code-surface'],
  Radii: ['--radius-sm', '--radius-base', '--radius-md', '--radius-lg', '--radius-xl', '--radius-full'],
  Elevation: ['--elevation-1', '--elevation-2', '--elevation-3', '--elevation-inner', '--elevation-glow'],
  'Backdrop & focus': ['--backdrop-blur', '--backdrop-canvas', '--focus-ring'],
  Spacing: ['--space-2xs', '--space-xs', '--space-sm', '--space-md', '--space-lg', '--space-xl', '--space-2xl', '--space-3xl'],
  Layout: ['--grid-pitch', '--gutter', '--gutter-mobile', '--margin', '--margin-mobile', '--nav-rail-width', '--inspector-width', '--code-header-height', '--line-number-width', '--reading-column'],
  Motion: ['--motion-fast', '--motion-base', '--motion-slow', '--motion-reveal'],
}

/** Every custom property declared on `:root` — catches tokens not listed above. */
function allTokens(): string[] {
  const found = new Set<string>()
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue
      if (!(rule.selectorText ?? '').includes(':root')) continue
      for (const prop of Array.from(rule.style)) found.add(prop)
    }
  }
  return Array.from(found).sort()
}

function value(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function swatch(name: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 't-body-sm'
  el.style.padding = '12px'
  el.style.border = '1px solid var(--border-muted)'
  el.style.borderRadius = 'var(--radius-base)'
  el.style.background = 'var(--surface-1)'

  const chip = document.createElement('div')
  chip.style.height = '44px'
  chip.style.borderRadius = 'var(--radius-sm)'
  chip.style.background = `var(${name})`
  chip.style.border = '1px solid var(--border-strong)'

  const label = document.createElement('div')
  label.className = 't-code-sm'
  label.style.color = 'var(--text-muted)'
  label.style.marginTop = '8px'
  label.textContent = name

  const val = document.createElement('div')
  val.className = 't-code-sm tnum'
  val.style.color = 'var(--text-subtle)'
  val.textContent = value(name)

  el.append(chip, label, val)
  return el
}

function heading(text: string): HTMLElement {
  const el = document.createElement('h2')
  el.className = 't-headline-md'
  el.style.color = 'var(--text-high)'
  el.style.margin = '32px 0 12px'
  el.textContent = text
  return el
}

function render(): void {
  const root = document.getElementById('root')
  if (!root) return
  const known = new Set(Object.values(GROUPS).flat())
  const extra = allTokens().filter((t) => !known.has(t))

  const page = document.createElement('main')
  page.style.maxWidth = '1100px'
  page.style.margin = '0 auto'
  page.style.padding = '32px'

  const title = document.createElement('h1')
  title.className = 't-display-lg'
  title.style.color = 'var(--text-high)'
  title.textContent = 'Unfold tokens'
  page.append(title)

  const note = document.createElement('p')
  note.className = 't-body-lg'
  note.textContent =
    'Dev swatch page. Values are read from the live :root scope of src/styles/tokens.css.'
  page.append(note)

  for (const [group, names] of Object.entries(GROUPS)) {
    page.append(heading(group))
    const grid = document.createElement('div')
    grid.style.display = 'grid'
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(180px, 1fr))'
    grid.style.gap = '12px'
    for (const name of names) grid.append(swatch(name))
    page.append(grid)
  }

  page.append(heading('Other tokens (auto-discovered)'))
  const other = document.createElement('div')
  other.style.display = 'grid'
  other.style.gridTemplateColumns = 'repeat(auto-fill, minmax(180px, 1fr))'
  other.style.gap = '12px'
  for (const name of extra) other.append(swatch(name))
  page.append(other)

  page.append(heading('Type scale'))
  const type = document.createElement('div')
  type.style.display = 'grid'
  type.style.gap = '16px'
  for (const cls of [
    't-display-lg',
    't-headline-xl',
    't-headline-lg',
    't-headline-md',
    't-headline-sm',
    't-body-lg',
    't-body-md',
    't-body-sm',
    't-code-lg',
    't-code-md',
    't-code-sm',
    't-label-caps',
  ]) {
    const line = document.createElement('div')
    line.className = cls
    line.style.color = 'var(--text-secondary)'
    line.textContent = `${cls} — the quick brown fox 0123456789`
    type.append(line)
  }
  page.append(type)

  root.append(page)
}

render()
