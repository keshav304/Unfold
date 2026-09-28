/**
 * ASCII diagram parsing (spec §6.9, M4.14b). Pure and dependency-free: a fence
 * string in, a semantic diagram or `unparseable` out. No DOM, no layout engine,
 * no React.
 *
 * ## The one design decision everything else follows from
 *
 * **The ASCII *is* the layout.** A document author who draws boxes writes them
 * where they are meant to appear, so the parser extracts the author's own
 * arrangement — boxes, connectors, arrowheads, labels and their grid
 * coordinates — rather than deriving a graph and re-laying it out. Node
 * positions are read, never computed. Nothing here knows what dagre is.
 *
 * ## Why it is this conservative
 *
 * The product promise is that a diagram-looking fence renders as a diagram, and
 * the way to break that promise is to promote prose into a diagram. So:
 *
 *   - a box is a *closed* rectangle whose four sides are actually drawn;
 *   - a connector is a connected component of at least
 *     `ASCII_CONNECTOR_MIN_CHARS` characters — an isolated `<` or `|` in a
 *     sentence is not an edge;
 *   - a connector's direction comes from its arrowhead, and a connector with no
 *     arrowhead, two arrowheads, or a branch is dropped rather than guessed;
 *   - an edge needs **both** ends to resolve to a real box, so a dangling
 *     connector is dropped and its destination is never invented;
 *   - the confidence gate (`ASCII_DIAGRAM_MIN_NODES` + `ASCII_DIAGRAM_MIN_EDGES`)
 *     rejects the whole fence if what is left is not a box-to-box graph.
 *
 * A rejected fence is not a failure. It is the §1.3 fallback: the layer above
 * renders the existing terminal window, which is the honest presentation of a
 * fence this parser declined to interpret.
 */

import {
  ASCII_ATTACH_MAX_DISTANCE,
  ASCII_CONNECTOR_MIN_CHARS,
  ASCII_DIAGRAM_MIN_EDGES,
  ASCII_DIAGRAM_MIN_NODES,
  ASCII_LABEL_RADIUS,
} from './constants'

/** Which way a connector runs, taken from its arrowhead. */
export type DiagramDirection = 'right' | 'left' | 'down' | 'up'

/** One cell of the source grid, 0-based from the fence's top-left. */
export type DiagramPoint = { row: number; col: number }

/** How a box was drawn in the source. Kept for the record, never for layout. */
export type DiagramCharset = 'ascii' | 'unicode'

export type DiagramNode = {
  /** Stable within one diagram: `n1`, `n2`, … in reading order. */
  id: string
  /** The box's text, lines joined with `\n`, common indentation trimmed. */
  label: string
  /**
   * The box's interior lines — one per interior row, leading spaces kept.
   *
   * `label` is the *semantic* text (trimmed, for summaries); this is the
   * *drawn* text, aligned to the grid the author wrote, which is why the renderer
   * uses it. A label's indentation inside its box is the author's alignment, and
   * a monospace face reproduces it exactly.
   */
  lines: string[]
  /** The box's own grid rectangle, borders inclusive. */
  row: number
  col: number
  width: number
  height: number
  charset: DiagramCharset
  /**
   * The grid row of `lines[0]`.
   *
   * Leading and trailing blank interior rows are dropped from `lines` — they are
   * not text — which means index 0 is not necessarily the first interior row.
   * The offset is carried here so the renderer can put line *i* back on the row
   * the author drew it on instead of stacking labels at the top of a box.
   */
  textRow: number
}

export type DiagramEdge = {
  from: string
  to: string
  direction: DiagramDirection
  /** True when the source connector was drawn with gaps (a dashed connector). */
  dashed: boolean
  /** Every label on this connector, in document order. */
  labelMarks?: DiagramAnnotation[]
  /**
   * The same labels as one string, for summaries and assertions. `undefined`
   * when the connector carries none — a connector is not a labelled connector
   * unless the source said so.
   */
  label?: string
  /**
   * The two cells of the boxes' own borders this route meets — the `from` box's
   * on the way out, the `to` box's on the way in.
   *
   * They are in `path` already; they are *also* recorded here because they are
   * the route's two attachment points, and a route that starts and ends
   * *between* the connector and the box it connects is a route with a gap at
   * each end. A renderer can close that gap exactly, from the record, without
   * re-deriving which cell is the border.
   */
  attach: { from: DiagramPoint; to: DiagramPoint }
  /**
   * The original route, source end first, in grid coordinates.
   * The path is the source geometry — collinear points removed, never replaced
   * with a straight line between the two boxes.
   */
  path: DiagramPoint[]
}

/** Free text that belongs to no box and no connector, kept at its own position. */
export type DiagramAnnotation = { text: string; row: number; col: number }

export type AsciiDiagram = {
  kind: 'diagram'
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  annotations: DiagramAnnotation[]
  /** The fence's size, in cells. Half the parser's coordinate system. */
  width: number
  height: number
}

/** The parser's only two answers. There is no partial success. */
export type AsciiDiagramResult = AsciiDiagram | { kind: 'unparseable' }

export const UNPARSEABLE: AsciiDiagramResult = { kind: 'unparseable' }


/* ------------------------------------------------------------------ *
 * The character grid
 * ------------------------------------------------------------------ */

const ROLE_JUNCTION = '+'
const ROLE_HORIZONTAL = '-'
const ROLE_VERTICAL = '|'

/** The four arrowheads, and the direction each one points. */
const ARROWHEADS: Record<string, DiagramDirection> = {
  '>': 'right',
  '<': 'left',
  v: 'down',
  '^': 'up',
}

const CONNECTOR_ROLES = new Set(['-', '|', '>', '<', 'v', '^'])

/**
 * Unicode box-drawing → the ASCII role it plays. Deliberately a *role* map and
 * not a transliteration: raw cells are kept as written (a `┌` stays a `┌`) and
 * only the structural reading is normalised. Coordinates are untouched — one
 * character is one cell either way.
 *
 * `┼ ├ ┤ ┬ ┴` map to the same junction role as `+` because that is exactly what
 * they are: an interior attachment point on a border, which this parser must not
 * read as a split between two nodes.
 */
const BOX_DRAWING_ROLES: Record<string, string> = {
  '┌': ROLE_JUNCTION, '┐': ROLE_JUNCTION, '└': ROLE_JUNCTION, '┘': ROLE_JUNCTION,
  '┏': ROLE_JUNCTION, '┓': ROLE_JUNCTION, '┗': ROLE_JUNCTION, '┛': ROLE_JUNCTION,
  '╔': ROLE_JUNCTION, '╗': ROLE_JUNCTION, '╚': ROLE_JUNCTION, '╝': ROLE_JUNCTION,
  '╭': ROLE_JUNCTION, '╮': ROLE_JUNCTION, '╯': ROLE_JUNCTION, '╰': ROLE_JUNCTION,
  '├': ROLE_JUNCTION, '┤': ROLE_JUNCTION, '┬': ROLE_JUNCTION, '┴': ROLE_JUNCTION,
  '┼': ROLE_JUNCTION, '╞': ROLE_JUNCTION, '╡': ROLE_JUNCTION, '╥': ROLE_JUNCTION,
  '╨': ROLE_JUNCTION, '╪': ROLE_JUNCTION, '╠': ROLE_JUNCTION, '╣': ROLE_JUNCTION,
  '╦': ROLE_JUNCTION, '╩': ROLE_JUNCTION, '╬': ROLE_JUNCTION,
  '─': ROLE_HORIZONTAL, '━': ROLE_HORIZONTAL, '═': ROLE_HORIZONTAL,
  '╌': ROLE_HORIZONTAL, '┄': ROLE_HORIZONTAL, '┈': ROLE_HORIZONTAL,
  '╴': ROLE_HORIZONTAL, '╶': ROLE_HORIZONTAL,
  '│': ROLE_VERTICAL, '┃': ROLE_VERTICAL, '║': ROLE_VERTICAL,
  '┆': ROLE_VERTICAL, '┊': ROLE_VERTICAL, '╷': ROLE_VERTICAL, '╵': ROLE_VERTICAL,
  '→': '>', '▶': '>', '►': '>',
  '←': '<', '◀': '<', '◄': '<',
  '↓': 'v', '▼': 'v',
  '↑': '^', '▲': '^',
}

/** The Unicode box-drawing range, for `charset` reporting. */
const BOX_DRAWING = /[\u2500-\u257f\u2580-\u259f]/u

type Grid = {
  /** Raw cells, one code point per cell, rows padded to a rectangle. */
  raw: string[][]
  /** Structural role per cell: `+`, `-`, `|`, an arrowhead, or the raw char. */
  roles: string[][]
  width: number
  height: number
}

/**
 * The fence as a character grid.
 *
 * Only *blank* leading and trailing lines are dropped — they are not part of the
 * drawing and would shift every coordinate. No line is ever trimmed
 * horizontally: a label's column offset is the author's alignment, and it is
 * what makes the rendered diagram look like the one in the source.
 *
 * Trimming is deliberately symmetric about nothing: the grid is a rectangle of
 * cells, so a connector that reaches the last column is still attachable.
 */
export function toGrid(fenceText: string): Grid {
  const rows = fenceText.replace(/\r\n?/gu, '\n').split('\n').map((line) => [...line])
  const blank = (line: string[]): boolean => line.every((cell) => cell.trim() === '')
  while (rows.length > 0 && blank(rows[0] as string[])) rows.shift()
  while (rows.length > 0 && blank(rows[rows.length - 1] as string[])) rows.pop()

  const width = rows.reduce((max, line) => Math.max(max, line.length), 0)
  const raw = rows.map((line) => [...line, ...Array<string>(width - line.length).fill(' ')])
  const roles = raw.map((line) => line.map((cell) => BOX_DRAWING_ROLES[cell] ?? cell))
  return { raw, roles, width, height: raw.length }
}

/* ------------------------------------------------------------------ *
 * Box detection
 * ------------------------------------------------------------------ */

/** A box's grid rectangle, borders inclusive. */
type Rect = { top: number; bottom: number; left: number; right: number }

/** A horizontal border run: `[+][-+]*[+]` on one row. */
type HSegment = { row: number; start: number; end: number }

/** A vertical border run: `[+][|+]*[+]` in one column. */
type VSegment = { col: number; start: number; end: number }

const key = (row: number, col: number): string => `${row}:${col}`

/**
 * Every `[+][-+]*[+]` run on every row, **including nested sub-runs**.
 *
 * Sub-runs are what make interior junctions work. In `+----+------+` the '+' at
 * the fifth column can start a legitimate `[+][-+]*[+]` run of its own, and it
 * has to be *considered* — the containment rule below is what rejects it — or
 * the same input would be read differently depending on which corner the scan
 * happened to start at.
 */
function horizontalSegments(grid: Grid): HSegment[] {
  const out: HSegment[] = []
  for (let row = 0; row < grid.height; row += 1) {
    const roles = grid.roles[row] as string[]
    let col = 0
    while (col < grid.width) {
      if (roles[col] !== ROLE_JUNCTION) {
        col += 1
        continue
      }
      let end = col
      while (end + 1 < grid.width) {
        const next = roles[end + 1]
        if (next !== ROLE_HORIZONTAL && next !== ROLE_JUNCTION) break
        end += 1
      }
      const junctions: number[] = []
      for (let c = col; c <= end; c += 1) if (roles[c] === ROLE_JUNCTION) junctions.push(c)
      for (const start of junctions) {
        for (const stop of junctions) {
          if (stop <= start) continue
          let drawn = false
          for (let c = start + 1; c < stop && !drawn; c += 1) drawn = roles[c] === ROLE_HORIZONTAL
          // A border is at least `-+-`: two corners with something between them.
          if (drawn && stop - start >= 2) out.push({ row, start, end: stop })
        }
      }
      col = end + 1
    }
  }
  return out
}

/** The vertical twin of `horizontalSegments`, read column by column. */
function verticalSegments(grid: Grid): VSegment[] {
  const out: VSegment[] = []
  for (let col = 0; col < grid.width; col += 1) {
    let row = 0
    while (row < grid.height) {
      if (grid.roles[row]?.[col] !== ROLE_JUNCTION) {
        row += 1
        continue
      }
      let end = row
      while (end + 1 < grid.height) {
        const next = grid.roles[end + 1]?.[col]
        if (next !== ROLE_VERTICAL && next !== ROLE_JUNCTION) break
        end += 1
      }
      const junctions: number[] = []
      for (let r = row; r <= end; r += 1) if (grid.roles[r]?.[col] === ROLE_JUNCTION) junctions.push(r)
      for (const start of junctions) {
        for (const stop of junctions) {
          if (stop <= start) continue
          let drawn = false
          for (let r = start + 1; r < stop && !drawn; r += 1) drawn = grid.roles[r]?.[col] === ROLE_VERTICAL
          if (drawn && stop - start >= 2) out.push({ col, start, end: stop })
        }
      }
      row = end + 1
    }
  }
  return out
}

const rectArea = (rect: Rect): number => (rect.right - rect.left) * (rect.bottom - rect.top)

/** Is `inner` inside (or equal to) `outer`? */
function contains(outer: Rect, inner: Rect): boolean {
  return (
    outer.top <= inner.top &&
    outer.bottom >= inner.bottom &&
    outer.left <= inner.left &&
    outer.right >= inner.right
  )
}

/**
 * The boxes in the grid.
 *
 * A rectangle is real when a top and a bottom border of the same width exist,
 * *and* both of their end columns carry a vertical run spanning exactly the rows
 * between them. An interior `+` on a border — the connector attachment point
 * §5 of the milestone allows — cannot satisfy that on its own: it has no wall
 * running down from it, so no rectangle closes through it.
 *
 * **Containment decides the junction case.** A box drawn with an interior wall
 * (`+----+------+` over `|    |      |`) yields three geometrically valid
 * rectangles. The two interior ones are strictly inside the outer one, so they
 * are dropped, and the shape reads as the single box the author drew with a
 * junction on its border. Splitting it would invent a node the source does not
 * have; the cost of the rule is that two boxes sharing a wall read as one box,
 * which is the conservative direction the milestone asks for.
 */
export function detectBoxes(grid: Grid): Rect[] {
  const horizontals = horizontalSegments(grid)
  const verticals = verticalSegments(grid)
  const walls = new Set(verticals.map((seg) => `${seg.col}:${seg.start}:${seg.end}`))

  const candidates: Rect[] = []
  for (const top of horizontals) {
    for (const bottom of horizontals) {
      if (bottom.row <= top.row) continue
      if (top.start !== bottom.start || top.end !== bottom.end) continue
      if (!walls.has(`${top.start}:${top.row}:${bottom.row}`)) continue
      if (!walls.has(`${top.end}:${top.row}:${bottom.row}`)) continue
      candidates.push({ top: top.row, bottom: bottom.row, left: top.start, right: top.end })
    }
  }

  // Largest first, so a containing rectangle is always seen before the ones it
  // contains. Ties are broken into a total order rather than left to the sort's
  // stability, so the node order is a property of the input alone.
  candidates.sort(
    (a, b) => rectArea(b) - rectArea(a) || a.top - b.top || a.left - b.left || b.bottom - a.bottom,
  )

  const kept: Rect[] = []
  for (const rect of candidates) {
    if (kept.some((outer) => contains(outer, rect))) continue
    kept.push(rect)
  }
  kept.sort((a, b) => a.top - b.top || a.left - b.left)
  return kept
}

/* ------------------------------------------------------------------ *
 * Node extraction
 * ------------------------------------------------------------------ */

/** Does the box's own border use Unicode box-drawing characters? */
function charsetOf(grid: Grid, rect: Rect): DiagramCharset {
  for (const [row, col] of [
    [rect.top, rect.left],
    [rect.top, rect.right],
    [rect.bottom, rect.left],
    [rect.bottom, rect.right],
  ] as const) {
    if (BOX_DRAWING.test(grid.raw[row]?.[col] ?? '')) return 'unicode'
  }
  return 'ascii'
}

/**
 * One box → one node, at the box's own coordinates.
 *
 * The interior text is taken verbatim, with two exceptions, and both of them are
 * decided by *geometry* rather than by which character it is:
 *
 *   - a column that has junction cells on both borders and a drawn `|` between
 *     them is an internal wall — the divider of a box the parser deliberately
 *     did not split on — so its cells read as spaces;
 *   - an interior row drawn entirely of `-`/`+` is a horizontal rule, likewise.
 *
 * The distinction matters more than it looks. Deciding by character would blank
 * every `v` inside a label (it is an arrowhead outside a box) and every `-` in a
 * hyphenated word, so "Dev server" would parse as "De  ser er" — a diagram that
 * is confidently wrong about the one thing it must get right. Only the drawn
 * structure is removed.
 *
 * Common indentation is then trimmed, so a label indented inside its box renders
 * flush, while the *relative* indentation of a multi-line label is preserved,
 * because that indentation is the author's.
 */
export function extractNode(grid: Grid, rect: Rect, index: number): DiagramNode {
  /** Columns that carry a real internal wall, borders inclusive. */
  const wallColumns = new Set<number>()
  for (let col = rect.left + 1; col < rect.right; col += 1) {
    if (grid.roles[rect.top]?.[col] !== ROLE_JUNCTION) continue
    if (grid.roles[rect.bottom]?.[col] !== ROLE_JUNCTION) continue
    let drawn = false
    for (let row = rect.top + 1; row < rect.bottom && !drawn; row += 1) {
      drawn = grid.roles[row]?.[col] === ROLE_VERTICAL
    }
    if (drawn) wallColumns.add(col)
  }

  /** A row drawn from one side of the interior to the other is a rule, not text. */
  const isRule = (row: number): boolean => {
    let sawHorizontal = false
    for (let col = rect.left + 1; col < rect.right; col += 1) {
      const role = grid.roles[row]?.[col]
      if (role === ROLE_HORIZONTAL) sawHorizontal = true
      else if (role !== ROLE_JUNCTION) return false
    }
    return sawHorizontal
  }

  const lines: string[] = []
  for (let row = rect.top + 1; row < rect.bottom; row += 1) {
    if (isRule(row)) {
      lines.push('')
      continue
    }
    const raw = grid.raw[row] as string[]
    let text = ''
    for (let col = rect.left + 1; col < rect.right; col += 1) {
      text += wallColumns.has(col) ? ' ' : (raw[col] as string)
    }
    // Leading spaces stay: they are the author's alignment, and a monospace face
    // reproduces them exactly. Only the trailing padding is noise.
    lines.push(text.replace(/\s+$/u, ''))
  }

  // Blank interior rows are not text. The first surviving line's row is kept, so
  // a label drawn two rows into its box renders two rows in.
  let textRow = rect.top + 1
  while (lines.length > 0 && (lines[0] as string).trim() === '') {
    lines.shift()
    textRow += 1
  }
  while (lines.length > 0 && (lines[lines.length - 1] as string).trim() === '') lines.pop()

  return {
    id: `n${index + 1}`,
    // The semantic label: trimmed, so a summary or an `aria-label` reads as a
    // sentence rather than as a run of padding.
    label: lines.map((line) => line.trim()).join('\n'),
    lines,
    row: rect.top,
    col: rect.left,
    width: rect.right - rect.left + 1,
    height: rect.bottom - rect.top + 1,
    charset: charsetOf(grid, rect),
    textRow,
  }
}

/**
 * Which cells belong to a box.
 *
 * A cell *inside* a rectangle counts, not just its border: a wall the parser did
 * not split on, or a character the author drew inside a box, is part of the box
 * and must never be read as a connector or as a free-floating label.
 */
function boxMask(grid: Grid, rects: readonly Rect[]): boolean[][] {
  const mask = grid.raw.map(() => Array<boolean>(grid.width).fill(false))
  for (const rect of rects) {
    for (let row = rect.top; row <= rect.bottom; row += 1) {
      for (let col = rect.left; col <= rect.right; col += 1) (mask[row] as boolean[])[col] = true
    }
  }
  return mask
}

/** The box that owns a cell, if any. `rects` is in reading order, so this is stable. */
function boxAt(rects: readonly Rect[], row: number, col: number): number | undefined {
  const index = rects.findIndex(
    (rect) => row >= rect.top && row <= rect.bottom && col >= rect.left && col <= rect.right,
  )
  return index === -1 ? undefined : index
}


/* ------------------------------------------------------------------ *
 * Connector detection
 * ------------------------------------------------------------------ */

/** One connected run of connector characters, with whether it was gapped. */
type Component = {
  cells: DiagramPoint[]
  /** True when the run only holds together across one-cell gaps. */
  gapped: boolean
}

const DIRECTIONS: Record<DiagramDirection, { dr: number; dc: number }> = {
  right: { dr: 0, dc: 1 },
  left: { dr: 0, dc: -1 },
  down: { dr: 1, dc: 0 },
  up: { dr: -1, dc: 0 },
}

const AXES: readonly { dr: number; dc: number }[] = [
  { dr: 0, dc: 1 },
  { dr: 0, dc: -1 },
  { dr: 1, dc: 0 },
  { dr: -1, dc: 0 },
]

/** The direction from `to` towards `from` — i.e. the way a path leaves `from`. */
function outward(from: DiagramPoint, to: DiagramPoint): DiagramDirection {
  if (from.row === to.row) return from.col > to.col ? 'right' : 'left'
  return from.row > to.row ? 'down' : 'up'
}

/**
 * Connector components, by 4-connectivity.
 *
 * Three rules make this safe rather than eager.
 *
 * **The mask.** Only cells that are a connector character *and* are outside
 * every box are candidates, so a box border can never be swallowed into a
 * connector and a character inside a box can never become an edge.
 *
 * **Gaps.** A dashed connector is drawn with gaps — `- - - >` — and 4-connectivity
 * alone would shatter it into single-character components that the minimum-size
 * rule then discards, losing a real edge. So a cell also connects to the cell
 * *two* along the same axis when the cell between them is a plain space. The
 * jump is recorded, and it is what `dashed` means: **the source drew gaps**. A
 * connector with no gaps is never labelled dashed, because the source never said
 * so.
 *
 * **Two cells, once.** A run is a connector at `ASCII_CONNECTOR_MIN_CHARS`
 * characters or more, with exactly one exception: a two-cell run that **ends in
 * an arrowhead**. The canonical vertical drop is two rows —
 *
 *     |
 *     v
 *
 * — and it is how the bundled demo document draws half of its arrows, so a rule
 * that dropped it would lose real edges to defend against a `-` in a sentence.
 * The exception is safe because it is not a shortcut past the checks that
 * matter: a two-cell run still has to resolve *both* ends to real box borders
 * before it becomes an edge, and in prose neither end ever does. A `->` in a
 * sentence is a component, and it dies at resolution like everything else.
 */
export function connectorComponents(grid: Grid, mask: readonly boolean[][]): Component[] {
  const isBox = (row: number, col: number): boolean =>
    row < 0 || col < 0 || row >= grid.height || col >= grid.width
      ? false
      : (mask[row] as boolean[])[col] === true

  const role = (row: number, col: number): string =>
    row < 0 || col < 0 || row >= grid.height || col >= grid.width
      ? ' '
      : ((grid.roles[row] as string[])[col] as string)
  const isConnector = (row: number, col: number): boolean =>
    !isBox(row, col) && CONNECTOR_ROLES.has(role(row, col))

  /** Direct and bridged neighbours of one cell, plus whether any bridge was used. */
  const neighboursOf = (row: number, col: number): { points: DiagramPoint[]; bridged: boolean } => {
    const points: DiagramPoint[] = []
    let bridged = false
    for (const axis of AXES) {
      const dr = axis.dr
      const dc = axis.dc
      const near = { row: row + dr, col: col + dc }
      if (isConnector(near.row, near.col)) {
        points.push(near)
        continue
      }
      // A gap of exactly one plain space, between two collinear connector cells.
      const far = { row: row + dr * 2, col: col + dc * 2 }
      if ((grid.raw[row + dr]?.[col + dc] ?? '') !== ' ') continue
      if (isConnector(far.row, far.col)) {
        points.push(far)
        bridged = true
      }
    }
    return { points, bridged }
  }

  const seen = new Set<string>()
  const components: Component[] = []

  for (let row = 0; row < grid.height; row += 1) {
    for (let col = 0; col < grid.width; col += 1) {
      if (!isConnector(row, col) || seen.has(key(row, col))) continue
      const cells: DiagramPoint[] = []
      let gapped = false
      const queue: DiagramPoint[] = [{ row, col }]
      seen.add(key(row, col))
      while (queue.length > 0) {
        const cell = queue.pop() as DiagramPoint
        cells.push(cell)
        const { points, bridged } = neighboursOf(cell.row, cell.col)
        if (bridged) gapped = true
        for (const point of points) {
          if (seen.has(key(point.row, point.col))) continue
          seen.add(key(point.row, point.col))
          queue.push(point)
        }
      }
      cells.sort((a, b) => a.row - b.row || a.col - b.col)
      /*
       * The minimum, and its one exception: a short run is still a connector if
       * it ends in an arrowhead. `|` above `v` is the two-row drop the demo
       * document draws, and a rule that discarded it would lose half of a real
       * diagram to protect against a `->` in a sentence — which is dropped a
       * moment later anyway, by resolution.
       */
      const hasArrowhead = cells.some((cell) => ARROWHEADS[grid.roles[cell.row]?.[cell.col] ?? ''] !== undefined)
      if (cells.length < ASCII_CONNECTOR_MIN_CHARS && !hasArrowhead) continue
      components.push({ cells, gapped })
    }
  }
  return components
}


/** One end of a connector, and the way it leaves the run. */
type ConnectorEnd = { point: DiagramPoint; direction: DiagramDirection; arrowhead: boolean }

/** The ends of a component: cells connected to at most one other cell in it. */
function endsOf(component: Component, grid: Grid): ConnectorEnd[] {
  const inComponent = new Set(component.cells.map((cell) => key(cell.row, cell.col)))
  const degree = new Map<string, number>()
  for (const cell of component.cells) {
    let count = 0
    for (const axis of AXES) {
      if (inComponent.has(key(cell.row + axis.dr, cell.col + axis.dc))) count += 1
      // The bridged neighbour counts too: a gapped run's middle cells are joined
      // only by the bridge, and reading them as ends would split one connector
      // into several.
      else if ((grid.raw[cell.row + axis.dr]?.[cell.col + axis.dc] ?? '') === ' ') {
        if (inComponent.has(key(cell.row + axis.dr * 2, cell.col + axis.dc * 2))) count += 1
      }
    }
    degree.set(key(cell.row, cell.col), count)
  }

  const ends: ConnectorEnd[] = []
  for (const cell of component.cells) {
    if ((degree.get(key(cell.row, cell.col)) ?? 0) > 1) continue
    const role = grid.roles[cell.row]?.[cell.col] as string
    const arrowhead = ARROWHEADS[role]
    if (arrowhead !== undefined) {
      ends.push({ point: cell, direction: arrowhead, arrowhead: true })
      continue
    }
    const neighbour = AXES.map((axis) => ({ row: cell.row + axis.dr, col: cell.col + axis.dc }))
      .concat(AXES.map((axis) => ({ row: cell.row + axis.dr * 2, col: cell.col + axis.dc * 2 })))
      .find((candidate) => inComponent.has(key(candidate.row, candidate.col)))
    if (neighbour === undefined) continue
    ends.push({ point: cell, direction: outward(cell, neighbour), arrowhead: false })
  }
  return ends
}

/**
 * Walk from a connector end, across whitespace only, to a box border.
 *
 * Whitespace is allowed between the two — that is what a label's gap looks like —
 * but anything else stops the walk, because a connector that has to pass through
 * *something* is not attached to it. Nothing is invented at the end of the walk:
 * no box means no edge.
 *
 * The border cell it lands on is returned with the box, because that cell is
 * where the route actually joins the picture — see `DiagramEdge.attach`.
 */
function resolveEnd(
  grid: Grid,
  mask: readonly boolean[][],
  rects: readonly Rect[],
  end: ConnectorEnd,
): { box: number; cell: DiagramPoint } | undefined {
  const delta = DIRECTIONS[end.direction]
  for (let step = 1; step <= ASCII_ATTACH_MAX_DISTANCE; step += 1) {
    const row = end.point.row + delta.dr * step
    const col = end.point.col + delta.dc * step
    if (row < 0 || col < 0 || row >= grid.height || col >= grid.width) return undefined
    if ((mask[row] as boolean[])[col] === true) {
      const box = boxAt(rects, row, col)
      return box === undefined ? undefined : { box, cell: { row, col } }
    }
    if ((grid.raw[row] as string[])[col] !== ' ') return undefined
  }
  return undefined
}

/**
 * The component's cells as an ordered route, source end first.
 *
 * `undefined` when the walk does not visit every cell — that means the connector
 * branches, and a branch has no single source or target, so the caller drops it
 * rather than picking one of the two destinations to be right about.
 */
function orderPath(component: Component, start: DiagramPoint): DiagramPoint[] | undefined {
  const inComponent = new Set(component.cells.map((cell) => key(cell.row, cell.col)))
  const steps = (cell: DiagramPoint): DiagramPoint[] =>
    AXES.flatMap((axis) => [
      { row: cell.row + axis.dr, col: cell.col + axis.dc },
      { row: cell.row + axis.dr * 2, col: cell.col + axis.dc * 2 },
    ]).filter((candidate) => inComponent.has(key(candidate.row, candidate.col)))

  const path: DiagramPoint[] = [start]
  const visited = new Set([key(start.row, start.col)])
  let current = start
  for (;;) {
    const next = steps(current).find((candidate) => !visited.has(key(candidate.row, candidate.col)))
    if (next === undefined) break
    path.push(next)
    visited.add(key(next.row, next.col))
    current = next
  }
  return visited.size === component.cells.length ? path : undefined
}

/** Drop the interior points of a straight run; keep every turn. */
function simplify(points: readonly DiagramPoint[]): DiagramPoint[] {
  const out: DiagramPoint[] = []
  for (const point of points) {
    const previous = out[out.length - 1]
    const before = out[out.length - 2]
    if (
      previous !== undefined &&
      before !== undefined &&
      ((before.row === previous.row && previous.row === point.row) ||
        (before.col === previous.col && previous.col === point.col))
    ) {
      out[out.length - 1] = point
      continue
    }
    out.push(point)
  }
  return out
}


/* ------------------------------------------------------------------ *
 * Label detection
 * ------------------------------------------------------------------ */

/** One run of adjacent text cells outside every box and every connector. */
type TextRun = { text: string; row: number; col: number; cells: DiagramPoint[] }

function textRuns(grid: Grid, mask: readonly boolean[][]): TextRun[] {
  const isText = (row: number, col: number): boolean => {
    if (row < 0 || col < 0 || row >= grid.height || col >= grid.width) return false
    if ((mask[row] as boolean[])[col] === true) return false
    const raw = (grid.raw[row] as string[])[col] as string
    if (raw.trim() === '') return false
    const role = (grid.roles[row] as string[])[col] as string
    // Structure without a box around it is not text: a lone `+`, or a connector
    // character (those are components, and handled as such).
    return role !== ROLE_JUNCTION && !CONNECTOR_ROLES.has(role)
  }

  const seen = new Set<string>()
  const runs: TextRun[] = []
  for (let row = 0; row < grid.height; row += 1) {
    for (let col = 0; col < grid.width; col += 1) {
      if (!isText(row, col) || seen.has(key(row, col))) continue
      const cells: DiagramPoint[] = []
      const queue: DiagramPoint[] = [{ row, col }]
      seen.add(key(row, col))
      while (queue.length > 0) {
        const cell = queue.pop() as DiagramPoint
        cells.push(cell)
        for (const axis of AXES) {
          const next = { row: cell.row + axis.dr, col: cell.col + axis.dc }
          if (!isText(next.row, next.col) || seen.has(key(next.row, next.col))) continue
          seen.add(key(next.row, next.col))
          queue.push(next)
        }
      }
      cells.sort((a, b) => a.row - b.row || a.col - b.col)
      const rows = new Map<number, string[]>()
      for (const cell of cells) {
        const list = rows.get(cell.row) ?? []
        list.push((grid.raw[cell.row] as string[])[cell.col] as string)
        rows.set(cell.row, list)
      }
      const text = [...rows.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, chars]) => chars.join('').trim())
        .filter((line) => line !== '')
        .join(' ')
      if (text === '') continue
      runs.push({ text, row: cells[0]?.row ?? 0, col: cells[0]?.col ?? 0, cells })
    }
  }
  return runs
}

/** The smallest distance between two cell sets, in cells (Chebyshev). */
function distance(a: readonly DiagramPoint[], b: readonly DiagramPoint[]): number {
  let best = Number.POSITIVE_INFINITY
  for (const left of a) {
    for (const right of b) {
      best = Math.min(best, Math.max(Math.abs(left.row - right.row), Math.abs(left.col - right.col)))
    }
  }
  return best
}

/**
 * Which component a text run belongs to, if any.
 *
 * One rule, and the ambiguity case is why it is stated as "closest *and* alone":
 * within `ASCII_LABEL_RADIUS` cells of a connector, and closer to that one than
 * to any other. A label equidistant between two connectors is attached to
 * neither — it becomes an annotation at its own coordinates, which claims
 * nothing. Guessing here would be exactly the "label drifted onto the wrong
 * edge" defect the quality bar names.
 */
function attachTo(
  run: TextRun,
  components: readonly Component[],
): number | undefined {
  const distances = components.map((component) => distance(run.cells, component.cells))
  let best = Number.POSITIVE_INFINITY
  let index: number | undefined
  let tied = false
  distances.forEach((value, at) => {
    if (value < best) {
      best = value
      index = at
      tied = false
      return
    }
    if (value === best) tied = true
  })
  if (index === undefined || tied || best > ASCII_LABEL_RADIUS) return undefined
  return index
}



/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

/**
 * Parse a fence into a diagram, or refuse.
 *
 * The order is the design: boxes first (nothing else can be believed without
 * them), then connectors, then labels — and only then the gate. An edge is
 * created only when the arrowhead's end resolves to one box *and* the other end
 * resolves to a *different* one, so a dangling connector is dropped and its
 * destination is never invented. Labels that attached to a dropped connector
 * fall back to annotations; labels that attached to nothing do the same.
 */
export function parseAsciiDiagram(fenceText: string): AsciiDiagramResult {
  const grid = toGrid(fenceText)
  const rects = detectBoxes(grid)
  if (rects.length < ASCII_DIAGRAM_MIN_NODES) return UNPARSEABLE

  const mask = boxMask(grid, rects)
  const nodes = rects.map((rect, index) => extractNode(grid, rect, index))
  const components = connectorComponents(grid, mask)
  const runs = textRuns(grid, mask)

  const attached = new Map<number, TextRun[]>()
  const attachedRuns = new Set<TextRun>()
  for (const run of runs) {
    const index = attachTo(run, components)
    if (index === undefined) continue
    attached.set(index, [...(attached.get(index) ?? []), run])
    attachedRuns.add(run)
  }

  const edges: DiagramEdge[] = []
  const connected = new Set<number>()

  components.forEach((component, index) => {
    const ends = endsOf(component, grid)
    const arrowheads = ends.filter((end) => end.arrowhead)
    const plain = ends.filter((end) => !end.arrowhead)
    /*
     * One arrowhead and one other end, or nothing. No arrowhead means no
     * direction to read; two means a two-way connector this edge model cannot
     * carry; a branch means there is no single source or target to be right
     * about. Each of those is dropped rather than guessed at.
     */
    if (arrowheads.length !== 1 || plain.length !== 1) return

    const head = arrowheads[0] as ConnectorEnd
    const tail = plain[0] as ConnectorEnd
    const target = resolveEnd(grid, mask, rects, head)
    if (target === undefined) return
    const source = resolveEnd(grid, mask, rects, tail)
    if (source === undefined || source.box === target.box) return

    const path = orderPath(component, tail.point)
    if (path === undefined) return

    const from = nodes[source.box]
    const to = nodes[target.box]
    if (from === undefined || to === undefined) return

    const labels = attached.get(index) ?? []
    const marks = labels
      .slice()
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .map((run) => ({ text: run.text, row: run.row, col: run.col }))
    edges.push({
      from: from.id,
      to: to.id,
      direction: head.direction,
      dashed: component.gapped,
      ...(marks.length === 0 ? {} : { labelMarks: marks }),
      ...(marks.length === 0 ? {} : { label: marks.map((mark) => mark.text).join(' ') }),
      attach: { from: source.cell, to: target.cell },
      path: simplify(path),
    })
    connected.add(index)
  })

  /* The confidence gate (§10 of the milestone). Both, or the fence stays a terminal. */
  if (edges.length < ASCII_DIAGRAM_MIN_EDGES) return UNPARSEABLE

  /* Nothing is silently dropped: whatever did not become an edge's label is
   * carried out as an annotation at its own coordinates, and rendered there. */
  const annotations: DiagramAnnotation[] = runs
    .filter((run) => {
      if (!attachedRuns.has(run)) return true
      for (const [index, list] of attached) {
        if (!connected.has(index) && list.includes(run)) return true
      }
      return false
    })
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map((run) => ({ text: run.text, row: run.row, col: run.col }))

  return {
    kind: 'diagram',
    nodes,
    edges,
    annotations,
    width: grid.width,
    height: grid.height,
  }
}


/**
 * A one-line description of the diagram, for its `aria-label` (milestone §15).
 *
 * Two shapes, and the second exists to keep the first honest. A diagram that is
 * a single chain reads as the chain — `A → B → C` — because that is what the
 * picture says. Anything else reads as its edges, because a sentence claiming a
 * chain where the source drew a fan would be describing a diagram the author did
 * not draw. Isolated boxes are named too: they are in the picture, so they are
 * in the description.
 */
export function describeDiagram(diagram: AsciiDiagram): string {
  const labelOf = (id: string): string => {
    const node = diagram.nodes.find((candidate) => candidate.id === id)
    const label = (node?.label ?? '').replace(/\s+/gu, ' ').trim()
    return label === '' ? id : label
  }

  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()
  for (const node of diagram.nodes) {
    outgoing.set(node.id, [])
    incoming.set(node.id, [])
  }
  for (const edge of diagram.edges) {
    outgoing.get(edge.from)?.push(edge.to)
    incoming.get(edge.to)?.push(edge.from)
  }

  const sources = diagram.nodes.filter((node) => (incoming.get(node.id) ?? []).length === 0)
  const chain = chainOf(sources[0]?.id, outgoing)
  const isChain =
    sources.length === 1 &&
    diagram.nodes.every(
      (node) => (outgoing.get(node.id) ?? []).length <= 1 && (incoming.get(node.id) ?? []).length <= 1,
    ) &&
    chain.length === diagram.nodes.length

  if (isChain) return `Diagram: ${chain.map(labelOf).join(' → ')}`

  const parts = diagram.edges.map((edge) => `${labelOf(edge.from)} → ${labelOf(edge.to)}`)
  for (const node of diagram.nodes) {
    if ((outgoing.get(node.id) ?? []).length > 0) continue
    if ((incoming.get(node.id) ?? []).length > 0) continue
    parts.push(labelOf(node.id))
  }
  return `Diagram: ${parts.join('; ')}`
}

/** Walk a chain of single out-edges, stopping the moment it would repeat. */
function chainOf(start: string | undefined, outgoing: ReadonlyMap<string, string[]>): string[] {
  const path: string[] = []
  const seen = new Set<string>()
  let current = start
  while (current !== undefined && !seen.has(current)) {
    seen.add(current)
    path.push(current)
    current = (outgoing.get(current) ?? [])[0]
  }
  return path
}
