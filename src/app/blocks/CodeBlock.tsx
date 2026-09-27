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
    void loadHighlighter().then((highlighter) => {
      if (cancelled || highlighter === null) return
      const rendered = highlighter.codeToHtml(code, { lang: normaliseLang(lang), theme: 'github-dark' })
      if (mine === token.current) setHtml(rendered)
    })
    return () => {
      cancelled = true
    }
  }, [code, lang])

  const lineCount = code.split('\n').length

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
        <div className="code-content">
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
