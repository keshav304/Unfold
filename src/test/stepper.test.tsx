/**
 * M3.6 / M3.7 — the stepper in jsdom.
 *
 * jsdom cannot prove the *tab order* or the *focus ring*; the Playwright suite
 * does that against a real engine. What jsdom can prove honestly, and what would
 * otherwise regress silently, is the data contract: which step is showing, what
 * the deep link does with an out-of-range number, whether the `@slug` link is
 * rendered only when the pipeline resolved it, and that ←/→ move.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Stepper, clampStep } from '../app/stepper/Stepper'
import { parseFixture } from './fixtures'
import type { StepSpec } from '../pipeline/dsl/types'

afterEach(cleanup)
beforeEach(() => {
  window.location.hash = ''
})

const STEPS: StepSpec[] = [
  { index: 1, title: 'Submit', description: 'the shell posts a query', source: 'environment' },
  { index: 2, title: 'Plan', description: 'the planner resolves the index', source: 'runtime-shape' },
  { index: 3, title: 'Answer', description: 'the shell renders results' },
]

/** Render the stepper, reporting every step change to the spy. */
function renderStepper(step: number, steps: readonly StepSpec[] = STEPS) {
  const onStepChange = vi.fn()
  const onNavigate = vi.fn()
  const result = render(
    <Stepper steps={steps} step={step} onStepChange={onStepChange} onNavigate={onNavigate} />,
  )
  return { ...result, onStepChange, onNavigate }
}

const title = (container: HTMLElement): string =>
  container.querySelector('.step-title')?.textContent ?? ''

describe('M3.6 the stepper renders the document\'s own steps', () => {
  it('shows the requested step', () => {
    const { container } = renderStepper(2)
    expect(title(container)).toBe('Plan')
    expect(container.querySelector('.stepper')?.getAttribute('data-step')).toBe('2')
  })

  it('renders the number, title and description verbatim', () => {
    const { container } = renderStepper(1)
    expect(container.querySelector('.step-number')?.textContent).toBe('Step 1')
    expect(title(container)).toBe('Submit')
    expect(container.querySelector('.step-description')?.textContent).toBe('the shell posts a query')
  })

  it('a step with no description renders none, rather than an empty paragraph', () => {
    const { container } = renderStepper(1, [{ index: 1, title: 'Only a title' }])
    expect(container.querySelector('.step-description')).toBeNull()
  })

  it('renders nothing at all for a document with no steps', () => {
    const { container } = renderStepper(1, [])
    expect(container.querySelector('.stepper')).toBeNull()
  })
})

describe('M3.6 the @slug source link follows the pipeline\'s resolution', () => {
  it('is rendered when the pipeline resolved the slug', () => {
    const { container } = renderStepper(1)
    const link = container.querySelector('.step-source')
    expect(link?.getAttribute('href')).toBe('#environment')
  })

  it('and is absent on a step whose slug matched no section', () => {
    // §6.8: the step is kept, the link is dropped. Step 3 has no `source` because
    // its `@slug` did not resolve, or because it never had one — the view cannot
    // tell, and must not pretend to.
    const { container } = renderStepper(3)
    expect(title(container)).toBe('Answer')
    expect(container.querySelector('.step-source')).toBeNull()
  })

  it('clicking it navigates in-app, through the shell\'s callback', () => {
    const { container, onNavigate } = renderStepper(1)
    fireEvent.click(container.querySelector('.step-source') as HTMLElement)
    expect(onNavigate).toHaveBeenCalledWith('environment')
  })
})

describe('M3.6 prev and next', () => {
  it('next advances, previous goes back', () => {
    const { onStepChange } = renderStepper(2)
    const nav = within(screen.getByRole('navigation', { name: 'Walkthrough navigation' }))
    fireEvent.click(nav.getByRole('button', { name: /Next/ }))
    expect(onStepChange).toHaveBeenLastCalledWith(3)
    fireEvent.click(nav.getByRole('button', { name: /Previous/ }))
    expect(onStepChange).toHaveBeenLastCalledWith(1)
  })

  it('previous is disabled on the first step and next on the last', () => {
    const { container: firstContainer } = renderStepper(1)
    const firstNav = within(screen.getByRole('navigation', { name: 'Walkthrough navigation' }))
    expect(firstNav.getByRole('button', { name: /Previous/ })).toBeDisabled()
    expect(firstNav.getByRole('button', { name: /Next/ })).not.toBeDisabled()
    expect(firstContainer.querySelector('.stepper')?.getAttribute('data-step')).toBe('1')
    cleanup()

    const { container: lastContainer } = renderStepper(3)
    const lastNav = within(screen.getByRole('navigation', { name: 'Walkthrough navigation' }))
    expect(lastNav.getByRole('button', { name: /Next/ })).toBeDisabled()
    expect(lastContainer.querySelector('.stepper')?.getAttribute('data-step')).toBe('3')
  })
})

describe('M3.7 ← and → move between steps', () => {
  it('→ advances', () => {
    const { onStepChange } = renderStepper(1)
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(onStepChange).toHaveBeenLastCalledWith(2)
  })

  it('← goes back', () => {
    const { onStepChange } = renderStepper(3)
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(onStepChange).toHaveBeenLastCalledWith(2)
  })

  it('and neither moves past either end', () => {
    const first = renderStepper(1)
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(first.onStepChange).toHaveBeenLastCalledWith(1)
    cleanup()
    const last = renderStepper(3)
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(last.onStepChange).toHaveBeenLastCalledWith(3)
  })

  it('an arrow key inside a text field is the caret, not the stepper', () => {
    // The same reason the palette skips `/` in an input. Nothing in the stepper
    // is a text field today; the guard is what keeps that from silently changing.
    const { onStepChange } = renderStepper(2)
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'ArrowRight' })
    expect(onStepChange).not.toHaveBeenCalled()
    input.remove()
  })
})

describe('M3.7 the stepper is a tablist, chosen over a button group', () => {
  // Logged in DECISIONS.md. The dots *are* the steps and the body *is* the panel,
  // which is the relationship `tablist`/`tab`/`tabpanel` already names.
  it('the dots are a tablist with one tab per step', () => {
    renderStepper(1)
    const tabs = screen.getByRole('tablist', { name: 'Walkthrough steps' })
    expect(within(tabs).getAllByRole('tab')).toHaveLength(3)
  })

  it('the current step is selected, and only it is in the tab order', () => {
    // Roving tabindex: one Tab press reaches the stepper, arrows move within it.
    const { container } = renderStepper(2)
    const tabs = screen.getByRole('tablist', { name: 'Walkthrough steps' })
    const all = within(tabs).getAllByRole('tab')
    expect(all[1]).toHaveAttribute('aria-selected', 'true')
    expect(all[1]).toHaveAttribute('tabindex', '0')
    expect(all[0]).toHaveAttribute('tabindex', '-1')
    expect(all[2]).toHaveAttribute('tabindex', '-1')
    expect(container.querySelectorAll('.step-dot[data-state="active"]')).toHaveLength(1)
  })

  it('the body is the tabpanel, labelled by the selected tab', () => {
    const { container } = renderStepper(2)
    const panel = container.querySelector('#step-panel')
    expect(panel?.getAttribute('role')).toBe('tabpanel')
    expect(panel?.getAttribute('aria-labelledby')).toBe('step-tab-2')
  })

  it('each tab is named from the document\'s own words', () => {
    renderStepper(1)
    const tabs = within(screen.getByRole('tablist', { name: 'Walkthrough steps' })).getAllByRole('tab')
    // The accessible *name*, not `textContent`: the visible number inside the dot
    // is `aria-hidden` decoration, and a name that read "Step 1 of 3: Submit1"
    // would be announcing the badge twice.
    expect(tabs[0]?.getAttribute('aria-label')).toBeNull()
    expect(within(tabs[0] as HTMLElement).getByText('Step 1 of 3: Submit')).toBeInTheDocument()
    expect(within(tabs[2] as HTMLElement).getByText('Step 3 of 3: Answer')).toBeInTheDocument()
  })

  it('and the visible number is hidden from assistive tech, since the name carries it', () => {
    const { container } = renderStepper(1)
    const mark = container.querySelector('.step-dot[data-state="active"] .step-dot__mark')
    expect(mark?.getAttribute('aria-hidden')).toBe('true')
  })

  it('clicking a dot jumps to that step', () => {
    const { onStepChange } = renderStepper(1)
    const tabs = within(screen.getByRole('tablist', { name: 'Walkthrough steps' })).getAllByRole('tab')
    fireEvent.click(tabs[2] as HTMLElement)
    expect(onStepChange).toHaveBeenLastCalledWith(3)
  })
})

describe('M3.6 an out-of-range deep link clamps rather than erroring', () => {
  it('clamps a step past the end to the last step', () => {
    expect(clampStep(99, 3)).toBe(3)
  })

  it('clamps zero, a negative, and a nonsense number to the first', () => {
    expect(clampStep(0, 3)).toBe(1)
    expect(clampStep(-4, 3)).toBe(1)
    expect(clampStep(Number.NaN, 3)).toBe(1)
  })

  it('a document with no steps clamps to 1 without dividing by zero', () => {
    expect(clampStep(3, 0)).toBe(1)
  })

  it('and a stale deep link lands on a real step, not a blank view', () => {
    const { container } = renderStepper(clampStep(99, 3))
    expect(title(container)).toBe('Answer')
  })
})

describe('M3.6 the fixture\'s parsed steps drive the view unchanged', () => {
  it('kitchen-sink declares three steps, and the pipeline resolved their slugs', () => {
    const { doc } = parseFixture('kitchen-sink')
    expect(doc.steps).toHaveLength(3)
    // Two of the three carry a resolved `@slug`; the third has none at all, which
    // is a different thing from an unresolved one and the view treats both the
    // same way — no link.
    expect(doc.steps?.[0]?.source).toBe('environment')
    expect(doc.steps?.[1]?.source).toBe('runtime-shape')
    expect(doc.steps?.[2]?.source).toBeUndefined()
  })

  it('a document with no steps block has none to render', () => {
    expect(parseFixture('crosslinked').doc.steps).toBeUndefined()
  })
})
