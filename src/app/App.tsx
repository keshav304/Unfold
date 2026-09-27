/**
 * The app shell (spec §7.1). Header, nav rail, reading column, and the chrome
 * that belongs to none of them: progress bar and back-to-top (§7.10).
 *
 * The rule this component exists to enforce: **the view switcher renders only
 * when the document is capable of the view** (§1.1). For a document with no
 * capabilities there is no switcher at all, not a disabled one.
 */

import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import type { UnfoldConfig } from '../pipeline/config'
import { flattenSections } from '../pipeline/indexes'
import { DropScreen, ErrorCard } from './components/DropScreen'
import { Hero } from './components/Hero'
import { Toc } from './components/Toc'
import { Palette, isPaletteShortcut, isTypingTarget } from './palette/Palette'
import { Reader } from './views/Reader'
import { Stepper, clampStep } from './stepper/Stepper'
import { hashFor, parseHash, resolveRoute, stepperHash, type Route, type ViewName } from './routing'
import { scrollToSlug } from './navigate'
import { useDocument } from './useDocument'
import { useScrollProgress } from './useScrollProgress'
import { useScrollSpy } from './useScrollSpy'
import { useReadingMode } from './modes/useReadingMode'

/**
 * The graph view is a lazy chunk and nothing else may import it statically
 * (§10, M3.1). `budget.test.ts` reads the built entry chunk and fails if
 * `xyflow` appears in it, so this is the one line that has to stay a `lazy()`.
 */
const GraphView = lazy(() => import('./graph/GraphView'))

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
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const { progress, past } = useScrollProgress()
  /**
   * §7.8. Owned by the shell rather than by the reader, because three things
   * need it and two of them are not the reader: the header toggle, the palette
   * row, and the reader itself. One owner means the persisted value and the
   * rendered mode can never disagree.
   */
  const reading = useReadingMode()

  /* ---------------- palette triggers and focus restore (M2.2) ------------- */

  /**
   * §9: focus is restored on close. The element focused when the palette opened
   * is remembered, so a click on the header button returns focus to that button
   * and a `⌘K` from the middle of the page returns focus to wherever the reader
   * actually was. Restoring to `body` unconditionally would silently break the
   * second case, which is the common one.
   */
  const restoreFocusTo = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)

  const openPalette = useCallback(() => {
    restoreFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setPaletteOpen(true)
  }, [])

  const closePalette = useCallback(() => setPaletteOpen(false), [])

  // Restoring after the commit that unmounts the palette, rather than inside
  // the close handler: the trigger must be focusable by then.
  useEffect(() => {
    if (wasOpen.current && !paletteOpen) {
      restoreFocusTo.current?.focus()
      restoreFocusTo.current = null
    }
    wasOpen.current = paletteOpen
  }, [paletteOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // §7.4: ⌘K / Ctrl+K, and `/`. The `/` is inert inside a text field — a
      // reader typing a path into a box must get a slash, not a palette.
      const slash = event.key === '/' && !isTypingTarget(event.target)
      if (!isPaletteShortcut(event) && !slash) return
      event.preventDefault()
      openPalette()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [openPalette])

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

  /* ---------------- stepper step (M3.6) ---------------- */

  const stepCount = doc?.steps?.length ?? 0
  /**
   * The step the route names, clamped to the document's real range.
   *
   * Clamping rather than rejecting is deliberate: a deep link to a step this
   * document does not have is a stale link, and the reader should land on the
   * nearest real step rather than on an error or a blank view (§1.3).
   */
  const requestedStep = active.name === 'stepper' ? active.step : undefined
  const step = clampStep(requestedStep ?? 1, stepCount)

  /**
   * The stepper owns the step, the shell owns the hash — the same split the
   * palette has for results. `hashFor` is written here because the URL is the
   * deep link (§7.7): a reader who is on step 3 can copy the address bar.
   */
  const setStep = useCallback(
    (next: number) => {
      const clamped = clampStep(next, stepCount)
      setRoute({ name: 'stepper', step: clamped })
      if (typeof window !== 'undefined') window.location.hash = stepperHash(clamped)
    },
    [stepCount],
  )

  /* ---------------- the <768px segmented control (M3.5) ---------------- */

  /*
   * The narrow-screen control does **not** hold its own state. An earlier
   * version kept a `mobilePane` alongside the route, on the reasoning that a pane
   * switch is presentation and not navigation — which was wrong, and wrong in a
   * way the browser found: the "Docs" button set the pane but the reader was not
   * rendered, because the route still said graph. Two sources of truth for one
   * fact, and the second one silently won.
   *
   * The pane *is* a different view, so it gets a different route. One owner of
   * the URL, the back button walks the panes, and a reader who copies the address
   * bar gets the pane they were looking at. The `visible` flag the graph view
   * still receives is derived from the route, so a resize across 768px cannot
   * leave the canvas hidden at desktop width.
   */
  const graphVisible = active.name === 'graph'

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

        {/*
          M3.5: the <768px segmented tabs — **Docs / Visual Graph, and no Metrics
          tab**. The old DESIGN.md mention of a Metrics pane was explicitly
          dropped (§5.3): there is no metrics view in v1, and a tab that leads
          nowhere is dead UI.

          These are *pane switches, not tabs*, and deliberately not a `tablist`.
          A real tab must own a `tabpanel`, and the element it switches is
          `<main>` — giving that a `tabpanel` role would strip the `main`
          landmark §9 requires, and axe would rightly complain about the
          mismatch. So this is a button group with `aria-pressed`, which says
          exactly what is true: two ways to show one region, neither of which
          navigates.

          Only the graph control is capability-gated, and a document that cannot
          render a graph gets Docs alone — the same rule the header switcher
          follows. The group is hidden by CSS above 768px, where the workbench
          shows both zones at once: a narrow-screen affordance, not a second
          navigation model.

          Each button navigates rather than flipping local state, because each
          one *is* a different view. That is what makes the back button and the
          address bar agree with what is on screen.
        */}
        {doc.capabilities.graph ? (
          <div className="workbench-tabs" role="group" aria-label="Workbench pane">
            <button
              type="button"
              className="workbench-tab t-label-caps"
              aria-pressed={!graphVisible}
              onClick={() => goTo('reader')}
            >
              Docs
            </button>
            <button
              type="button"
              className="workbench-tab t-label-caps"
              aria-pressed={graphVisible}
              onClick={() => goTo('graph')}
            >
              Visual Graph
            </button>
          </div>
        ) : null}

        {/*
          The reading-mode toggle (spec §7.1 lists it in the header, §7.8 defines
          it). It is a **toggle button, not a segmented control**, and the reason
          is the header row it has to fit in: at 375px the title, the search
          trigger and the pane switch already share one 32px-tall row, and the
          M3 screenshot showed what a third control does to that row.

          `aria-pressed` is the whole state, and the visible text is deliberately
          the *thing* rather than the *action* — "Executive" with a pressed
          state, not "Switch to reference mode". A label that changes with the
          state cannot be read by a screen-reader user as a toggle at all, and
          this is the control most likely to be operated by someone who cannot
          see its colour. The three palette rows below it, which are the
          discoverable place, carry the full sentence.
        */}
        <button
          type="button"
          className="mode-toggle t-label-caps"
          aria-pressed={reading.mode === 'executive'}
          // Stated explicitly rather than borrowed from the text inside, for the
          // same reason the search trigger names itself: a name that lives in a
          // child is a name a stylesheet can take away. "Executive mode" also
          // satisfies WCAG 2.5.3 — the visible word "Executive" is contained in
          // it, so a voice-control user saying what they can see still matches.
          aria-label="Executive mode"
          onClick={reading.toggle}
          title={
            reading.mode === 'executive'
              ? 'Executive mode: each section shows its summary. Switch to the full reference view.'
              : 'Reference mode: the whole document. Switch to the executive summary.'
          }
        >
          Executive
        </button>

        {/*
          The palette trigger (spec §7.4). It is the *primary* way in, so it is
          focusable and labelled — and it is the element focus returns to when
          the palette closes (see `restoreFocusTo`).
        */}
        <button
          type="button"
          className="app-search t-code-sm"
          onClick={openPalette}
          aria-haspopup="dialog"
          aria-expanded={paletteOpen}
          // The name is on the button, not only in it. At <768px the word
          // "Search" and the `⌘K` hint are `display: none` so the header row
          // fits (M4.2's collapse order), and `display: none` removes content
          // from the accessibility tree — so a label that lived only in a child
          // span disappeared with it and the button became nameless. Lighthouse
          // caught this because it audits at a mobile viewport by default, which
          // is the one place the bug exists. The glyph beside the label is
          // `aria-hidden`, so this is the whole name, and it matches the visible
          // word on every width where that word is shown.
          aria-label="Search"
        >
          <span aria-hidden="true">⌕</span>
          <span className="app-search__label">Search</span>
          <kbd className="app-search__kbd t-code-sm" aria-hidden="true">
            ⌘K
          </kbd>
        </button>

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
      <div
        className="app-body"
        data-rail={doc.sections.length > 0 ? 'true' : 'false'}
        // Which pane is on show (M3.5). The attribute is what the stylesheet keys
        // the "hide the other pane" rule on.
        data-pane={graphVisible ? 'graph' : 'docs'}
      >
        <Toc
          doc={doc}
          active={activeSlug}
          onNavigate={onNavigate}
          open={tocOpen}
          onClose={() => setTocOpen(false)}
        />

        <main className="app-main" id="main">
          {/*
            M3.5 workbench. The three zones are grid columns, not conditional
            wrappers, so opening the inspector never reflows the canvas — the
            canvas keeps its measured width and React Flow's viewport stays where
            the reader left it. The panel column is reserved at every width
            (`--inspector-width` on desktop, 50% on tablet) and the panel
            animates *inside* it.
          */}
          {active.name === 'reader' ? (
            <>
              <a className="skip-link" href="#main">
                Skip to content
              </a>
              <Hero doc={doc} onNavigate={onNavigate} />
              <Reader
                doc={doc}
                slugs={slugs}
                onNavigate={onNavigate}
                flash={flash}
                descriptions={config.descriptions}
                fileExtensions={config.fileExtensions}
                mode={reading.mode}
                isExpanded={reading.isExpanded}
                onToggleSection={reading.toggleSection}
              />
            </>
          ) : null}

          {active.name === 'graph' ? (
            <Suspense
              fallback={
                <div className="view-boot" role="status" aria-live="polite">
                  <span className="t-label-caps">Loading graph</span>
                </div>
              }
            >
              <GraphView
                doc={doc}
                slugs={slugs}
                onNavigate={onNavigate}
                descriptions={config.descriptions}
                fileExtensions={config.fileExtensions}
                visible={graphVisible}
              />
            </Suspense>
          ) : null}

          {active.name === 'stepper' ? (
            <Stepper steps={doc.steps ?? []} step={step} onStepChange={setStep} onNavigate={onNavigate} />
          ) : null}
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

      {/*
        The palette renders last so its overlay sits above the reader, and only
        while open — an always-mounted palette would put a hidden combobox in the
        tab order and in every accessibility scan.
      */}
      {paletteOpen ? (
        <Palette
          doc={doc}
          open
          onOpenChange={closePalette}
          onNavigate={onNavigate}
          activeView={active.name}
          onGoToView={goTo}
          readingMode={reading.mode}
          onSetReadingMode={reading.setMode}
        />
      ) : null}
    </div>
  )
}
