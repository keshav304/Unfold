/**
 * The app shell (spec §7.1). Header, nav rail, reading column, and the chrome
 * that belongs to none of them: progress bar and back-to-top (§7.10).
 *
 * The rule this component exists to enforce: **the view switcher renders only
 * when the document is capable of the view** (§1.1). For a document with no
 * capabilities there is no switcher at all, not a disabled one.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { UnfoldConfig } from '../pipeline/config'
import { flattenSections } from '../pipeline/indexes'
import { DropScreen, ErrorCard } from './components/DropScreen'
import { Hero } from './components/Hero'
import { Toc } from './components/Toc'
import { Reader } from './views/Reader'
import { hashFor, parseHash, resolveRoute, type Route, type ViewName } from './routing'
import { scrollToSlug } from './navigate'
import { useDocument } from './useDocument'
import { useScrollProgress } from './useScrollProgress'
import { useScrollSpy } from './useScrollSpy'

const VIEW_LABEL: Record<ViewName, string> = {
  reader: 'Reader',
  graph: 'Graph',
  stepper: 'Stepper',
}

export type AppProps = {
  config: UnfoldConfig
  /** Injected in tests; defaults to the real `fetch`. */
  fetcher?: typeof fetch
}

export function App({ config, fetcher }: AppProps): JSX.Element {
  const state = useDocument(config, fetcher ?? fetch)
  const [route, setRoute] = useState<Route>(() =>
    parseHash(typeof window === 'undefined' ? '' : window.location.hash),
  )
  const [tocOpen, setTocOpen] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const { progress, past } = useScrollProgress()

  /* ---------------- hash routing (M1.1) ---------------- */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onHashChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const doc = state.status === 'ready' ? state.doc : undefined

  const slugs = useMemo(
    () => (doc === undefined ? new Set<string>() : new Set(flattenSections(doc.sections).map((s) => s.slug))),
    [doc],
  )

  /** Capability-gated: an incapable route silently becomes the reader (§1.3). */
  const active = doc === undefined ? route : resolveRoute(route, doc.capabilities)

  const onNavigate = useCallback((slug: string) => {
    setFlash(slug)
    window.setTimeout(() => setFlash((current) => (current === slug ? null : current)), 1200)
    // Let the hash change land before scrolling to the new target.
    window.setTimeout(() => scrollToSlug(slug), 0)
  }, [])

  const goTo = useCallback((view: ViewName) => {
    const next: Route = view === 'reader' ? { name: 'reader' } : { name: view }
    if (typeof window !== 'undefined') window.location.hash = hashFor(next)
    setRoute(next)
  }, [])

  const h2Slugs = useMemo(
    () => (doc === undefined ? [] : doc.sections.map((section) => section.slug)),
    [doc],
  )
  const activeSlug = useScrollSpy(h2Slugs)

  if (state.status === 'loading') {
    return (
      <div className="boot" role="status" aria-live="polite">
        <span className="t-label-caps">Loading</span>
      </div>
    )
  }

  if (state.status === 'drop') {
    return <DropScreen message={state.message} onFile={state.loadText} onRetry={state.reload} />
  }

  if (state.status === 'error' || doc === undefined) {
    return (
      <ErrorCard
        message={state.status === 'error' ? state.message : 'Unknown failure.'}
        onRetry={state.reload}
      />
    )
  }

  const views: ViewName[] = ['reader']
  if (doc.capabilities.graph) views.push('graph')
  if (doc.capabilities.stepper) views.push('stepper')

  return (
    <div className="app" data-view={active.name}>
      <div className="progress-bar" style={{ ['--progress' as string]: `${progress * 100}%` }} aria-hidden="true" />

      <header className="app-header">
        <button
          type="button"
          className="app-menu"
          aria-label="Open contents"
          aria-expanded={tocOpen}
          aria-controls="toc"
          onClick={() => setTocOpen((open) => !open)}
        >
          ☰
        </button>

        <span className="app-title t-headline-sm" title={doc.title}>
          {doc.title}
        </span>

        <div className="app-header__spacer" />

        {/* Capability-gated (§1.1). Absent, not disabled. */}
        {views.length > 1 ? (
          <nav className="view-switcher" aria-label="View">
            {views.map((view) => (
              <button
                key={view}
                type="button"
                className="view-switcher__item t-label-caps"
                aria-current={active.name === view ? 'page' : undefined}
                onClick={() => goTo(view)}
              >
                {VIEW_LABEL[view]}
              </button>
            ))}
          </nav>
        ) : null}
      </header>

      {/*
        The rail is absent whenever the document has no H2s (§7.3). The grid
        must collapse with it, or the content falls into the 260px rail column
        and the main area stays empty.
      */}
      <div className="app-body" data-rail={doc.sections.length > 0 ? 'true' : 'false'}>
        <Toc
          doc={doc}
          active={activeSlug}
          onNavigate={onNavigate}
          open={tocOpen}
          onClose={() => setTocOpen(false)}
        />

        <main className="app-main" id="main">
          {active.name === 'reader' ? (
            <>
              <a className="skip-link" href="#main">
                Skip to content
              </a>
              <Hero doc={doc} onNavigate={onNavigate} />
              <Reader doc={doc} slugs={slugs} onNavigate={onNavigate} flash={flash} />
            </>
          ) : (
            // M3 owns these views. Until then the route is real and the view is
            // honest about not existing yet: a message, never a blank screen.
            <div className="app-placeholder elev-1">
              <h2 className="t-headline-md">{VIEW_LABEL[active.name]} view</h2>
              <p className="t-body-md">
                This document is capable of a {VIEW_LABEL[active.name].toLowerCase()} view. The view itself
                arrives in a later milestone.
              </p>
            </div>
          )}
        </main>
      </div>

      {past ? (
        <button
          type="button"
          className="back-to-top t-code-sm"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          ↑ Top
        </button>
      ) : null}
    </div>
  )
}
