/**
 * ASCII diagram → terminal window (spec §6.9). Traffic lights, a 32px header
 * strip, line numbers, and a scanline overlay. The animated gradient on arrows
 * is decorative and is disabled under reduced motion by the token override.
 *
 * M4.14: this is now the **fallback presentation**, not the only one. See
 * `TerminalCandidate` below — the parser gets first refusal and this window is
 * exactly what a fence the parser declines still renders as, unchanged.
 */

import { useMemo } from 'react'
import { parseAsciiDiagram, UNPARSEABLE } from '../../pipeline/ascii-diagram'
import type { DiagramsMode } from '../../pipeline/config'
import { AsciiDiagram } from './AsciiDiagram'

export type TerminalProps = {
  code: string
  /**
   * The section this fence is in, for the region's accessible name.
   *
   * M4.14, and it is a real finding rather than a nicety: a document can now
   * contain *several* terminal windows, and every one of them was named
   * "Terminal output". Two regions with the same name is `landmark-unique`, and
   * a screen-reader user who lands on one is told nothing about which of them it
   * is — or even that there is a choice. The name is derived from the document
   * (the section heading the fence sits under), which is the same rule the table
   * scroller uses, for the same reason.
   */
  sectionTitle?: string | undefined
}

export type TerminalCandidateProps = {
  code: string
  /** `features.diagrams`. Defaults to `auto`. */
  diagrams?: DiagramsMode
  sectionTitle?: string | undefined
}

/**
 * A terminal candidate: an ASCII diagram if the parser will vouch for it, and the
 * existing terminal window if it will not.
 *
 * Three rules, in order of importance:
 *
 * **1. The window is untouched.** Not one line of `Terminal` changed in M4.14,
 * because the fallback has to be *exactly* what it was — a new fallback for an
 * old failure would be a change nobody asked for, in the one place where a
 * regression is silent (an ugly terminal is still a terminal).
 *
 * **2. `features.diagrams: "terminal"` never reaches the parser.** The config
 * switch short-circuits before the parse, so the escape hatch does not merely
 * hide the result — it does the work of turning the feature off, which is what
 * lets it bisect a defect.
 *
 * **3. The parse is memoised per block.** The parser is synchronous and cheap,
 * but a fence can be re-rendered on every reading-mode flip, and re-parsing the
 * same string on each one is pure cost for an identical answer.
 */
export function TerminalCandidate({
  code,
  diagrams = 'auto',
  sectionTitle,
}: TerminalCandidateProps): JSX.Element {
  const diagram = useMemo(
    () => (diagrams === 'terminal' ? UNPARSEABLE : parseAsciiDiagram(code)),
    [code, diagrams],
  )

  if (diagram.kind === 'diagram') return <AsciiDiagram diagram={diagram} />
  return <Terminal code={code} {...(sectionTitle === undefined ? {} : { sectionTitle })} />
}

export function Terminal({ code, sectionTitle }: TerminalProps): JSX.Element {
  const lines = code.split('\n')
  return (
    <figure className="terminal">
      <figcaption className="terminal-header">
        <span className="terminal-lights" aria-hidden="true">
          <span className="terminal-light terminal-light--close" />
          <span className="terminal-light terminal-light--min" />
          <span className="terminal-light terminal-light--max" />
        </span>
        <span className="terminal-title t-code-sm">output</span>
      </figcaption>
      <div className="terminal-body">
        <div className="terminal-lines" aria-hidden="true">
          {lines.map((_, index) => (
            <span key={index} className="terminal-line-number">
              {index + 1}
            </span>
          ))}
        </div>
        {/*
          M4.3: the same treatment the code block and the table scroller already
          have — a named `role="region"` with a tab stop. An ASCII diagram is the
          one block kind that *always* overflows on a phone, because its lines
          are drawn to a fixed width rather than to the prose column, so this is
          the block most in need of being pannable and the one axe flags first.

          "Terminal output" rather than the figure's visible "output": the region
          name is what a screen reader announces when focus lands here, and it
          needs to say what the region *is* without relying on the reader having
          just read the caption above it.

          M4.14 adds the section this fence sits in. A document can hold several
          terminal windows — that is what the fallback is *for* — and two regions
          with one name is `landmark-unique`, with a screen-reader user told
          nothing about which of them they are in. The name comes from the
          document's own heading, the way the table scroller's comes from its own
          header row.
        */}
        <pre
          className="terminal-content"
          tabIndex={0}
          role="region"
          aria-label={sectionTitle === undefined ? 'Terminal output' : `Terminal output — ${sectionTitle}`}
        >
          <code>{code}</code>
        </pre>
        <span className="terminal-scanline" aria-hidden="true" />
      </div>
    </figure>
  )
}
