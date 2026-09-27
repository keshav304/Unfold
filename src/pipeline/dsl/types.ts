/** Data shapes produced by the Unfold DSL blocks (spec §6.7, §6.8). */

export type GraphNode = {
  id: string
  label: string
  sub?: string
}

export type GraphEdge = {
  from: string
  to: string
  label?: string
  dashed?: boolean
}

export type GraphSpec = {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export type StepSpec = {
  /** 1-based position, taken from the DSL's own numbering. */
  index: number
  title: string
  description?: string
  /** Slug of the section this step came from, if `@slug` resolved. */
  source?: string
  /** The `@slug` exactly as authored, resolved or not. */
  sourceRef?: string
}

/** Thrown internally by a DSL parser; always caught and degraded. */
export class DslParseError extends Error {
  readonly line: number | undefined

  constructor(message: string, line?: number) {
    super(message)
    this.name = 'DslParseError'
    this.line = line
  }
}
