/**
 * `loop` DSL (spec §1.2): comma- or newline-separated labels, rendered as an
 * animated cycle diagram. A cycle needs at least two labels — one label is not
 * a cycle, so it is a parse failure and degrades to a code block.
 */

import { DslParseError } from './types'

/** Below this, a "cycle" is meaningless; the block degrades to code. */
export const LOOP_MIN_LABELS = 2

export function parseLoop(code: string): string[] {
  const labels = code
    .split(/[,\n]/)
    .map((label) => label.trim())
    .filter((label) => label !== '')

  if (labels.length < LOOP_MIN_LABELS) {
    throw new DslParseError(`a loop needs at least ${LOOP_MIN_LABELS} labels, found ${labels.length}`)
  }
  return labels
}
