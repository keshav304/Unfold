/**
 * A ` ```graph ` block, rendered inline in the reader as a read-only mini-canvas
 * (M4.13.1).
 *
 * The rule this block exists to obey: **one graph implementation.** The canvas
 * itself is `GraphInline`, living in the graph module, importing the same
 * layout, the same node component and the same chunk. What this file adds is
 * the two things that belong to *being a block in a document* — a Suspense
 * boundary, because the chunk is lazy and the reader must not wait for it, and
 * the link out to the full experience.
 *
 * The link is gated on `onOpenGraph`, which the shell only passes when the
 * document is graph-capable (§1.1). A document that declares a graph block is
 * graph-capable by construction, so in practice the link is there; a caller that
 * cannot offer the full view simply offers nothing, rather than offering a link
 * to an empty one.
 */

import { lazy, Suspense } from 'react'
import type { GraphSpec } from '../../pipeline/dsl/types'
import { hashFor, type Route } from '../routing'

/**
 * The workbench's chunk, and the *only* one that carries React Flow (§10).
 *
 * `React.lazy` on the module's own export rather than a second component file:
 * a separate file importing `@xyflow/react` would still share the chunk in the
 * build, but it would also create a second entry point for a library with one —
 * and `budget.test.ts`'s rule ("`xyflow` never appears in the entry chunk")
 * becomes a rule about a *file path* rather than about one obvious place.
 */
const GraphInline = lazy(() =>
  import('../graph/GraphView').then((module) => ({ default: module.GraphInline })),
)

export type GraphBlockProps = {
  spec: GraphSpec
  slugs?: ReadonlySet<string>
  /** Present only when the shell can actually show the graph view. */
  onOpenGraph?: () => void
}

export function GraphBlock({ spec, slugs, onOpenGraph }: GraphBlockProps): JSX.Element {
  return (
    <figure className="reader-graph" data-block="graph">
      <Suspense
        fallback={
          <div className="graph-inline-boot" role="status">
            <span className="visually-hidden">Loading diagram…</span>
          </div>
        }
      >
        <GraphInline spec={spec} {...(slugs === undefined ? {} : { slugs })} />
      </Suspense>
      {onOpenGraph === undefined ? null : (
        <a
          className="graph-open t-code-sm"
          href={hashFor({ name: 'graph' } satisfies Route)}
          onClick={(event) => {
            // The shell owns the route (the same split the stepper has): the
            // anchor carries the href for a real browser, the click hands the
            // navigation to the one place that knows how to change views.
            event.preventDefault()
            onOpenGraph()
          }}
        >
          <span>Open in graph view</span>
          <span aria-hidden="true">→</span>
        </a>
      )}
    </figure>
  )
}
