/**
 * Mermaid → a lazy-rendered diagram (spec §4, §7). The library is ~1MB, so it
 * is a dynamic import: the reader renders the source first and swaps in the SVG
 * when mermaid resolves. Dark theme only in v1 (§7.9), so no re-render on theme
 * change is needed.
 */

import { useEffect, useRef, useState } from 'react'

export type MermaidProps = { code: string }

type MermaidApi = { render: (id: string, code: string) => Promise<{ svg: string }> }

let mermaidPromise: Promise<MermaidApi | null> | null = null

export function loadMermaid(): Promise<MermaidApi | null> {
  mermaidPromise ??= import('mermaid')
    .then((mod) => {
      const mermaid = mod.default
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'strict',
        fontFamily: 'var(--font-mono)',
      })
      return mermaid as unknown as MermaidApi
    })
    .catch(() => null)
  return mermaidPromise
}

/** Test seam: drop the cached mermaid instance. */
export function resetMermaid(): void {
  mermaidPromise = null
}

let counter = 0

export function Mermaid({ code }: MermaidProps): JSX.Element {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const id = useRef(`mermaid-${++counter}`)

  useEffect(() => {
    let cancelled = false
    void loadMermaid().then(async (mermaid) => {
      if (cancelled) return
      if (mermaid === null) {
        setFailed(true)
        return
      }
      try {
        const result = await mermaid.render(id.current, code)
        if (!cancelled) setSvg(result.svg)
      } catch {
        // A diagram the library cannot draw is shown as source, never dropped.
        if (!cancelled) setFailed(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [code])

  if (svg !== null) {
    return (
      <figure className="mermaid" data-theme="dark">
        {/* Mermaid generates this SVG from the fenced source and escapes text. */}
        <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      </figure>
    )
  }

  return (
    <figure className="mermaid mermaid--pending" data-state={failed ? 'failed' : 'loading'}>
      {failed ? (
        <pre className="mermaid-fallback">
          <code>{code}</code>
        </pre>
      ) : (
        <span className="visually-hidden">Loading diagram…</span>
      )}
    </figure>
  )
}
