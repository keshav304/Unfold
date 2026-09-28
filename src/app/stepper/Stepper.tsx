/**
 * The stepper (spec §7.7). Renders `doc.steps` as a walkthrough: one step at a
 * time, with prev/next, the arrow keys, progress dots, and a deep link per step.
 *
 * Two things it deliberately does not do.
 *
 * **It does not parse the steps.** The pipeline owns the DSL (§6.8), validates
 * each `@slug` against the document's real slugs, and drops the ones that do not
 * resolve while keeping the step. A step whose `source` is missing renders
 * without the link — no invented target, no disabled control.
 *
 * **It does not own the step number.** The stepper reports the step it is
 * showing and the shell writes the hash, exactly as the palette reports a chosen
 * result and the shell navigates. One owner of the URL, one owner of the route.
 *
 * A stepper is a `tablist` (M3.7, logged in DECISIONS.md): the dots *are* the
 * steps, each is a tab, and the step body is the tab panel. That is the reading
 * screen readers already have for "pick one of N, here it is", and it gives the
 * arrow-key behaviour §7.7 requires without a second bespoke key handler.
 *
 * ## Two mounts, one implementation (M4.13.2)
 *
 * The reader renders a ` ```steps ` block inline, and the requirement is one
 * stepper rather than two. So the *view* — dots, panel, navigation, the tablist
 * contract — is `StepperView`, and what `Stepper` adds on top of it is what only
 * makes sense for a view that occupies the whole screen:
 *
 *   - the document-level ← / → binding (the reader owns its own arrows, and two
 *     handlers on one key is a bug rather than a feature);
 *   - focusing the panel on mount, which is right when the view *is* the page and
 *     wrong when it is a block the reader is already looking at.
 *
 * `variant` is the whole difference, and it is stated in one place.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { StepSpec } from '../../pipeline/dsl/types'
import { navigate } from '../navigate'

export type StepperProps = {
  steps: readonly StepSpec[]
  /** 1-based, clamped to the available steps. */
  step: number
  onStepChange: (step: number) => void
  onNavigate: (slug: string) => void
}

/**
 * Which mount this is.
 *
 * `workbench` — the full view (§7.7). `embedded` — the same stepper as a block
 * in the reader (M4.13.2), where the ids have to be namespaced (two
 * `step-panel` elements on one page is two elements with the same id, and
 * `aria-labelledby` then points somewhere arbitrary) and the step title must not
 * be a second `h1` on a page whose `h1` is the document's own title.
 */
export type StepperVariant = 'workbench' | 'embedded'

export type StepperViewProps = {
  steps: readonly StepSpec[]
  /** 1-based; clamped here as well, so an out-of-range step never reaches the DOM. */
  step: number
  /** Where a dot, a nav button or a keyboard move is asking to go. */
  onSelect: (next: number) => void
  /** Where the `@slug` source link navigates. Absent → the hash still changes. */
  onNavigate?: ((slug: string) => void) | undefined
  variant?: StepperVariant
}

/** Clamp a requested step into the document's real range. */
export function clampStep(step: number, total: number): number {
  if (total === 0) return 1
  if (!Number.isFinite(step)) return 1
  return Math.min(Math.max(Math.trunc(step), 1), total)
}

/** The accessible name for a step's tab, from the document's own words. */
function tabLabel(step: StepSpec, index: number, total: number): string {
  return `Step ${index} of ${total}: ${step.title}`
}

export function StepperView({
  steps,
  step,
  onSelect,
  onNavigate,
  variant = 'workbench',
}: StepperViewProps): JSX.Element | null {
  const current = clampStep(step, steps.length)
  const active = steps[current - 1]
  /**
   * The workbench keeps the ids §7.7 and the deep-link tests are written
   * against (`step-panel`, `step-tab-2`); an embedded stepper namespaces its
   * own, because a page cannot hold two elements with the same id.
   */
  const idPrefix = variant === 'workbench' ? 'step' : 'reader-step'

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  /** Dots and nav ask; the caller owns the step. */
  const go = useCallback(
    (next: number) => onSelect(clampStep(next, steps.length)),
    [onSelect, steps.length],
  )

  /**
   * Where focus goes when the step changes.
   *
   * It depends on *how* the reader moved, and getting this wrong is the kind of
   * bug only a browser shows: the Playwright walk pressed → on a focused dot,
   * watched the step advance, and found focus sitting on the panel — because
   * both handlers acted and the panel effect ran last.
   *
   * So there is one rule: focus follows the control the reader is using.
   *   - arrows on a dot (roving tabindex) → focus stays on the dots;
   *   - anything else (the prev/next buttons) → the panel takes focus, because
   *     that is where the new step is being read.
   */
  const movedWithinTabs = useRef(false)

  const panelRef = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)
  useEffect(() => {
    if (movedWithinTabs.current) {
      movedWithinTabs.current = false
      return
    }
    /*
     * The workbench focuses the panel on mount: the view *is* the page, and the
     * panel is where the step is being read. An embedded stepper must not — it
     * appears while the reader is reading, and taking focus from a page that
     * just loaded is a hijack, not a courtesy. Only the first run differs; every
     * subsequent step change behaves identically in both mounts.
     */
    if (variant === 'embedded' && !mounted.current) {
      mounted.current = true
      return
    }
    mounted.current = true
    panelRef.current?.focus()
  }, [current, variant])

  const dots = useMemo(
    () =>
      steps.map((entry, index) => ({
        entry,
        number: index + 1,
        label: tabLabel(entry, index + 1, steps.length),
      })),
    [steps],
  )


  if (active === undefined || steps.length === 0) return null

  return (
    <div
      className={variant === 'embedded' ? 'stepper stepper--embedded' : 'stepper'}
      data-step={current}
      data-total={steps.length}
      data-variant={variant}
    >
      <header className="stepper-head">
        <span className="stepper-head__kind t-label-caps">Walkthrough</span>
        <span className="stepper-count t-code-sm" aria-live="polite">
          {current} / {steps.length}
        </span>
      </header>

      {/*
        The tablist. `aria-selected` marks the current dot and each tab controls
        the one panel below — a tabpanel whose `aria-labelledby` points back at
        the selected tab, which is the pairing axe checks.
      */}
      <div className="stepper-dots" role="tablist" aria-label="Walkthrough steps">
        {dots.map((dot) => (
          <button
            key={dot.number}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${dot.number}`}
            aria-selected={dot.number === current}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={dot.number === current ? 0 : -1}
            className="step-dot"
            data-state={
              dot.number === current ? 'active' : dot.number < current ? 'past' : 'future'
            }
            title={dot.entry.title}
            ref={(element) => {
              tabRefs.current[dot.number - 1] = element
            }}
            onClick={() => go(dot.number)}
            onKeyDown={(event) => {
              // Within a tablist, ← / → move between tabs. The workbench's
              // document-level handler moves between *steps*; with focus on a
              // tab both would fire, so this one stops the event reaching it.
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              event.stopPropagation()
              // Claim the focus move: the reader is walking the dots, so the
              // panel must not steal focus from under them.
              movedWithinTabs.current = true
              const delta = event.key === 'ArrowRight' ? 1 : -1
              const nextIndex = Math.min(Math.max(dot.number - 1 + delta, 0), steps.length - 1)
              go(nextIndex + 1)
              tabRefs.current[nextIndex]?.focus()
            }}
          >
            <span className="visually-hidden">{dot.label}</span>
            <span className="step-dot__mark t-code-sm" aria-hidden="true">
              {dot.number}
            </span>
          </button>
        ))}
      </div>

      <div
        className="stepper-panel"
        id={`${idPrefix}-panel`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${current}`}
        tabIndex={-1}
        ref={panelRef}
      >
        <span className="step-number t-label-caps" aria-hidden="true">
          Step {active.index}
        </span>
        {/*
         * The step title is the page's `h1`, not an `h2` — in the workbench.
         * The reader's title is the document's H1; that view has no H1 of its
         * own, and axe is right that a page with no top-level heading is a page
         * whose structure is announced from the wrong starting point. The view
         * name ("Walkthrough") is the `label-caps` kicker above it, which is
         * what DESIGN.md's composition calls for anyway.
         *
         * Embedded in the reader, the document's `h1` is already on the page and
         * a second one would be two top-level headings in one document. The
         * title becomes a paragraph at the smaller headline step: same words,
         * same place in the panel, right weight for a block inside a prose
         * column.
         */}
        {variant === 'workbench' ? (
          <h1 className="step-title t-headline-lg">{active.title}</h1>
        ) : (
          <p className="step-title step-title--inline t-headline-md">{active.title}</p>
        )}
        {active.description === undefined ? null : (
          <p className="step-description t-body-lg">{active.description}</p>
        )}
        {/*
          The source link (§6.8). Rendered only when the pipeline resolved the
          `@slug`; a step whose reference matched no section keeps the step and
          loses the link, which is exactly what §6.8 specifies.
        */}
        {active.source === undefined ? null : (
          <a
            className="step-source t-code-sm"
            href={`#${active.source}`}
            onClick={(event) => {
              event.preventDefault()
              navigate(active.source as string, onNavigate)
            }}
          >
            <span>Source section</span>
            <span aria-hidden="true">→</span>
          </a>
        )}
      </div>

      <nav className="stepper-nav" aria-label="Walkthrough navigation">
        <button
          type="button"
          className="stepper-button t-body-md"
          onClick={() => go(current - 1)}
          disabled={current === 1}
        >
          <span aria-hidden="true">←</span>
          <span>Previous</span>
        </button>
        <button
          type="button"
          className="stepper-button t-body-md"
          onClick={() => go(current + 1)}
          disabled={current === steps.length}
        >
          <span>Next</span>
          <span aria-hidden="true">→</span>
        </button>
      </nav>
    </div>
  )
}

/**
 * The stepper as a view (spec §7.7): `StepperView`, plus the two things that
 * only make sense when the stepper *is* the page — the document-level ← / →
 * binding, and taking focus on mount so the panel is where the reader is
 * looking. The reader's inline stepper gets neither, deliberately; see
 * `StepperView` above.
 */
export function Stepper({ steps, step, onStepChange, onNavigate }: StepperProps): JSX.Element | null {
  const current = clampStep(step, steps.length)

  const go = useCallback(
    (next: number) => {
      onStepChange(clampStep(next, steps.length))
    },
    [onStepChange, steps.length],
  )

  /**
   * ← / → move between steps (§7.7).
   *
   * Bound to the document, and skipped while focus is in a text field for the
   * same reason the palette skips `/` there: an arrow key in an input is the
   * caret moving, not a stepper advancing. No text field exists inside the
   * stepper today, but the guard is what keeps that true when one arrives.
   *
   * A viewer of this file may ask why this did not move into `StepperView`,
   * where it would travel with the reader's stepper for free. Because the
   * reader's arrows are the *reader's*: reading mode, the palette and the
   * browser's own scrolling all live on the same document, and a block that
   * claimed ← / → whenever it happened to be on screen would claim them from
   * all of them.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      event.preventDefault()
      go(current + (event.key === 'ArrowRight' ? 1 : -1))
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [current, go])

  if (steps.length === 0) return null

  return (
    <StepperView
      steps={steps}
      step={current}
      onSelect={go}
      onNavigate={onNavigate}
      variant="workbench"
    />
  )
}

