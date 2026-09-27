/**
 * Hero (spec §7.2). Title from the pipeline's fallback chain, description when
 * the document provided one, generic stats, and a jump chip per H2. The stats
 * come from `doc.stats` — nothing here measures the document itself.
 */

import type { Doc } from '../../pipeline/types'
import { navigate } from '../navigate'

export type HeroProps = { doc: Doc; onNavigate: (slug: string) => void }

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

export function Hero({ doc, onNavigate }: HeroProps): JSX.Element | null {
  const jumps = doc.sections
  const minutes = Math.max(1, Math.round(doc.stats.words / 220))

  return (
    <header className="hero grid-canvas">
      <h1 className="hero-title t-display-lg">{doc.title}</h1>
      {doc.description !== undefined ? <p className="hero-description t-body-lg">{doc.description}</p> : null}

      <dl className="hero-stats">
        <div className="hero-stat">
          <dt className="t-label-caps">Read</dt>
          <dd className="t-code-md">{minutes} min</dd>
        </div>
        <div className="hero-stat">
          <dt className="t-label-caps">Sections</dt>
          <dd className="t-code-md">{doc.stats.sections}</dd>
        </div>
        <div className="hero-stat">
          <dt className="t-label-caps">Words</dt>
          <dd className="t-code-md tnum">{doc.stats.words.toLocaleString()}</dd>
        </div>
        {doc.stats.diagrams > 0 ? (
          <div className="hero-stat">
            <dt className="t-label-caps">Diagrams</dt>
            <dd className="t-code-md tnum">{doc.stats.diagrams}</dd>
          </div>
        ) : null}
        {doc.stats.codeBlocks > 0 ? (
          <div className="hero-stat">
            <dt className="t-label-caps">Code</dt>
            <dd className="t-code-md tnum">{doc.stats.codeBlocks}</dd>
          </div>
        ) : null}
      </dl>

      {jumps.length > 0 ? (
        <nav className="hero-jumps" aria-label="Jump to section">
          {jumps.map((section) => (
            <button
              key={section.slug}
              type="button"
              className="hero-jump t-code-sm"
              onClick={() => navigate(section.slug, onNavigate)}
            >
              {section.title}
            </button>
          ))}
        </nav>
      ) : null}

      <span className="visually-hidden">
        {plural(doc.stats.sections, 'section', 'sections')} · {plural(doc.stats.words, 'word', 'words')}
      </span>
    </header>
  )
}
