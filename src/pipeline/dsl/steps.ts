/**
 * `steps` DSL (spec §6.8). Frozen grammar:
 *
 *   N. Title — description [@slug]
 *
 * The `—` separator and the `[@slug]` reference are both optional. A `@slug`
 * that does not resolve is kept as `sourceRef` and logged; it is never a parse
 * failure, because the step itself is still perfectly readable.
 */

import { DslParseError, type StepSpec } from './types'

/** `1.` / `2)` / `3 -` — a number followed by any single punctuation mark. */
const STEP_LINE = /^(\d+)\s*[.)\-–]\s+(.*)$/
/** A bracketed `[@slug]` source reference. */
const BRACKETED_REF = /\[@([^\]\s]+)\]\s*$/
/** A bare trailing `@slug` source reference, as in the spec's own example. */
const BARE_REF = /(?:^|\s)@([A-Za-z0-9_][\w-]*)\s*$/
/** The em/en dash that separates title from description. */
const TITLE_DESC = /\s+[—–]\s+/

export type StepParseResult = {
  steps: StepSpec[]
  /** Every `[@slug]` reference, resolved or not, in document order. */
  refs: string[]
}

export function parseSteps(code: string): StepParseResult {
  const steps: StepSpec[] = []
  const refs: string[] = []
  const lines = code.split(/\r?\n/)

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim()
    if (line === '') return

    const match = STEP_LINE.exec(line)
    if (!match) {
      throw new DslParseError(`step line does not start with a number: ${line}`, index + 1)
    }

    const number = Number.parseInt(match[1] as string, 10)
    let rest = (match[2] as string).trim()
    if (rest === '') throw new DslParseError(`step ${number} has no title`, index + 1)

    let sourceRef: string | undefined
    let refStart = -1
    const bracketed = BRACKETED_REF.exec(rest)
    if (bracketed !== null) {
      sourceRef = bracketed[1] as string
      refStart = bracketed.index
    } else {
      const bare = BARE_REF.exec(rest)
      if (bare !== null) {
        sourceRef = bare[1] as string
        refStart = bare.index + (bare[0].startsWith('@') ? 0 : 1)
      }
    }
    if (sourceRef !== undefined) rest = rest.slice(0, refStart).trim()

    let title = rest
    let description: string | undefined
    const split = TITLE_DESC.exec(rest)
    if (split) {
      title = rest.slice(0, split.index).trim()
      description = rest.slice(split.index + split[0].length).trim()
    }

    if (title === '') throw new DslParseError(`step ${number} has no title`, index + 1)
    if (description === '') description = undefined
    if (sourceRef !== undefined) refs.push(sourceRef)

    steps.push(
      description === undefined && sourceRef === undefined
        ? { index: number, title }
        : {
            index: number,
            title,
            ...(description === undefined ? {} : { description }),
            ...(sourceRef === undefined ? {} : { sourceRef }),
          },
    )
  })

  if (steps.length === 0) throw new DslParseError('block contains no steps')

  return { steps, refs }
}
