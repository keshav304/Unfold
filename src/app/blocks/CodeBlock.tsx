/**
 * Code block (spec §7.1). Shiki is a **lazy chunk** with a single `github-dark`
 * theme (§4). The highlight is progressive: the plain code renders immediately
 * and is replaced when the highlighter resolves, so the reader never waits.
 *
 * Container per DESIGN.md: `--code-surface`, 1px `--border-muted`, 4px radius,
 * 32px header strip, right-aligned line numbers in `--text-subtle`.
 */

import { useEffect, useRef, useState } from 'react'
import { useCopy } from './useCopy'
import { whenIdle } from '../whenIdle'

export type CodeBlockProps = {
  code: string
  lang: string
  /** Shown in the header strip; the language tag when absent (§7.1). */
  filePath?: string
}

/** Shiki loads a fixed, small language set — see the lazy loader below. */
export const HIGHLIGHT_LANGUAGES = ['text', 'python', 'ts', 'js', 'json', 'yaml', 'sh', 'bash', 'sql', 'diff'] as const

type Highlighter = {
  codeToHtml: (code: string, options: { lang: string; theme: string }) => string
}

let highlighterPromise: Promise<Highlighter | null> | null = null

/**
 * Load Shiki on demand. Fine-grained (`createHighlighter` + an explicit
 * language list) rather than the full bundle, so the lazy chunk stays small.
 * A failure is not fatal: the code renders unhighlighted.
 */
export function loadHighlighter(): Promise<Highlighter | null> {
  highlighterPromise ??= import('shiki')
    .then((shiki) =>
      shiki.createHighlighter({
        themes: ['github-dark'],
        langs: [...HIGHLIGHT_LANGUAGES],
      }),
    )
    .then((highlighter) => highlighter as unknown as Highlighter)
    .catch(() => null)
  return highlighterPromise
}

/** Test seam: drop the cached highlighter. */
export function resetHighlighter(): void {
  highlighterPromise = null
}

function normaliseLang(lang: string): string {
  const lower = lang.trim().toLowerCase()
  if (lower === '' || lower === 'plain' || lower === 'txt') return 'text'
  return (HIGHLIGHT_LANGUAGES as readonly string[]).includes(lower) ? lower : 'text'
}

export function CodeBlock({ code, lang, filePath }: CodeBlockProps): JSX.Element {
  const [html, setHtml] = useState<string | null>(null)
  const { copied, copy } = useCopy(code)
  const token = useRef(0)

  useEffect(() => {
    let cancelled = false
    const mine = ++token.current
    // M4.6: deferred to an idle window, for the same reason as mermaid. The
    // plain code is already on screen by this point — that is the whole point of
    // the progressive highlight — so the highlighter is genuinely non-critical
    // work competing with React's first commit.
    const cancel = whenIdle(() => {
      void loadHighlighter().then((highlighter) => {
        if (cancelled || highlighter === null) return
        const rendered = highlighter.codeToHtml(code, { lang: normaliseLang(lang), theme: 'github-dark' })
        if (mine === token.current) setHtml(rendered)
      })
    })
    return () => {
      cancelled = true
      cancel()
    }
  }, [code, lang])

  const lineCount = code.split('\n').length
  const scrollerLabel = `Code: ${filePath ?? (lang || 'text')}`

  return (
    <figure className="code-block" data-lang={lang}>
      <figcaption className="code-header">
        <span className="code-header__path">{filePath ?? (lang || 'text')}</span>
        <button type="button" className="code-copy" onClick={() => void copy()} aria-live="polite">
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </figcaption>

      <div className="code-body">
        <div className="code-lines" aria-hidden="true">
          {Array.from({ length: lineCount }, (_, index) => (
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
            <span key={index} className="code-line-number">
              {index + 1}
            </span>
          ))}
        </div>
        {/*
          M4.3: the scroller is a `role="region"` with a name and a tab stop,
          exactly as M2 did for the table scroller — and the reason is the same
          one, noticed four milestones later. A horizontally scrollable box with
          no focusable child and no tab stop is unreachable by keyboard: a reader
          who cannot pan it cannot read the right-hand end of a wide line. axe's
          `scrollable-region-focusable` reports it at 375px, where a code line
          actually overflows, and not at 1440px, where it does not — so the
          finding only exists on the width nobody had scanned.

          The name is derived from the document, the same way the table's is from
          its own header row, so two code blocks in a section are distinguishable
          and nothing is invented. `Code:` rather than the bare path, because
          §6.5 turns a path in prose into an entity chip and an unprefixed
          "src/pipeline/parse.ts" would announce as if it were the only one.
        */}
        <div className="code-content" tabIndex={0} role="region" aria-label={scrollerLabel}>
          {html === null ? (
            <pre className="code-plain">
              <code>{code}</code>
            </pre>
          ) : (
            // Shiki output is generated from the same string we just parsed and
            // escapes every character itself; it is not user-authored markup.
            <div className="code-highlighted" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
      </div>
    </figure>
  )
}
