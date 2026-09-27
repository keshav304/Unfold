/**
 * ASCII diagram detection (spec §6.9). An *untagged* fence becomes a `terminal`
 * block when any one of these holds:
 *
 *   1. ≥2 lines contain box-drawing characters
 *   2. ≥1 line matches `^\s*\+[-=+]+\+$`
 *   3. ≥2 arrow lines together with at least one pipe/box line
 *
 * Tagging wins over detection: a fence with a language is never a terminal
 * unless the language is absent or empty.
 */

import { TERMINAL_MIN_ARROW_LINES, TERMINAL_MIN_BOX_LINES } from './constants'

/** Unicode box-drawing block (U+2500–U+257F) and block elements (U+2580–U+259F). */
const BOX_CHARS = /[─-╿▀-▟]/
/** An arrow between two tokens: `-->`, `-.->`, `=>`, `|`, `v`. */
const ARROW_LINE = /[-=]{1,2}>|<[-=]{1,2}|[─-╿]?→|[←-⇿]|--?>|=>|\|\s*[vV^]/
/** A line carrying box structure rather than prose. */
const PIPE_OR_BOX_LINE = /[|│┆┊]|[+┌┐└┘├┤┬┴┼─]{2,}/
const PLUS_RULE = /^\s*\+[-=+]+\+\s*$/

export function isAsciiDiagram(code: string): boolean {
  const lines = code.split(/\r?\n/)

  const boxLines = lines.filter((line) => BOX_CHARS.test(line))
  if (boxLines.length >= TERMINAL_MIN_BOX_LINES) return true

  if (lines.some((line) => PLUS_RULE.test(line))) return true

  const arrowLines = lines.filter((line) => ARROW_LINE.test(line))
  if (arrowLines.length < TERMINAL_MIN_ARROW_LINES) return false
  return lines.some((line) => PIPE_OR_BOX_LINE.test(line))
}
