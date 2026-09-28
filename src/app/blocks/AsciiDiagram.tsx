/**
 * An ASCII diagram as SVG (M4.14c).
 *
 * ## The coordinate system is the source grid
 *
 * One character is one horizontal unit, one row is one vertical unit, and the
 * units are the mono metrics of the type scale — `CELL_W` is 0.6em of
 * `--text-code-md-size` (JetBrains Mono's advance) and `CELL_H` is that token's
 * line height. The SVG's `viewBox` is the fence's own grid scaled by those two
 * numbers, so the picture keeps the author's arrangement exactly.
 *
 * **Nothing is laid out here.** No dagre, no force simulation, no centring, no
 * even distribution: a node is drawn at its own grid rectangle and an edge is
 * drawn along its own connector cells. A source diagram with two boxes four
 * columns apart renders with those two boxes four columns apart. That is the
 * whole feature — the picture a reader sees is the picture the author drew — and
 * it is also what keeps the renderer small.
 *
 * ## Painting
 *
 * Every colour, radius and duration comes from `tokens.css`: the node is
 * `--surface-1` with a 1.5px `--border-strong` stroke and a `--border-muted`
 * inset hairline; an edge is 2px `--border-muted`. Those are the graph view's
 * metro-node and track values, because it is the same design language. The
 * dashed treatment reuses the graph canvas's `edge-trace` keyframes and its
 * `--motion-ambient` tier rather than inventing a second animation.
 *
 * ## Accessibility
 *
 * The SVG is `role="img"` with an `aria-label` generated from the parsed graph,
 * never from the source text: a summarised chain, or a list of edges when the
 * diagram is not a chain. The ASCII is not exposed as the primary
 * representation of a diagram that has been parsed — it is not what the picture
 * means.
 */

import { useId, type CSSProperties } from 'react'
import type {
  AsciiDiagram as ParsedDiagram,
  DiagramEdge,
  DiagramNode,
} from '../../pipeline/ascii-diagram'
import { describeDiagram } from '../../pipeline/ascii-diagram'

/**
 * The mono metrics the grid is scaled by.
 *
 * `CELL_W` = 0.6 × `--text-code-md-size` (12px) — JetBrains Mono's advance width
 * is 0.6em, and the stylesheet sets that same token as the label's font size, so
 * one character in the SVG is exactly one character wide. `CELL_H` is the same
 * token's line height, which is what a terminal row is.
 */
const CELL_W = 7.2
const CELL_H = 18
const LINE_HEIGHT = 18
/** Room for the stroke on a border that sits on the viewBox's edge. */
const PAD = 4
/** §13: the 4px base radius, on a node. */
const RADIUS = 4

const xOf = (col: number): number => col * CELL_W + CELL_W / 2
const yOf = (row: number): number => row * CELL_H + CELL_H / 2

type Point = { x: number; y: number }

/**
 * The connector's route in SVG units, run to the borders it attaches to.
 *
 * The parser records the two border cells the route meets (`edge.attach`), and
 * the route is drawn through them. That is what closes the gap between an
 * arrowhead and the box it points at: the connector's last cell is at the centre
 * of the character the author drew it in, and the box it points at is the *next*
 * cell along, so a route that stopped at the connector left a visible empty cell
 * between the arrow and the box — in the vertical case, half a row of nothing
 * that read as a broken arrow.
 *
 * Nothing is re-derived here, and nothing is smoothed: the cells between the two
 * attachments are the author's, in order, with the collinear points already
 * removed by the parser.
 */
function routeOf(edge: DiagramEdge): Point[] {
  const points = [edge.attach.from, ...edge.path, edge.attach.to]
  return points.map((point) => ({ x: xOf(point.col), y: yOf(point.row) }))
}

function NodeShape({ node }: { node: DiagramNode }): JSX.Element {
  // The rectangle runs through the *centres* of the border cells, which is where
  // the border characters are drawn in the source.
  const x = node.col * CELL_W + CELL_W / 2
  const y = node.row * CELL_H + CELL_H / 2
  const width = (node.width - 1) * CELL_W
  const height = (node.height - 1) * CELL_H

  return (
    <g className="ascii-diagram__node" data-node={node.id}>
      <rect
        className="ascii-node__box"
        x={x}
        y={y}
        width={width}
        height={height}
        rx={RADIUS}
        ry={RADIUS}
      />
      {/* The 1px inner hairline every node in this design system carries. */}
      <rect
        className="ascii-node__hairline"
        x={x + 1}
        y={y + 1}
        width={Math.max(width - 2, 0)}
        height={Math.max(height - 2, 0)}
        rx={Math.max(RADIUS - 1, 0)}
        ry={Math.max(RADIUS - 1, 0)}
      />
      {/*
       * `xmlSpace="preserve"`: the label's leading spaces are the author's
       * alignment, and SVG's default whitespace handling would collapse them —
       * every box would read flush left instead of centred in its own rectangle.
       */}
      <text className="ascii-node__label" xmlSpace="preserve">
        {node.lines.map((line, index) =>
          line.trim() === '' ? null : (
            <tspan
              key={index}
              x={(node.col + 1) * CELL_W}
              y={yOf(node.textRow + index) + LINE_HEIGHT * 0.34}
            >
              {line}
            </tspan>
          ),
        )}
      </text>
    </g>
  )
}

export type AsciiDiagramProps = { diagram: ParsedDiagram }

export function AsciiDiagram({ diagram }: AsciiDiagramProps): JSX.Element {
  // Unique per instance, and stripped to characters a URL fragment accepts:
  // `url(#:r1:)` is not something to leave to a browser's discretion.
  const markerId = `ascii-arrow-${useId().replace(/[^a-zA-Z0-9]/gu, '')}`
  const width = Math.ceil(diagram.width * CELL_W + PAD * 2)
  const height = Math.ceil(diagram.height * CELL_H + PAD * 2)

  return (
    <figure
      className="ascii-diagram"
      data-kind="diagram"
      data-nodes={diagram.nodes.length}
      data-edges={diagram.edges.length}
      /*
       * The diagram's own natural width, as the cap. Without it a two-box sketch
       * would be scaled *up* to fill a 700px column and read as a poster rather
       * than as a diagram in a document; with it the drawing renders at its own
       * size on a wide screen and scales down — never up — on a narrow one, which
       * is also what keeps the page from overflowing sideways.
       */
      style={{ '--ascii-diagram-width': `${width}px` } as CSSProperties}
    >
      <svg
        className="ascii-diagram__svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={describeDiagram(diagram)}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="4.2"
            markerHeight="4.2"
            orient="auto-start-reverse"
          >
            <path className="ascii-edge__arrowhead" d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        <g transform={`translate(${PAD} ${PAD})`}>
          <g className="ascii-diagram__edges">
            {diagram.edges.map((edge, index) => (
              <g
                key={`${edge.from}-${edge.to}-${index}`}
                className={edge.dashed ? 'ascii-edge ascii-edge--dashed' : 'ascii-edge'}
                data-from={edge.from}
                data-to={edge.to}
                data-direction={edge.direction}
              >
                <polyline
                  className="ascii-edge__path"
                  points={routeOf(edge)
                    .map((point) => `${point.x},${point.y}`)
                    .join(' ')}
                  markerEnd={`url(#${markerId})`}
                />
                {/*
                 * Each label is drawn at the row and column it was written in,
                 * so a label above an arrow is above it and a label beside one
                 * is beside it — the source's placement, not a box around the
                 * line.
                 */}
                {edge.labelMarks?.map((mark, markIndex) => (
                  <text
                    key={markIndex}
                    className="ascii-edge__label"
                    x={mark.col * CELL_W}
                    y={yOf(mark.row) + LINE_HEIGHT * 0.34}
                    xmlSpace="preserve"
                  >
                    {mark.text}
                  </text>
                ))}
              </g>
            ))}
          </g>

          <g className="ascii-diagram__nodes">
            {diagram.nodes.map((node) => (
              <NodeShape key={node.id} node={node} />
            ))}
          </g>

          {diagram.annotations.length === 0 ? null : (
            <g className="ascii-diagram__notes">
              {diagram.annotations.map((note, index) => (
                <text
                  key={index}
                  className="ascii-note"
                  x={note.col * CELL_W}
                  y={yOf(note.row) + LINE_HEIGHT * 0.34}
                  xmlSpace="preserve"
                >
                  {note.text}
                </text>
              ))}
            </g>
          )}
        </g>
      </svg>
    </figure>
  )
}

