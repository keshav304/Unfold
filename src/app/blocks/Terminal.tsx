/**
 * ASCII diagram → terminal window (spec §6.9). Traffic lights, a 32px header
 * strip, line numbers, and a scanline overlay. The animated gradient on arrows
 * is decorative and is disabled under reduced motion by the token override.
 */

export type TerminalProps = { code: string }

export function Terminal({ code }: TerminalProps): JSX.Element {
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
        */}
        <pre className="terminal-content" tabIndex={0} role="region" aria-label="Terminal output">
          <code>{code}</code>
        </pre>
        <span className="terminal-scanline" aria-hidden="true" />
      </div>
    </figure>
  )
}
