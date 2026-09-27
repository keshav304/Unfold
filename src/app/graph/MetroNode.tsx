/**
 * The metro node (spec §7.6, DESIGN.md "Interactive Metro-Map Nodes").
 *
 * The styling is CSS, not inline: the shell is `--surface-1` with a 1.5px
 * `--border-strong` stroke, the active state is a `--primary` stroke over a
 * cyan→indigo gradient wash, and the 1px inner hairline is `--elevation-inner`
 * (tokens.css already carries all three as decisions). Inline styles here would
 * mean hex values outside `tokens.css`, which the genericity guard fails in CI.
 *
 * The node is a `<div>`, not a `<button>`. React Flow puts `tabindex="0"`,
 * `role="group"` and `aria-roledescription="node"` on its own wrapper and owns
 * the key handling; a nested button would fight the drag handler for clicks and
 * would put a second, differently-behaved focusable in the tab order. §9 asks
 * for *focusable labelled nodes* — the wrapper satisfies that, and M3.7 proves
 * the real tab order in a browser rather than asserting attributes in jsdom.
 */

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import type { GraphNode } from '../../pipeline/dsl/types'

export type MetroNodeData = {
  /** The document's own node, verbatim. The view never rewrites a label. */
  node: GraphNode
  /** True when this node's id resolves to a section (see `graph-targets.ts`). */
  hasSection: boolean
}

export function MetroNode({ data, selected }: NodeProps): JSX.Element {
  const { node, hasSection } = data as unknown as MetroNodeData
  return (
    <div
      className="metro-node"
      data-selected={selected ? 'true' : 'false'}
      data-resolves={hasSection ? 'true' : 'false'}
    >
      {/* Edges attach to the node's sides, which is what makes the tracks read
          as a metro line rather than as arrows floating between boxes. */}
      <Handle type="target" position={Position.Left} className="metro-handle" />
      <span className="metro-node__label t-body-sm">{node.label}</span>
      {node.sub === undefined ? null : (
        <span className="metro-node__sub t-code-sm">{node.sub}</span>
      )}
      <Handle type="source" position={Position.Right} className="metro-handle" />
    </div>
  )
}

/**
 * Memoised on the props that change.
 *
 * React Flow re-renders every node on any store change — a drag, a selection, a
 * viewport tick — and a graph is the one view where a reader will drag. The
 * data object is rebuilt only when the document's spec changes, so identity is a
 * sound comparison here and a sound one in `GraphView`.
 */
export const MetroNodeMemo = memo(MetroNode)