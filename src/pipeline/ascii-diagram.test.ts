/**
 * M4.14b — the ASCII diagram parser, against the six fixtures (§11).
 *
 * The tests here assert **what was extracted**, not that something was: the node
 * count, every node's label and grid position, every edge's source, target and
 * direction, and the labels. A test that only checked `kind === 'diagram'` would
 * pass on a parser that dropped half the boxes, which is the failure mode the
 * milestone's quality bar is written against.
 *
 * The two hostile fixtures assert the opposite property, because it is the one
 * that protects every other document: a fence that looks like a diagram and is
 * not must come back `unparseable`, so the reader keeps the terminal window it
 * had before.
 */

import { describe, expect, it } from 'vitest'
import { parseAsciiDiagram, toGrid, describeDiagram, type AsciiDiagram } from './ascii-diagram'
import { ASCII_CONNECTOR_MIN_CHARS } from './constants'
import { readFixture, parseFixture, allBlocksOf } from '../test/fixtures'

/** The fixture document's fences, in document order. */
function fixtures(): string[] {
  const source = readFixture('ascii-diagrams')
  return [...source.matchAll(/^```\n([\s\S]*?)^```$/gmu)].map((match) => match[1] as string)
}

const FENCES = fixtures()
const [flow, unicode, junctions, vertical, hostile, dangling] = FENCES as [
  string,
  string,
  string,
  string,
  string,
  string,
]

function parsed(fence: string): AsciiDiagram {
  const result = parseAsciiDiagram(fence)
  if (result.kind !== 'diagram') throw new Error('expected a diagram, got unparseable')
  return result
}

/** Every node as `label @row,col`, so a position change is one failing line. */
function shape(diagram: AsciiDiagram): string[] {
  return diagram.nodes.map((node) => `${node.label.replace(/\n/gu, ' / ')} @${node.row},${node.col}`)
}

/** Every edge as `from->to direction [label]`, in the parser's own order. */
function wires(diagram: AsciiDiagram): string[] {
  return diagram.edges.map(
    (edge) =>
      `${edge.from}->${edge.to} ${edge.direction}${edge.label === undefined ? '' : ` "${edge.label}"`}`,
  )
}

describe('M4.14a the fixture document holds six untagged fences', () => {
  it('has exactly the six fences §3 of the milestone asks for', () => {
    expect(FENCES).toHaveLength(6)
    for (const fence of FENCES) expect(fence.trim()).not.toBe('')
  })

  it('four of them are diagrams and two are not — the ratio the report prints', () => {
    const kinds = FENCES.map((fence) => parseAsciiDiagram(fence).kind)
    expect(kinds).toEqual(['diagram', 'diagram', 'diagram', 'diagram', 'unparseable', 'unparseable'])
  })
})

describe('Fixture A — vertical flow', () => {
  const diagram = parsed(flow)

  it('extracts all four boxes, with their own labels and positions', () => {
    expect(shape(diagram)).toEqual([
      'Browser @0,0',
      'Dev server @0,28',
      'API @6,0',
      'PostgreSQL @6,28',
    ])
  })

  it("keeps the author's box dimensions, taken from the source rectangle", () => {
    expect(diagram.nodes.map((node) => `${node.width}x${node.height}`)).toEqual([
      '15x3',
      '16x3',
      '15x3',
      '16x3',
    ])
  })

  it('reads all four connectors, with direction taken from each arrowhead', () => {
    expect(wires(diagram)).toEqual([
      'n1->n2 right "request client"',
      'n1->n3 down "fetch"',
      'n2->n4 down',
      'n4->n3 left "query"',
    ])
  })

  it('preserves the connector route rather than replacing it with a straight line', () => {
    // The horizontal connector is drawn from column 16 to column 26 on row 1 —
    // the source geometry, not a line between the two boxes' centres.
    const horizontal = diagram.edges.find((edge) => edge.direction === 'right')
    expect(horizontal?.path.map((point) => `${point.row},${point.col}`)).toEqual(['1,16', '1,26'])
  })

  it('attaches each label to the connector it sits beside', () => {
    // "request" is on the row of the top borders and "client" on the row of the
    // bottom ones — both beside the same horizontal arrow, which is what the
    // source says. "fetch" sits beside the left vertical drop; "query" beside the
    // right-to-left arrow.
    expect(diagram.edges.map((edge) => edge.label ?? null)).toEqual([
      'request client',
      'fetch',
      null,
      'query',
    ])
  })

  it('emits no annotation: every text run in this fence became a label', () => {
    expect(diagram.annotations).toEqual([])
  })

  it("reports the fence's own grid size", () => {
    expect(`${diagram.width}x${diagram.height}`).toBe('44x9')
  })
})

describe('Fixture B — Unicode boxes', () => {
  const diagram = parsed(unicode)

  it('normalises the box-drawing characters into the same diagram as Fixture A', () => {
    // The whole point of the Unicode row: identical semantics, different ink.
    const ascii = parsed(flow)
    expect(shape(diagram)).toEqual(shape(ascii))
    expect(wires(diagram)).toEqual(wires(ascii))
    expect(diagram.edges.map((edge) => edge.path)).toEqual(ascii.edges.map((edge) => edge.path))
  })

  it('records the charset the source used, and does not transliterate the cells', () => {
    expect(diagram.nodes.map((node) => node.charset)).toEqual(['unicode', 'unicode', 'unicode', 'unicode'])
    expect(parsed(flow).nodes.map((node) => node.charset)).toEqual(['ascii', 'ascii', 'ascii', 'ascii'])
  })

  it('reads direction from the Unicode arrowheads', () => {
    // `▶` right, `▼` down, `◀` left.
    expect(diagram.edges.map((edge) => edge.direction)).toEqual(['right', 'down', 'down', 'left'])
  })
})



describe('Fixture C — interior junctions', () => {
  const diagram = parsed(junctions)

  it('finds two boxes, not three, four or five', () => {
    // The upper box's border carries an interior `+`, and the lower box has an
    // interior wall. Neither one is a node split: a junction is an attachment
    // point, and a wall is a wall.
    expect(shape(diagram)).toEqual(['Router @0,0', 'Proxy    Cache @7,0'])
  })

  it('lets a connector leave from the interior junction of a border', () => {
    expect(wires(diagram)).toEqual(['n1->n2 down'])
    // The connector starts on the row *below* the border it attaches to, at the
    // junction's own column — column 12 in the source.
    const edge = diagram.edges[0]
    expect(edge?.path.map((point) => `${point.row},${point.col}`)).toEqual(['4,12', '6,12'])
  })

  it("keeps the box a wall divides as one node, with the author's own words", () => {
    // The wall cell reads as a space, so no `|` ends up in the middle of a word.
    expect(diagram.nodes[1]?.label).toBe('Proxy    Cache')
  })
})

describe('Fixture D — vertical arrow', () => {
  const diagram = parsed(vertical)

  it("determines 'down' from the `v`, not from the boxes' order", () => {
    expect(shape(diagram)).toEqual(['Ingest @0,0', 'Publish @6,0'])
    expect(wires(diagram)).toEqual(['n1->n2 down "buffer"'])
  })

  it('attaches the mid-line label to the connector it sits beside', () => {
    const edge = diagram.edges[0]
    expect(edge?.label).toBe('buffer')
    expect(diagram.annotations).toEqual([])
    // The route is the drawn one: the three `|`/`v` cells, reduced to their two
    // ends because the middle is collinear.
    expect(edge?.path.map((point) => `${point.row},${point.col}`)).toEqual(['3,8', '5,8'])
  })
})

describe('Fixture E — hostile prose is never promoted into a diagram', () => {
  it('returns unparseable', () => {
    expect(parseAsciiDiagram(hostile)).toEqual({ kind: 'unparseable' })
  })

  it('and does so because there are no boxes, not by accident', () => {
    // The fence really does contain the characters that could be mistaken for
    // structure: `<`, `>`, `|`, `-`. It contains no box.
    expect(hostile).toContain('<')
    expect(hostile).toContain('>')
    expect(hostile).toContain('|')
    const junctions = toGrid(hostile).roles.flat().filter((role) => role === '+')
    expect(junctions).toHaveLength(0)
  })
})

describe('Fixture F — a dangling connector is dropped, never completed', () => {
  it('returns unparseable even though it carries two boxes', () => {
    expect(parseAsciiDiagram(dangling)).toEqual({ kind: 'unparseable' })
  })

  it('is refused by the confidence gate, and would parse if the arrow landed', () => {
    // The proof that rejection is about the missing edge rather than about the
    // boxes: the same two boxes with a connector that actually reaches one
    // another parse, and the nearby-but-unlinked version does not.
    const connected = [
      '+-------------+          +-------------+',
      '|   Producer  | -------> |   Consumer  |',
      '+-------------+          +-------------+',
    ].join('\n')
    const result = parseAsciiDiagram(connected)
    expect(result.kind).toBe('diagram')
    if (result.kind !== 'diagram') return
    expect(shape(result)).toEqual(['Producer @0,0', 'Consumer @0,25'])
    expect(wires(result)).toEqual(['n1->n2 right'])
  })
})

describe('M4.14b the minimum connector size keeps prose out of the graph', () => {
  const stray = ['+---+    +---+', '| A |  | | B |', '+---+    +---+'].join('\n')
  const threeCharacters = ['+---+     +---+', '| A | --> | B |', '+---+     +---+'].join('\n')

  it('drops a one-character connector, so a stray `|` between two boxes is not an edge', () => {
    // Two boxes either side of a single pipe, which is what a badly drawn
    // diagram and a badly drawn table row have in common.
    expect(ASCII_CONNECTOR_MIN_CHARS).toBe(3)
    expect(parseAsciiDiagram(stray)).toEqual({ kind: 'unparseable' })
  })

  it('and accepts a three-character connector, so the rule is a threshold and not a refusal', () => {
    expect(wires(parsed(threeCharacters))).toEqual(['n1->n2 right'])
  })
})

describe('M4.14b the confidence gate needs two boxes and a box-to-box edge', () => {
  it('refuses a fence with a single box, however well the connector is drawn', () => {
    const one = ['+---+', '| A |', '+---+', '  |', '  |', '  v'].join('\n')
    expect(parseAsciiDiagram(one)).toEqual({ kind: 'unparseable' })
  })

  it('refuses a fence with two boxes and no edge between them', () => {
    const none = ['+---+    +---+', '| A |    | B |', '+---+    +---+'].join('\n')
    expect(parseAsciiDiagram(none)).toEqual({ kind: 'unparseable' })
  })
})

describe('M4.14b a gapped connector keeps its dashed semantics', () => {
  const solid = ['+---+          +---+', '| A | -------> | B |', '+---+          +---+'].join('\n')
  const gapped = ['+---+            +---+', '| A | - - - - >  | B |', '+---+            +---+'].join('\n')

  it('marks the connector that was drawn with gaps as dashed', () => {
    const edge = parsed(gapped).edges[0]
    expect(edge?.dashed).toBe(true)
    expect(wires(parsed(gapped))).toEqual(['n1->n2 right'])
  })

  it('never fabricates a dash the source did not draw', () => {
    expect(parsed(solid).edges[0]?.dashed).toBe(false)
  })
})

describe('M4.14b direction comes from the arrowhead, in all four directions', () => {
  const upward = [
    '+-----------+',
    '|  Publish  |',
    '+-----------+',
    '      ^',
    '      |',
    '      |',
    '+-----------+',
    '|   Ingest  |',
    '+-----------+',
  ].join('\n')

  it('reads a bottom-to-top connector as `up`, with the target above it', () => {
    expect(wires(parsed(upward))).toEqual(['n2->n1 up'])
  })
})



describe("M4.14b the parser is pure, and the coordinates are the source's", () => {
  it('returns the same diagram for the same fence', () => {
    expect(parseAsciiDiagram(flow)).toEqual(parsed(flow))
  })

  it('never trims a line horizontally, so a column offset survives', () => {
    const grid = toGrid(flow)
    expect(`${grid.width}x${grid.height}`).toBe('44x9')
    // The right-hand box's left border is column 28 in the source and column 28
    // here. Re-indenting would move every node the author placed.
    expect(grid.raw[1]?.[28]).toBe('|')
    expect(grid.roles[1]?.[28]).toBe('|')
  })

  it('drops only blank leading and trailing rows, because they are not the drawing', () => {
    const grid = toGrid('\n\n  +---+\n  | A |\n  +---+\n\n\n')
    expect(grid.height).toBe(3)
    expect(grid.raw[0]?.[2]).toBe('+')
  })

  it('normalises Unicode roles without moving a single cell', () => {
    const grid = toGrid(unicode)
    expect(grid.raw[0]?.[0]).toBe('┌')
    expect(grid.roles[0]?.[0]).toBe('+')
    expect(grid.raw[5]?.[7]).toBe('▼')
    expect(grid.roles[5]?.[7]).toBe('v')
  })
})

describe('M4.14b the accessible summary is generated from the parsed graph', () => {
  it('reads a single chain as the chain the picture draws', () => {
    expect(describeDiagram(parsed(vertical))).toBe('Diagram: Ingest → Publish')
  })

  it('reads a fan as its edges rather than as a chain it is not', () => {
    expect(describeDiagram(parsed(flow))).toBe(
      'Diagram: Browser → Dev server; Browser → API; Dev server → PostgreSQL; PostgreSQL → API',
    )
  })

  it('names a box with no connector too, because it is in the picture', () => {
    const withIsolated = [
      '+---+          +---+',
      '| A | -------> | B |',
      '+---+          +---+',
      '',
      '+---+',
      '| C |',
      '+---+',
    ].join('\n')
    const diagram = parsed(withIsolated)
    expect(shape(diagram)).toEqual(['A @0,0', 'B @0,15', 'C @4,0'])
    expect(describeDiagram(diagram)).toBe('Diagram: A → B; C')
  })
})

describe('M4.14b the two-row drop, and why the exception to the minimum is safe', () => {
  const twoRow = ['+---+', '| A |', '+---+', '  |', '  v', '+---+', '| B |', '+---+'].join('\n')

  it('reads a `|` above a `v` as one connector, at two characters', () => {
    // This is the shape the bundled demo document draws its vertical arrows in,
    // and it is two cells long. A minimum that discarded it would throw away half
    // of a real diagram.
    const result = parseAsciiDiagram(twoRow)
    expect(result.kind).toBe('diagram')
    if (result.kind !== 'diagram') return
    expect(wires(result)).toEqual(['n1->n2 down'])
  })

  it('and still drops a two-character `->` that is only prose', () => {
    // The same length, no box behind either end. The exception buys the drop; it
    // does not buy a shortcut past resolution.
    const prose = [
      '+---+                 +---+',
      '| A |   prose -> here | B |',
      '+---+                 +---+',
    ].join('\n')
    expect(parseAsciiDiagram(prose)).toEqual({ kind: 'unparseable' })
  })

  it('which is why the demo document keeps all four of its arrows', () => {
    // The genericity check with a number on it: the bundled document is not a
    // fixture written for the parser, and every arrow in its diagram survives.
    const { doc } = parseFixture('kitchen-sink')
    const terminal = allBlocksOf(doc).find(
      (block): block is Extract<typeof block, { kind: 'terminal' }> => block.kind === 'terminal',
    )
    expect(terminal).toBeDefined()
    const result = parseAsciiDiagram(terminal?.code ?? '')
    expect(result.kind).toBe('diagram')
    if (result.kind !== 'diagram') return
    expect(shape(result)).toEqual([
      'Client shell @0,0',
      'Ingest worker @0,28',
      'Query planner @5,0',
      'Index store @5,28',
    ])
    expect(wires(result)).toEqual([
      'n1->n2 right',
      'n1->n3 down',
      'n2->n4 down',
      'n4->n3 left',
    ])
  })
})

