/**
 * M3.1 — the graph layout.
 *
 * The layout is a pure function precisely so it can be tested here rather than
 * eyeballed in a browser: every claim below is about geometry the reader would
 * otherwise have to squint at a screenshot to check.
 *
 * The cases that matter are the awkward ones, because those are where a layout
 * algorithm quietly produces a graph nobody can read: a cycle (which the §6.7
 * grammar permits and the kitchen-sink fixture contains), a disconnected island,
 * and a wide branch.
 */

import { describe, expect, it } from 'vitest'
import {
  COLUMN_GAP,
  NODE_HEIGHT,
  NODE_WIDTH,
  layoutBounds,
  layoutGraph,
} from '../app/graph/layout'
import { parseFixture } from './fixtures'
import type { GraphSpec } from '../pipeline/dsl/types'

const spec = (nodes: [string, string][], edges: [string, string][]): GraphSpec => ({
  nodes: nodes.map(([id, label]) => ({ id, label })),
  edges: edges.map(([from, to]) => ({ from, to })),
})

const columnOf = (graph: GraphSpec, id: string): number =>
  layoutGraph(graph).find((node) => node.id === id)?.column ?? -1

describe('M3.1 a chain lays out as one straight line', () => {
  const chain = spec(
    [
      ['a', 'A'],
      ['b', 'B'],
      ['c', 'C'],
    ],
    [
      ['a', 'b'],
      ['b', 'c'],
    ],
  )

  it('each node is one column right of its predecessor', () => {
    expect(columnOf(chain, 'a')).toBe(0)
    expect(columnOf(chain, 'b')).toBe(1)
    expect(columnOf(chain, 'c')).toBe(2)
  })

  it('the nodes are evenly spaced by the column pitch', () => {
    const placed = layoutGraph(chain)
    expect(placed[1]?.x).toBe((placed[0]?.x ?? 0) + NODE_WIDTH + COLUMN_GAP)
  })

  it('and a single-column chain is vertically centred on the map axis', () => {
    // A chain that hugged the top edge would read as a list, not a diagram.
    for (const node of layoutGraph(chain)) expect(node.y).toBe(0)
  })
})

describe('M3.1 a branch stacks its column', () => {
  const branch = spec(
    [
      ['root', 'Root'],
      ['left', 'Left'],
      ['right', 'Right'],
    ],
    [
      ['root', 'left'],
      ['root', 'right'],
    ],
  )

  it('both children share a column', () => {
    expect(columnOf(branch, 'left')).toBe(1)
    expect(columnOf(branch, 'right')).toBe(1)
  })

  it('and they do not overlap', () => {
    const [left, right] = layoutGraph(branch).filter((node) => node.column === 1)
    expect(Math.abs((left?.y ?? 0) - (right?.y ?? 0))).toBeGreaterThanOrEqual(NODE_HEIGHT)
  })
})

describe('M3.1 a cycle is broken, not just survived', () => {
  const kitchen = parseFixture('kitchen-sink').doc.graph?.spec as GraphSpec

  it('terminates on the kitchen-sink graph, which has a -.-> back edge', () => {
    // `planner -.-> shell` closes a loop over four nodes. A recursive longest-path
    // walk without a cycle guard never returns on this, and the whole view hangs
    // on first paint.
    expect(layoutGraph(kitchen)).toHaveLength(4)
  })

  it('and lays the loop out as a line, not as a stack', () => {
    // This is the assertion the first version lacked. The on-stack guard made
    // the walk terminate by giving every node of a cycle the *same* column, so
    // the four-node loop rendered as one vertical stack with the tracks looping
    // around each box — laid out, but not a map. Termination was green; the
    // screenshot was not.
    const placed = layoutGraph(kitchen)
    const columns = placed.map((node) => node.column).sort((a, b) => a - b)
    expect(columns).toEqual([0, 1, 2, 3])
  })

  it('the back edge becomes the return curve, not a shortcut through the middle', () => {
    // The chain shell → ingest → store → planner is the map; the dashed edge
    // planner → shell is a return path, and it must be the edge that wraps.
    const placed = layoutGraph(kitchen)
    const at = (id: string): number => placed.find((node) => node.id === id)?.column ?? -1
    expect(at('shell')).toBe(0)
    expect(at('ingest')).toBe(1)
    expect(at('store')).toBe(2)
    expect(at('planner')).toBe(3)
  })

  it('a self-referential two-node cycle also terminates', () => {
    const loop = spec(
      [
        ['a', 'A'],
        ['b', 'B'],
      ],
      [
        ['a', 'b'],
        ['b', 'a'],
      ],
    )
    expect(layoutGraph(loop)).toHaveLength(2)
    expect(layoutGraph(loop).map((node) => node.column).sort()).toEqual([0, 1])
  })

  it('a long chain does not overflow the stack', () => {
    // 5000 nodes is past anything a person writes and inside what a generator
    // emits. The walk is iterative precisely so this is a number, not a crash.
    const ids = Array.from({ length: 5000 }, (_, i) => [`n${i}`, `N${i}`] as [string, string])
    const edges = ids.slice(1).map(([id], index): [string, string] => [ids[index]?.[0] ?? '', id])
    const placed = layoutGraph(spec(ids, edges))
    expect(placed).toHaveLength(5000)
    expect(Math.max(...placed.map((node) => node.column))).toBe(4999)
  })
})

describe('M3.1 nothing the document declared goes missing', () => {
  it('an isolated node is placed, not dropped', () => {
    // §6.7 allows a graph whose `edges:` section is empty. The node is still a
    // node the reader must be able to find.
    const islands = spec(
      [
        ['a', 'A'],
        ['lonely', 'Lonely'],
      ],
      [],
    )
    const placed = layoutGraph(islands)
    expect(placed).toHaveLength(2)
    expect(columnOf(islands, 'lonely')).toBe(0)
  })

  it('a node with no position in the layout map still appears', () => {
    // Defensive: `layoutGraph` and the node builder must not disagree about ids.
    const placed = layoutGraph(spec([['only', 'Only']], []))
    expect(placed.map((node) => node.id)).toEqual(['only'])
  })
})

describe('M3.1 the layout is deterministic', () => {
  const { spec: kitchen } = parseFixture('kitchen-sink').doc.graph ?? { spec: undefined } as never

  it('the same spec produces byte-identical positions every time', () => {
    // A graph that reshuffles between visits is unreadable, and a non-deterministic
    // layout also makes every screenshot unstable.
    const a = layoutGraph(kitchen as GraphSpec)
    const b = layoutGraph(kitchen as GraphSpec)
    expect(a).toEqual(b)
  })

  it('and the derived map is just as stable', () => {
    const derived = parseFixture('crosslinked').doc.graph
    expect(derived?.derived).toBe(true)
    expect(layoutGraph(derived?.spec as GraphSpec)).toEqual(layoutGraph(derived?.spec as GraphSpec))
  })
})

describe('M3.1 the bounds cover every node', () => {
  it('encloses the whole placement', () => {
    const placed = layoutGraph(
      spec(
        [
          ['a', 'A'],
          ['b', 'B'],
          ['c', 'C'],
        ],
        [
          ['a', 'b'],
          ['a', 'c'],
        ],
      ),
    )
    const bounds = layoutBounds(placed)
    for (const node of placed) {
      expect(node.x).toBeGreaterThanOrEqual(bounds.minX)
      expect(node.x + NODE_WIDTH).toBeLessThanOrEqual(bounds.minX + bounds.width)
      expect(node.y).toBeGreaterThanOrEqual(bounds.minY)
    }
    expect(bounds.width).toBeGreaterThan(0)
    expect(bounds.height).toBeGreaterThan(0)
  })

  it('an empty graph still has a non-zero box, so fit-view has something to fit', () => {
    const bounds = layoutBounds([])
    expect(bounds.width).toBeGreaterThan(0)
    expect(bounds.height).toBeGreaterThan(0)
  })
})