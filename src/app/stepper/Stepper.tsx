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

export function Stepper({ steps, step, onStepChange, onNavigate }: StepperProps): JSX.Element | null {
  const current = clampStep(step, steps.length)
  const active = steps[current - 1]

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  const go = useCallback(
    (next: number) => {
      onStepChange(clampStep(next, steps.length))
    },
    [onStepChange, steps.length],
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
   *   - anything else (the document-level arrows, the prev/next buttons) → the
   *     panel takes focus, because that is where the new step is being read.
   */
  const movedWithinTabs = useRef(false)

  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (movedWithinTabs.current) {
      movedWithinTabs.current = false
      return
    }
    panelRef.current?.focus()
  }, [current])

  /**
   * ← / → move between steps (§7.7).
   *
   * Bound to the document, and skipped while focus is in a text field for the
   * same reason the palette skips `/` there: an arrow key in an input is the
   * caret moving, not a stepper advancing. No text field exists inside the
   * stepper today, but the guard is what keeps that true when one arrives.
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
    <div className="stepper" data-step={current} data-total={steps.length}>
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
            id={`step-tab-${dot.number}`}
            aria-selected={dot.number === current}
            aria-controls="step-panel"
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
              // Within a tablist, ← / → move between tabs. The document-level
              // handler above moves between *steps*; with focus on a tab both
              // would fire, so this one stops the event reaching it.
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
        id="step-panel"
        role="tabpanel"
        aria-labelledby={`step-tab-${current}`}
        tabIndex={-1}
        ref={panelRef}
      >
        <span className="step-number t-label-caps" aria-hidden="true">
          Step {active.index}
        </span>
        {/*
          The step title is the page's `h1`, not an `h2`. The reader's title is
          the document's H1; this view has no H1 of its own, and axe is right that
          a page with no top-level heading is a page whose structure is announced
          from the wrong starting point. The view name ("Walkthrough") is the
          `label-caps` kicker above it, which is what DESIGN.md's composition
          calls for anyway.
        */}
        <h1 className="step-title t-headline-lg">{active.title}</h1>
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
