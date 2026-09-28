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
import { Analytics } from '@vercel/analytics/react'
import { Reader } from './views/Reader'
import { Welcome } from './views/Welcome'

/** sessionStorage key: a document has been opened in this tab (M4.12). */
const UNFOLD_OPENED_KEY = 'unfold:opened'
import { Stepper, clampStep } from './stepper/Stepper'
import { hashFor, parseHash, resolveRoute, stepperHash, WELCOME_HASH, type Route, type ViewName } from './routing'
import { scrollToSlug } from './navigate'
import { useDocument } from './useDocument'
import { useScrollProgress } from './useScrollProgress'
import { useScrollSpy } from './useScrollSpy'
import { useReadingMode } from './modes/useReadingMode'
import type { MarkdownFile } from './components/useMarkdownFile'

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

/**
 * The <768px segmented control's labels (M4.2).
 *
 * They are not the switcher's labels because the control has a different job:
 * the switcher names a *view*, this one names a *pane of the workbench*, and
 * "Visual Graph" is the phrase the document's own capability is described in
 * (§6.7's chip reads "Auto-generated map" beside a "Document map" heading). On a
 * phone, where this is the only navigation, the longer phrase is the one that
 * says what tapping it will show.
 */
const PANE_LABEL: Record<ViewName, string> = {
  reader: 'Docs',
  graph: 'Visual Graph',
  stepper: 'Stepper',
}

/**
 * The segmented control's own name, and deliberately *not* "View".
 *
 * Both controls are in the DOM at every width — one is `display: none` — so
 * giving them the same accessible name puts two identically-named landmarks in
 * the document, which is `landmark-unique` the moment either is unhidden, and
 * leaves a screen-reader user with no way to say which one they are in. §5.3
 * calls this layout "a single pane, switched by the segmented control", and that
 * is both the spec's word and the accurate one: above 768px the workbench shows
 * the canvas and the panel together and this control does not exist, so what it
 * switches is the pane.
 */
const PANE_GROUP_LABEL = 'Workbench pane'

export type AppProps = {
  config: UnfoldConfig
  /** Injected in tests; defaults to the real `fetch`. */
  fetcher?: typeof fetch
  /**
   * Whether to fetch the configured document on mount. Defaults to the URL:
   * a deep link or an already-open session loads, a bare `#/` does not (M4.12).
   *
   * Injectable because the decision is otherwise only reachable through a real
   * URL, and 81 unit tests render this component in jsdom where the hash is
   * always empty — so every one of them silently became a test of the *front
   * door*. Making it a prop lets a test say "I want the reader" instead.
   */
  autoLoad?: boolean
}

export function App({ config, fetcher, autoLoad: autoLoadProp }: AppProps): JSX.Element {
  /*
   * The front door does not fetch (M4.12).
   *
   * Read once, from the URL, at mount — and deliberately frozen. Deciding this
   * from the live hash instead would mean the moment a reader opened a document
   * and the hash moved to `#/`, the app would decide it should have loaded, and
   * the decision would be re-made on every navigation.
   *
   * A deep link is a request for a document: someone sent `#/graph` or
   * `#some-section` and expects to land in it, not on a front door. A bare `#/`
   * is the absence of such a request, so nothing is fetched and the reader is
   * asked rather than served.
   */
  const [autoLoad] = useState(() => autoLoadProp ?? (() => {
    const raw = window.location.hash.replace(/^#+/u, '')
    if (raw !== '' && raw !== '/welcome') return true
    /*
     * A deep link is a request for a document, so it loads. A bare `#/` is the
     * absence of one — except for a reader who has *already* opened a document
     * in this session, where a bare `#/` means "back to the top of what I am
     * reading", not "nothing has been loaded".
     *
     * Without this, hitting reload at the top of a document dumped the reader
     * back onto the front door and lost their place. That surfaced as two
     * reading-mode failures, and it is the kind of thing the front door is
     * supposed to prevent rather than cause. The flag is per-tab and per-session
     * on purpose: the point is "you are already reading something", which is not
     * a fact worth carrying between sessions or across tabs.
     */
    return sessionStorage.getItem(UNFOLD_OPENED_KEY) !== null
  })())
  const state = useDocument(config, fetcher ?? fetch, autoLoad)
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

  /*
   * "A document is open in this session" (M4.12). Set from the state, not from
   * the click that caused it, so every route into a document is recorded
   * identically — the drop handler, the picker, the bundled button, a deep link.
   */
  useEffect(() => {
    if (doc !== undefined) sessionStorage.setItem(UNFOLD_OPENED_KEY, '1')
  }, [doc])

  /*
   * §9: "title = doc title". The document title is the one thing about a page
   * that is true before anything renders, in a tab strip, in a bookmark, in a
   * screen-reader window title and in a search result — and `index.html` ships
   * a hardcoded "Unfold", so all four have been showing the product's name
   * rather than the document's. The fallback matters too: §7.2's chain is
   * frontmatter > H1 > filename, and `doc.title` is the end of it, so this can
   * never be empty.
   */
  useEffect(() => {
    if (doc === undefined || typeof document === 'undefined') return
    const previous = document.title
    document.title = doc.title
    // Restored on unmount so a second App in the same document — which the unit
    // suite does, dozens of times — does not inherit the last fixture's title.
    return () => {
      document.title = previous
    }
  }, [doc])

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

  /*
   * M4.3: Esc, focus in, focus out, and Tab stays inside — §9's drawer clause.
   *
   * Esc arrived in M4.2. The rest is here, and the first half of it is a
   * defect rather than a feature: the closed drawer was `translateX(-100%)`,
   * which moves it off the screen and does **nothing** to the tab order. Every
   * section link inside a closed drawer was a Tab stop a keyboard user could
   * reach and focus, with no way to see what they had focused. The CSS fix
   * (`visibility: hidden`, which does remove it from both the tab order and the
   * accessibility tree) is in the M4.3 stylesheet block; what is left here is
   * the behaviour the CSS cannot express.
   *
   * Focus goes in on open and comes back on close, for the same reason the
   * palette's does (M2's `restoreFocusTo`): a drawer that swallows focus and
   * does not give it back strands a keyboard user at the top of the document,
   * and a drawer that opens without moving focus leaves the next keypress
   * acting on the page behind it.
   */
  const menuRef = useRef<HTMLButtonElement>(null)
  const drawerWasOpen = useRef(false)

  useEffect(() => {
    if (tocOpen) {
      const drawer = document.getElementById('toc')
      // The close button, not the first link: it is the one control whose
      // meaning does not depend on reading the list, so it is a usable landing
      // spot for a reader who opened the drawer by accident.
      const first = drawer?.querySelector<HTMLElement>('.toc-close, .toc-link') ?? null
      first?.focus()
    } else if (drawerWasOpen.current) {
      // Only on the way *out*. Mounting with the drawer closed must not steal
      // focus from the document on every route change.
      menuRef.current?.focus()
    }
    drawerWasOpen.current = tocOpen
  }, [tocOpen])

  useEffect(() => {
    if (!tocOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const drawer = document.getElementById('toc')
      if (drawer === null) return
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null)
      if (focusable.length === 0) return
      const first = focusable[0] as HTMLElement
      const last = focusable[focusable.length - 1] as HTMLElement
      const active = document.activeElement
      if (event.shiftKey && (active === first || !drawer.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [tocOpen])

  const goTo = useCallback((view: ViewName) => {
    const next: Route = view === 'reader' ? { name: 'reader' } : { name: view }
    if (typeof window !== 'undefined') window.location.hash = hashFor(next)
    setRoute(next)
  }, [])

  /**
   * The reader's "Open in graph view" link (M4.13.1).
   *
   * A stable identity, because the reader memoises the block options it passes
   * down and a fresh closure per render would undo that memoisation — the exact
   * mistake the `onNavigate` handlers above are written to avoid. It is passed
   * only when `capabilities.graph` is on (§1.1), so a document that cannot show
   * the graph view never offers a link to it.
   */
  const openGraph = useCallback(() => goTo('graph'), [goTo])

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

  /*
   * The app-wide drop handler (M4.12, closing M4.11b).
   *
   * The requirement is that dropping a file onto a **loaded** document swaps
   * documents. That cannot live in the drop screen, because the drop screen is
   * not mounted when a document is loaded — which is precisely the case the
   * requirement is about, and the reason the human could not confirm it.
   *
   * It is a `window` listener rather than a React `onDrop` on a wrapper, for
   * two reasons: the reader's own area is a grid with a rail, and a drop
   * anywhere on it should count; and React's synthetic events would need a
   * handler on every ancestor, which is a way of saying "there is no handler
   * for the gaps".
   */
  const loadFile = useCallback((file: MarkdownFile) => state.loadText(file.text, file.name), [state.loadText])
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onDragOver = (event: DragEvent): void => {
      // Without preventDefault the browser navigates to the dropped file and
      // the app is simply gone. This is the whole reason a drop target works.
      event.preventDefault()
    }
    const onDrop = (event: DragEvent): void => {
      event.preventDefault()
      const file = event.dataTransfer?.files[0]
      if (file === undefined) return
      const reader = new FileReader()
      reader.onload = () => loadFile({ text: String(reader.result ?? ''), name: file.name })
      reader.readAsText(file)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [loadFile])

  /*
   * The front door. It is checked before the `loading` and `drop` branches
   * because arriving at `#/` is a legitimate resting state, not a pending one:
   * a reader who has not chosen a document should not be shown a spinner, and
   * should certainly not be shown "that document could not be loaded" when
   * nothing has been attempted.
   */
  if (active.name === 'welcome' || state.status === 'idle') {
    return (
      <div className="app app--welcome" data-view="welcome">
        <header className="app-header">
          <a className="app-brand" href={WELCOME_HASH}>
            UNFOLD
          </a>
          <div className="app-header__spacer" />
        </header>
        <Welcome
          reading={doc?.title ?? null}
          onFile={loadFile}
          {...(config.docPath.trim() !== '' ? { onOpenBundled: state.reload } : {})}
        />
      </div>
    )
  }

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
      {/*
        §9: skip-to-content. Three things it had wrong, and only the last is
        visible in the markup.

        It was rendered *inside* `<main>`, as the first child of the very element
        it points at — so a keyboard user activated it and focus did not move,
        because it was already there. A skip link is the one control whose entire
        job is to move focus somewhere it is not.

        It then sat *after* `<header>`, which is its own kind of wrong: the
        header carries the menu button, the reading-mode toggle, the search
        trigger and the view switcher, so the first Tab press landed in the
        header rather than on the link. A skip link that is not the *first*
        focusable element does not skip the header, which is the main thing
        anyone uses it for. So it is the first thing in the app.

        And `<main>` had no `tabindex`, so even correctly placed it would have
        scrolled without moving focus: the next Tab would resume from the top of
        the document and the skip would have achieved nothing. `tabIndex={-1}`
        makes the target programmatically focusable without adding it to the tab
        order, which is the standard treatment.
      */}
      {active.name === 'reader' ? (
        <a className="skip-link" href="#main">
          Skip to content
        </a>
      ) : null}

      <div className="progress-bar" style={{ ['--progress' as string]: `${progress * 100}%` }} aria-hidden="true" />

      {/*
        Web analytics, and the whole of it.

        ## Why `@vercel/analytics/react` and not `/next`

        Both entry points export a component called `Analytics`, and the `/next`
        one is the one most copy-pasted from the docs. It imports
        `next/navigation.js` for route tracking, so in a Vite app it is not "the
        wrong analytics" — it is a build that cannot resolve, or a `next` install
        dragged in to satisfy an import nothing here uses. This is a Vite + React
        SPA, so the React entry point is the correct one: same component, same
        events, and its only import is `react`.

        ## What this does and does not collect

        Vercel Web Analytics: page views and the referrer, plus coarse
        browser/device metadata. **No cookies, no cross-site identifier, no
        fingerprinting, no PII**, and nothing about the *document* — the app never
        sends the markdown a reader is looking at, a config path, or a query
        string. The script is deferred and adds no first-party cookie, so the
        §9 a11y and §10.1 perf gates are unaffected, which `analytics.test.tsx`
        and the gates both check rather than assume.

        ## Turning it off

        Delete this element. There is no config flag on purpose: a flag for
        "don't phone home" would be a second thing to get wrong, and the honest
        way to not send analytics is not to ship the code that sends them.
      */}
      <Analytics mode="production" />

      <header className="app-header">
        <button
          type="button"
          ref={menuRef}
          className="app-menu"
          aria-label="Open contents"
          aria-expanded={tocOpen}
          aria-controls="toc"
          onClick={() => setTocOpen((open) => !open)}
        >
          ☰
        </button>

        {/*
          M4.12 — the wordmark is the leftmost element and is the way home.
          It is an `<a>`, not a `<button>`: `#/welcome` is a real, shareable
          location, and a link is what makes it one. The document title follows
          after a 1px divider so the reader can always tell *which* document
          they are in, and the divider is a real element rather than a border on
          the title so it cannot collapse when the title truncates.
        */}
        <a className="app-brand" href={WELCOME_HASH}>
          UNFOLD
        </a>
        <span className="app-brand__divider" aria-hidden="true" />
        <span className="app-title t-headline-sm" title={doc.title}>
          {doc.title}
        </span>

        <div className="app-header__spacer" />

        {/*
          The <768px segmented control (M3.5, brought to parity in M4.2).

          These are *pane switches, not tabs*, and deliberately not a `tablist`.
          A real tab must own a `tabpanel`, and the element it switches is
          `<main>` — giving that a `tabpanel` role would strip the `main`
          landmark §9 requires, and axe would rightly complain about the
          mismatch. So this is a button group with `aria-pressed`, which says
          exactly what is true: two ways to show one region, neither of which
          navigates.

          Each button navigates rather than flipping local state, because each
          one *is* a different view. That is what makes the back button and the
          address bar agree with what is on screen.

          **M4.2 — parity with the desktop switcher.** This control listed Docs
          and Visual Graph and nothing else, so on a phone the stepper was
          *unreachable* in a document that had one: a view the header switcher
          offers at 1440px, absent at 375px, with no other route to it. It is now
          built from the same `views` array the switcher uses and the same
          capability gate, which makes the two impossible to disagree — a
          capability added in the pipeline appears in both, and one removed
          disappears from both. The rule the M3 comment recorded still holds: the
          Metrics pane DESIGN.md once mentioned stays out, because there is no
          metrics view in v1 and a tab that leads nowhere is dead UI.

          The group is hidden by CSS above 768px, where the workbench shows both
          zones at once: a narrow-screen affordance, not a second navigation
          model.
        */}
        {views.length > 1 ? (
          <div className="workbench-tabs" role="group" aria-label={PANE_GROUP_LABEL}>
            {views.map((view) => (
              <button
                key={view}
                type="button"
                className="workbench-tab t-label-caps"
                aria-pressed={active.name === view}
                onClick={() => goTo(view)}
              >
                {PANE_LABEL[view]}
              </button>
            ))}
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

        <main className="app-main" id="main" tabIndex={-1}>
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
                diagrams={config.features.diagrams}
                onOpenGraph={doc.capabilities.graph ? openGraph : undefined}
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
