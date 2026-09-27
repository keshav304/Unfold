/**
 * Metro-map table of contents (spec §7.3). A vertical rail with a glowing dot
 * per H2 and a tick per H3, a fill that tracks the active section, and a
 * now-reading chip. **Zero H2s means no rail at all** — the rail is hidden, not
 * empty (§7.3).
 */

import type { Doc } from '../../pipeline/types'
import { navigate } from '../navigate'

export type TocProps = {
  doc: Doc
  active: string | null
  onNavigate: (slug: string) => void
  /** Rendered as a drawer below 1280px. */
  open: boolean
  onClose: () => void
}

export function Toc({ doc, active, onNavigate, open, onClose }: TocProps): JSX.Element | null {
  if (doc.sections.length === 0) return null

  const activeIndex = Math.max(
    0,
    doc.sections.findIndex((section) => section.slug === active),
  )
  const fill = doc.sections.length === 1 ? 100 : (activeIndex / (doc.sections.length - 1)) * 100
  const current = doc.sections[activeIndex]

  return (
    <>
      {open ? <div className="toc-scrim" onClick={onClose} aria-hidden="true" /> : null}
      <nav
        className="toc"
        data-open={open ? 'true' : 'false'}
        aria-label="Table of contents"
        id="toc"
      >
        <div className="toc-head">
          <span className="t-label-caps toc-head__label">Contents</span>
          <button type="button" className="toc-close" onClick={onClose} aria-label="Close contents">
            ✕
          </button>
        </div>

        <div className="toc-rail" style={{ ['--toc-fill' as string]: `${fill}%` }}>
          {doc.sections.map((section) => {
            const isActive = section.slug === active
            return (
              <div key={section.slug} className="toc-node" data-active={isActive ? 'true' : 'false'}>
                <button
                  type="button"
                  className="toc-link"
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => {
                    navigate(section.slug, onNavigate)
                    onClose()
                  }}
                >
                  <span className="toc-dot" aria-hidden="true" />
                  <span className="toc-title">{section.title}</span>
                </button>
                {section.children.length > 0 ? (
                  <ul className="toc-children">
                    {section.children.map((child) => (
                      <li key={child.slug}>
                        <button
                          type="button"
                          className="toc-child"
                          aria-current={child.slug === active ? 'true' : undefined}
                          onClick={() => {
                            navigate(child.slug, onNavigate)
                            onClose()
                          }}
                        >
                          {child.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )
          })}
        </div>

        {current !== undefined ? (
          <div className="toc-now-reading" aria-live="polite">
            <span className="t-label-caps">Now reading</span>
            <span className="toc-now-reading__title">{current.title}</span>
          </div>
        ) : null}
      </nav>
    </>
  )
}
