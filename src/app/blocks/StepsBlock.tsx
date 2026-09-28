/**
 * A ` ```steps ` block, rendered inline in the reader (M4.13.2).
 *
 * The stepper is not reimplemented here — it is `StepperView` with
 * `variant="embedded"`, so the reader's block and the Stepper view are the same
 * component with the same tablist semantics, the same dots, the same panel and
 * the same `@slug` source link. The only state this wrapper owns is *which step
 * it is showing*: an inline stepper is local to its block, so it neither reads
 * nor writes the URL. The view's step lives in the route (§7.7); a block's does
 * not, because a document with two `steps` blocks would otherwise have two
 * owners of one hash.
 *
 * With no steps the block renders nothing at all. A `steps` block that parsed to
 * an empty list cannot happen (the DSL would have degraded to a code block in
 * `classifyNode`), but "no steps" must never mean an empty box on the page.
 */

import { useState } from 'react'
import type { StepSpec } from '../../pipeline/dsl/types'
import { StepperView, clampStep } from '../stepper/Stepper'

export type StepsBlockProps = {
  steps: readonly StepSpec[]
  /**
   * `InlineContext.onNavigate`, which the reader always carries but a
   * hand-rendered block may not. Explicitly `undefined` because
   * `exactOptionalPropertyTypes` treats "absent" and "present but undefined" as
   * two different things, and this one arrives as the latter.
   */
  onNavigate?: ((slug: string) => void) | undefined
}

export function StepsBlock({ steps, onNavigate }: StepsBlockProps): JSX.Element | null {
  const [step, setStep] = useState(1)
  if (steps.length === 0) return null

  return (
    <StepperView
      steps={steps}
      step={clampStep(step, steps.length)}
      onSelect={setStep}
      onNavigate={onNavigate}
      variant="embedded"
    />
  )
}
