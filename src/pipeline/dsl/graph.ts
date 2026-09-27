/**
 * `graph` DSL (spec §6.7). Frozen grammar:
 *
 *   nodes:
 *     id: Label [| subtitle]
 *   edges:
 *     a -> b [| label]
 *     a -.-> b
 *
 * Any deviation throws `DslParseError`, which the caller degrades to a plain
 * code block. This function never throws anything else.
 */

import { DslParseError, type GraphEdge, type GraphNode, type GraphSpec } from './types'

const NODE_LINE = /^([A-Za-z0-9_.-]+):\s*(.+)$/
const EDGE_LINE = /^([A-Za-z0-9_.-]+)\s*(-\.->|->)\s*([A-Za-z0-9_.-]+)(?:\s*\|\s*(.+))?$/

type Section = 'nodes' | 'edges' | null

function splitLabel(raw: string): { label: string; sub?: string } {
  const parts = raw.split('|')
  const label = (parts[0] ?? '').trim()
  const sub = parts
    .slice(1)
    .join('|')
    .trim()
  if (label === '') throw new DslParseError('node label is empty')
  return sub === '' ? { label } : { label, sub }
}

export function parseGraph(code: string): GraphSpec {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const nodeIds = new Set<string>()
  let section: Section = null
  let sawSection = false
  let sawEdge = false

  const lines = code.split(/\r?\n/)

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) return

    if (/^nodes\s*:$/.test(line)) {
      section = 'nodes'
      sawSection = true
      return
    }
    if (/^edges\s*:$/.test(line)) {
      section = 'edges'
      sawSection = true
      return
    }

    if (section === null) {
      throw new DslParseError('content before the first `nodes:` or `edges:` header', lineNumber)
    }

    if (section === 'nodes') {
      const match = NODE_LINE.exec(line)
      if (!match) throw new DslParseError(`malformed node line: ${line}`, lineNumber)
      const id = match[1] as string
      if (nodeIds.has(id)) throw new DslParseError(`duplicate node id: ${id}`, lineNumber)
      const { label, sub } = splitLabel(match[2] as string)
      nodeIds.add(id)
      nodes.push(sub === undefined ? { id, label } : { id, label, sub })
      return
    }

    // section === 'edges'
    sawEdge = true
    const match = EDGE_LINE.exec(line)
    if (!match) throw new DslParseError(`malformed edge line: ${line}`, lineNumber)
    const from = match[1] as string
    const to = match[3] as string
    if (!nodeIds.has(from)) throw new DslParseError(`edge references unknown node: ${from}`, lineNumber)
    if (!nodeIds.has(to)) throw new DslParseError(`edge references unknown node: ${to}`, lineNumber)
    if (from === to) throw new DslParseError(`self-edge is not part of the grammar: ${from}`, lineNumber)
    const rawLabel = (match[4] ?? '').trim()
    const edge: GraphEdge =
      match[2] === '-.->'
        ? rawLabel === ''
          ? { from, to, dashed: true }
          : { from, to, label: rawLabel, dashed: true }
        : rawLabel === ''
          ? { from, to }
          : { from, to, label: rawLabel }
    edges.push(edge)
  })

  if (!sawSection) throw new DslParseError('block has no `nodes:` or `edges:` section')
  if (nodes.length === 0) throw new DslParseError('block declares no nodes')
  if (sawEdge && edges.length === 0) throw new DslParseError('`edges:` section is empty')

  return { nodes, edges }
}
