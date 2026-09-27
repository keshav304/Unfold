/**
 * Metro-map table of contents (spec §7.3). A vertical rail with a glowing dot
 * per H2 and a tick per H3, a fill that tracks the active section, and a
 * now-reading chip. **Zero H2s means no rail at all** — the rail is hidden, not
 * empty (§7.3).
 */

import { useEffect } from 'react'
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
  /**
   * M4.2: Esc closes the drawer, on the document rather than on the `<nav>`.
   *
   * §9 requires Esc for the palette and the drawer, and the palette has had it
   * since M2 while the drawer had nothing. That was survivable at 260px on a
   * 375px screen, where a strip of scrim was left to tap; M4.2's full-width
   * drawer removed that strip, which turned an omission into a trap — a
   * full-screen overlay with no keyboard exit.
   *
   * The listener is on `document` because focus is still on the menu button that
   * opened the drawer: a handler bound to the `<nav>` would never see the key.
   * The *focus trap* and the focus *restore* are still M4.3's — this is only the
   * one key that makes the drawer escapable at all.
   *
   * Above the `sections.length === 0` early return, deliberately: a hook after a
   * conditional return is a hook that sometimes does not run, and the component
   * that has no sections is the one where "sometimes" would be hardest to see.
   */
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

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
        // M4.2: the drawer's own close button and its links close it; the Escape
        // key is handled on the document below, because focus is still on the
        // menu button that opened the drawer, and a keydown bound to this <nav>
        // would never see it.
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
