/**
 * Frontmatter (spec §6.2, §1.2). Splitting is done here rather than by
 * `gray-matter`: that package is CommonJS and its default export does not
 * survive the browser build, so in a real page the parse silently failed and
 * the YAML block was rendered as document text. The split is a dozen lines and
 * the YAML is read with `js-yaml`, which is pure JS and behaves identically in
 * Node and the browser.
 *
 * A frontmatter block is `---` on the first line, a YAML body, and a closing
 * `---` (or `...`). Anything else is body, and a malformed body is a warning
 * plus a body — never a lost document (§1.3).
 */

import { load as parseYaml } from 'js-yaml'

export type Frontmatter = {
  data: Record<string, unknown>
  body: string
  /** True when a `---` block was found, even if its YAML did not parse. */
  present: boolean
  /** True when the block was found but its YAML was not a mapping. */
  malformed?: boolean
}

const OPEN = /^---[ \t]*\r?\n/u
const CLOSE = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/mu

export function splitFrontmatter(source: string): Frontmatter {
  const opening = OPEN.exec(source)
  if (opening === null) return { data: {}, body: source, present: false }

  // The body starts after the opening fence; the closing fence is the first
  // `---` or `...` on its own line *after* that.
  const rest = source.slice(opening[0].length)
  const closing = CLOSE.exec(rest)
  if (closing === null) return { data: {}, body: source, present: false }

  const yaml = rest.slice(0, closing.index)
  const body = rest.slice(closing.index + closing[0].length)

  let data: Record<string, unknown> = {}
  let ok = true
  try {
    const parsed = parseYaml(yaml)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>
    } else if (parsed !== null && parsed !== undefined) {
      // A scalar or a sequence is valid YAML but carries no frontmatter map.
      ok = false
    }
  } catch {
    ok = false
  }

  return { data, body, present: true, ...(ok ? {} : { malformed: true }) }
}
