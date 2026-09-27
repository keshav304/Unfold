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
        <pre className="terminal-content">
          <code>{code}</code>
        </pre>
        <span className="terminal-scanline" aria-hidden="true" />
      </div>
    </figure>
  )
}
