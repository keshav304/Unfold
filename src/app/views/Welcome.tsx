/**
 * The welcome view (M4.12). `#/welcome`, and the state when there is no
 * document at all.
 *
 * ## Why it exists
 *
 * The app had no front door. Every route assumed a document was already loaded,
 * so a first-time visitor either got a configured document they did not ask for
 * or a drop screen that reads as an *error* — "That document could not be
 * loaded" — when nothing had been attempted yet. This view is the thing the
 * product is named after, stated plainly: here is what you can do, and here is
 * the keyboard path to doing it.
 *
 * ## The rules it holds to
 *
 *  - **No document strings.** §0.1. Everything here is product copy about the
 *    product; none of it comes from a document, and `genericity.test.ts`
 *    greps for exactly that.
 *  - **The file picker is the keyboard path, drag is supplementary.** A drag
 *    target is unreachable by keyboard, so a button that opens the OS picker
 *    sits *inside* the drop zone. The dashed card is the affordance; the button
 *    is the contract.
 *  - **Tokens only.** No literal colour, radius or shadow (§5.2). The card grid
 *    reuses `elev-1`, the column reuses `--reading-column`, and the type reuses
 *    the `t-*` scale, so this view cannot drift from the rest of the app.
 */

import { useMarkdownFile, type MarkdownFile } from '../components/useMarkdownFile'

export type WelcomeProps = {
  /** The loaded document's title, or null when nothing is loaded. */
  reading: string | null
  /** Load a dropped or picked file. */
  onFile: (file: MarkdownFile) => void
  /** Reload the configured `docPath`. Only offered when one is configured. */
  onOpenBundled?: () => void
}

/** The three steps, as data so the numerals and the copy cannot drift apart. */
const STEPS = [
  { n: '01', title: 'Drop', body: 'drag any .md onto this window, or choose a file' },
  { n: '02', title: 'Explore', body: 'read, search with ⌘K, flip Executive/Reference' },
  { n: '03', title: 'Go deeper', body: 'graph and stepper views appear when the document supports them' },
] as const

/** The feature grid. Names only — the reader's own chrome is the demonstration. */
const FEATURES = [
  { name: 'Reader', body: 'terminal-style diagrams, highlighted code, scrollable tables' },
  { name: 'Executive mode', body: 'the two-minute version of any document' },
  { name: 'Search', body: '⌘K across sections, files, glossary' },
  { name: 'Document map', body: 'auto-generated from cross-links' },
  { name: 'Stepper', body: 'when the document defines steps' },
  { name: 'Smart chips', body: 'hover a file path for its backlinks' },
  { name: 'Glossary', body: 'terms and aliases, defined once' },
  { name: 'Private', body: '100% local — no upload, no server' },
] as const

export function Welcome({ reading, onFile, onOpenBundled }: WelcomeProps): JSX.Element {
  const file = useMarkdownFile(onFile)

  return (
    <div className="welcome grid-canvas">
      <div className="welcome__col">
        <h1 className="welcome__title t-display-lg">Unfold</h1>
        <p className="welcome__tagline t-headline-sm">Any markdown file in. An interactive document out.</p>

        <p className="welcome__about t-body">
          Unfold turns a plain markdown file into an explorable site — reader, search, diagrams, graphs —
          entirely in your browser. Nothing is uploaded; your file never leaves your machine.
        </p>

        <ol className="welcome__steps">
          {STEPS.map((step) => (
            <li key={step.n} className="welcome__step">
              <span className="welcome__step-n t-code-sm" aria-hidden="true">
                {step.n}
              </span>
              <span className="welcome__step-body">
                <strong className="welcome__step-title">{step.title}</strong> — {step.body}
              </span>
            </li>
          ))}
        </ol>

        <h2 className="t-label-caps welcome__features-head">Features</h2>
        <ul className="welcome__features">
          {FEATURES.map((feature) => (
            <li key={feature.name} className="welcome__feature elev-1">
              <h3 className="t-label-caps welcome__feature-name">{feature.name}</h3>
              <p className="welcome__feature-body t-code-sm">{feature.body}</p>
            </li>
          ))}
        </ul>

        {/*
          The drop zone. `data-dragging` drives the border and the accent wash,
          and it is a *data attribute* rather than a class so the stylesheet owns
          the appearance — the component owns only the state (§5.2).
        */}
        <div
          className="welcome__drop"
          data-dragging={file.dragging ? 'true' : 'false'}
          {...file.dropProps}
        >
          <p className="welcome__drop-hint t-body">
            Drop a <code className="t-code-sm">.md</code> file here
          </p>
          <div className="welcome__drop-actions">
            <button type="button" className="welcome__button t-code-sm" onClick={file.choose}>
              Choose a .md file
            </button>
            {onOpenBundled !== undefined ? (
              <button type="button" className="welcome__button welcome__button--ghost t-code-sm" onClick={onOpenBundled}>
                Open the bundled document
              </button>
            ) : null}
          </div>
          {reading !== null ? <p className="welcome__reading t-code-sm">Reading: {reading}</p> : null}
          {file.error !== null ? (
            <p className="welcome__error t-code-sm" role="alert">
              {file.error}
            </p>
          ) : null}
          <input
            ref={file.input}
            type="file"
            accept=".md,.markdown,text/markdown"
            className="visually-hidden"
            aria-label="Choose a markdown file"
            onChange={file.onChange}
          />
        </div>
      </div>
    </div>
  )
}
