/**
 * `loop` block → a cycle diagram (spec §1.2). Custom SVG, no library: the
 * labels are a closed loop, so an arc of labelled nodes plus one closing arrow
 * is the whole picture. Stops are laid out on a circle and the final arrow
 * returns to the first.
 */

export type LoopProps = { labels: string[] }

const SIZE = 320
const CENTRE = SIZE / 2
const RADIUS = 108

function polar(index: number, total: number): { x: number; y: number } {
  // Start at 12 o'clock and go clockwise.
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2
  return { x: CENTRE + RADIUS * Math.cos(angle), y: CENTRE + RADIUS * Math.sin(angle) }
}

export function Loop({ labels }: LoopProps): JSX.Element {
  const count = Math.max(labels.length, 2)
  const points = labels.map((_, index) => polar(index, count))

  return (
    <figure className="loop-diagram">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`Cycle: ${labels.join(' → ')}`}
        className="loop-svg"
      >
        <circle cx={CENTRE} cy={CENTRE} r={RADIUS} className="loop-ring" fill="none" />
        {points.map((point, index) => {
          const next = points[(index + 1) % points.length] as { x: number; y: number }
          const isClosing = index === count - 1
          return (
            <line
              key={`edge-${index}`}
              x1={point.x}
              y1={point.y}
              x2={next.x}
              y2={next.y}
              className={isClosing ? 'loop-edge loop-edge--closing' : 'loop-edge'}
            />
          )
        })}
        {points.map((point, index) => (
          <g key={`node-${index}`}>
            <circle cx={point.x} cy={point.y} r={7} className="loop-node" />
            <text x={point.x} y={point.y - 16} className="loop-label" textAnchor="middle">
              {labels[index]}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="visually-hidden">Cycle diagram: {labels.join(' → ')}</figcaption>
    </figure>
  )
}
