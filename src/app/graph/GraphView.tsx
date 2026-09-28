/**
 * The graph workbench (spec §7.6, §5.3).
 *
 * Two rules govern everything in this file.
 *
 * **1. The view consumes `doc.graph`; it never derives one.** M3.3's boundary is
 * load-bearing: the pipeline already applied the §6.7 thresholds, resolved
 * H3→parent-H2 links and decided `derived`. If this view recomputed any of that,
 * the nav item and the canvas could disagree — an "Auto-generated map" chip on a
 * graph the pipeline said was below threshold. The only question asked here is
 * which mode we are in (`doc.graph.derived`), and the answer only chooses a
 * heading and a chip.
 *
 * **2. React Flow is lazy.** This module is the only thing that imports
 * `@xyflow/react`, and the shell imports it through `React.lazy`, so the whole
 * library lands in its own chunk. `budget.test.ts` asserts that against the
 * built output — a stray static import in the shell would put a large library in
 * the entry bundle and fail §10.
 *
 * The defensive fallback at the bottom is real code, not decoration: the route is
 * capability-gated, but `doc.graph` is a *separate* field from
 * `capabilities.graph`, and a `features.graph: "on"` config (§1.4) can turn the
 * capability on for a document that has no graph. Rendering nothing there would
 * be a blank screen, which §1.3 forbids.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Doc, GraphSpec, Section } from '../../pipeline/types'
import { warn } from '../../pipeline/warn'
import { firstProseOf } from '../views/Reader'
import { BlockView } from '../blocks/BlockView'
import type { InlineContext } from '../blocks/Inline'
import { navigate } from '../navigate'
import { layoutBounds, layoutGraph, NODE_HEIGHT, NODE_WIDTH } from './layout'
import { MetroNodeMemo } from './MetroNode'
import { sectionsBySlug, targetForNode, unresolvedNodeIds } from './graph-targets'

const nodeTypes = { metro: MetroNodeMemo }

/**
 * The narrowest zoom `fitView` is allowed to choose (M4.2).
 *
 * A four-column metro map laid out at 176px nodes and an 88px column gap is
 * ~970 canvas units wide. Fitting that into a 375px phone viewport means a zoom
 * of about 0.35, at which a node's 10px label renders at 3.5px and four nodes
 * collapse into an unreadable smear — the M4.2 screenshot showed exactly that.
 *
 * `fitView` at every other width computes a zoom well above this, so the clamp
 * is inert on a desktop and only bites where fitting is the wrong answer. Above
 * it, the graph is wider than the screen and the reader pans — which is what
 * every map on a phone does, and the only alternative to a graph nobody can
 * read. Panning is already bound (React Flow's `panOnDrag` defaults to true) and
 * the zoom controls are on screen.
 */
const MIN_FIT_ZOOM = 0.6

/** The one fit-view configuration, so the three call sites cannot disagree. */
const FIT = { padding: 0.2, minZoom: MIN_FIT_ZOOM, duration: 0 } as const

export type GraphViewProps = {
  doc: Doc
  slugs: ReadonlySet<string>
  onNavigate: (slug: string) => void
  descriptions?: Record<string, string>
  fileExtensions: readonly string[]
  /** False when the <768px segmented tab has this pane hidden (M3.5). */
  visible?: boolean
}

/** The heading each mode reads as (§7.6). */
const HEADING = {
  explicit: 'Architecture',
  derived: 'Document map',
} as const

/** §7.6: derived graphs carry this chip; explicit ones do not. */
const DERIVED_CHIP = 'Auto-generated map'

/**
 * The inline context the panel's prose renders through — the *same* pipeline the
 * reader uses, so an entity chip in a section's first paragraph is a chip here
 * too (M3.4). Built once per document, not per node click.
 */
function usePanelContext(
  doc: Doc,
  slugs: ReadonlySet<string>,
  onNavigate: (slug: string) => void,
  descriptions: Record<string, string> | undefined,
  fileExtensions: readonly string[],
): InlineContext {
  return useMemo(() => {
    const titles = new Map<string, string>()
    const visit = (sections: readonly Section[]): void => {
      for (const section of sections) {
        titles.set(section.slug, section.title)
        visit(section.children)
      }
    }
    visit(doc.sections)
    return {
      slugs,
      onNavigate,
      entities: doc.capabilities.entities,
      glossary: doc.capabilities.glossary ? (doc.glossary ?? []) : [],
      backlinks: doc.indexes.backlinks,
      titles,
      descriptions: descriptions ?? {},
      fileExtensions,
      ...(doc.linkDefinitions === undefined ? {} : { linkDefinitions: doc.linkDefinitions }),
    }
  }, [doc, slugs, onNavigate, descriptions, fileExtensions])
}

/**
 * M3.4 dev-time validation.
 *
 * A node id that matches no section is a documentation slip, not a crash: the
 * panel renders and the action is disabled. It is still worth saying out loud in
 * development, so the author learns their `browser:` node has nowhere to go
 * before a reader clicks it. Routed through the pipeline's warning sink (§1.3's
 * mechanism) rather than `console.warn`, so the e2e console-noise gate and the
 * unit tests can both see it.
 */
function useWarnUnresolvedNodes(doc: Doc, spec: GraphSpec | undefined, derived: boolean): void {
  useEffect(() => {
    if (spec === undefined || derived) return
    // A derived graph's ids are slugs by construction, so reporting them would be
    // reporting the pipeline's own work back at itself.
    const unresolved = unresolvedNodeIds(doc, spec.nodes.map((node) => node.id))
    if (unresolved.length === 0) return
    warn(
      'graph',
      'graph node ids match no section, so "Open section" is disabled for them',
      unresolved.join(', '),
    )
  }, [doc, spec, derived])
}

/** The inspector panel (§7.6): title, first prose block, file chips, action. */
function Inspector({
  node,
  target,
  context,
  onOpen,
  onClose,
  closeRef,
}: {
  node: { id: string; label: string; sub?: string } | null
  target: { slug: string | null; section: Section | null }
  context: InlineContext
  onOpen: (slug: string) => void
  onClose: () => void
  closeRef: React.RefObject<HTMLButtonElement>
}): JSX.Element | null {
  if (node === null) return null
  const prose = target.section === null ? undefined : firstProseOf(target.section.blocks)

  return (
    <aside className="inspector elev-1" aria-label="Node details" data-state="open">
      <header className="inspector-head">
        <span className="inspector-head__kind t-label-caps">Node</span>
        <button
          type="button"
          ref={closeRef}
          className="inspector-close"
          onClick={onClose}
          aria-label="Close node details"
        >
          ✕
        </button>
      </header>

      <h2 className="inspector-title t-headline-md">{node.label}</h2>
      {node.sub === undefined ? null : <p className="inspector-sub t-code-sm">{node.sub}</p>}

      {prose === undefined ? null : (
        <div className="inspector-prose">
          {/* `exactOptionalPropertyTypes` forbids an explicit `undefined` here, so
              the section slug is spread in only when the node resolved to one. */}
          <BlockView
            block={prose}
            context={target.slug === null ? context : { ...context, sectionSlug: target.slug }}
          />
        </div>
      )}

      {/*
        File chips for the section, from the document's own extraction (§6.5). The
        panel renders the same chip component the reader would, so a path is never
        styled one way here and another there. Nothing renders when the section
        mentions no files — §1.1: absent, not an empty chip row.
      */}
      {target.section !== null && target.section.files.length > 0 ? (
        <div className="inspector-files">
          <span className="inspector-files__label t-label-caps">Files</span>
          <ul className="inspector-files__list">
            {target.section.files.map((file) => (
              <li key={`${file.path}::${file.symbol ?? ''}`}>
                <span className="entity-chip entity-chip--static t-code-sm">
                  {file.symbol === undefined ? file.path : `${file.path}::${file.symbol}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <button
        type="button"
        className="inspector-action t-body-md"
        // Disabled, not hidden, when the node names no section: the reader can see
        // that there is a section to open and that this node is not it. A missing
        // button would read as a bug in the panel instead.
        disabled={target.slug === null}
        aria-describedby={target.slug === null ? 'inspector-action-hint' : undefined}
        onClick={() => {
          if (target.slug !== null) onOpen(target.slug)
        }}
      >
        <span>Open section</span>
        <span aria-hidden="true">→</span>
      </button>
      {target.slug === null ? (
        <p className="inspector-hint" id="inspector-action-hint">
          This node names no section in the document, so there is nothing to open.
        </p>
      ) : null}
    </aside>
  )
}

/** The canvas plus the panel, inside the provider `useReactFlow` needs. */
function GraphWorkbench({
  doc,
  slugs,
  onNavigate,
  descriptions,
  fileExtensions,
  visible,
}: GraphViewProps): JSX.Element {
  const graph = doc.graph
  const spec = graph?.spec
  const derived = graph?.derived === true
  const heading = derived ? HEADING.derived : HEADING.explicit

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const { fitView } = useReactFlow()

  useWarnUnresolvedNodes(doc, spec, derived)

  const bySlug = useMemo(() => sectionsBySlug(doc), [doc])
  const context = usePanelContext(doc, slugs, onNavigate, descriptions, fileExtensions)
  const placed = useMemo(() => (spec === undefined ? [] : layoutGraph(spec)), [spec])

  /**
   * M3.5 trap (a): a hidden tab measures zero, and fit-view against a zero-sized
   * container produces a viewport that shows nothing.
   *
   * React Flow measures on mount; if the canvas was `display: none` at that
   * moment the measurement is 0×0, and no later resize repairs the *initial*
   * zoom. So the view re-fits whenever the pane becomes visible. The flag is read
   * in an effect rather than during render, because the transition that reveals
   * the pane has not finished when render happens.
   */
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (visible === false) return
    const frame = requestAnimationFrame(() => {
      const box = containerRef.current
      if (box === null) return
      // A pane that is still zero-sized here is not ready; the ResizeObserver
      // below fires when it gets a real box.
      if (box.clientWidth === 0 || box.clientHeight === 0) return
      fitView({ ...FIT })
    })
    return () => cancelAnimationFrame(frame)
  }, [visible, fitView, spec])

  useEffect(() => {
    const box = containerRef.current
    if (box === null || typeof ResizeObserver === 'undefined') return
    let first = true
    const observer = new ResizeObserver(() => {
      // The first observation is the mount measurement, which React Flow's own
      // initial fit already handled; re-fitting on it would fight that and show a
      // visible jump.
      if (first) {
        first = false
        return
      }
      if (box.clientWidth === 0 || box.clientHeight === 0) return
      fitView({ ...FIT })
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [fitView])

  /**
   * Nodes and edges, built from the *spec the pipeline gave us* — never from a
   * re-derivation. A node's `ariaLabel` becomes React Flow's accessible name on
   * the focusable wrapper, so §9's "focusable labelled nodes" is satisfied by
   * the label the document itself wrote rather than by invented prose.
   */
  const { nodes, edges } = useMemo(() => {
    if (spec === undefined) return { nodes: [] as Node[], edges: [] as Edge[] }
    const position = new Map(placed.map((node) => [node.id, node]))
    const built: Node[] = spec.nodes.map((node) => {
      const at = position.get(node.id)
      const section = targetForNode(node.id, bySlug).section
      return {
        id: node.id,
        type: 'metro',
        position: { x: at?.x ?? 0, y: at?.y ?? 0 },
        /*
         * The node's box, stated rather than measured.
         *
         * React Flow sizes a node by measuring the DOM after mount, and until it
         * has, it routes edges against a default 150×40 box. The layout's
         * columns are computed from `NODE_WIDTH`/`NODE_HEIGHT`, so a measured box
         * that disagrees would put the tracks through the middle of the labels.
         * Declaring it makes the two the same number, and it is also what lets
         * `fitView` compute a correct viewport on the very first paint.
         */
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        ariaLabel: node.sub === undefined ? node.label : `${node.label}. ${node.sub}`,
        data: { node, hasSection: section !== null },
      }
    })

    const tracks: Edge[] = spec.edges.map((edge, index) => ({
      id: `e${index}-${edge.from}-${edge.to}`,
      source: edge.from,
      target: edge.to,
      // §6.7: `-.->` is the dashed edge, and it stays dashed in the view — the
      // dash is the author's distinction (a soft dependency, a return path), so
      // replacing it with a solid arrow would erase information.
      ...(edge.dashed === true ? { animated: true, className: 'graph-edge--dashed' } : {}),
      label: edge.label,
      labelStyle: { fill: 'var(--text-muted)' },
      labelBgStyle: { fill: 'var(--surface-1)' },
      style: { stroke: 'var(--border-muted)', strokeWidth: 2 },
    }))
    return { nodes: built, edges: tracks }
  }, [spec, placed, bySlug])

  const onNodeClick = useCallback<NodeMouseHandler>((_event, node) => {
    setSelectedId(node.id)
  }, [])

  /**
   * Enter opens the panel for the focused node (§7.6, §9).
   *
   * React Flow owns the arrow keys on a node — they move the *selection* — and
   * handles no other key, so Enter arrives here. The handler is on the container
   * rather than on the node because the node is React Flow's own element: binding
   * inside a custom node would mean re-implementing its focus and drag handling
   * to add one key.
   *
   * The guard matters: Enter on the *zoom controls*, which are real buttons
   * inside the same container, must stay theirs. Only an event whose target is
   * inside a node is claimed.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter') return
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const owner = target.closest('[data-id]')
      if (owner === null) return
      const id = owner.getAttribute('data-id')
      if (id === null || id === '') return
      event.preventDefault()
      setSelectedId(id)
    },
    [],
  )

  const close = useCallback(() => setSelectedId(null), [])

  const open = useCallback(
    (slug: string) => {
      setSelectedId(null)
      navigate(slug, onNavigate)
    },
    [onNavigate],
  )

  /**
   * Esc closes the panel and returns focus to the node that opened it (§9).
   *
   * The focus target is the node's React Flow wrapper — the element that was
   * focused when the panel opened. Handing focus to `body` would drop the reader
   * at the top of the document, which is the exact defect the palette's focus
   * restore was written to avoid, in a different component.
   */
  useEffect(() => {
    if (selectedId === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setSelectedId(null)
      const node = document.querySelector<HTMLElement>(`[data-id="${CSS.escape(selectedId)}"]`)
      node?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selectedId])

  // Focus moves into the panel when it opens, so the reader's next keypress acts
  // on the panel rather than on the canvas behind it.
  useEffect(() => {
    if (selectedId !== null) closeRef.current?.focus()
  }, [selectedId])

  const selected = spec?.nodes.find((node) => node.id === selectedId) ?? null
  const target =
    selected === null ? { slug: null, section: null } : targetForNode(selected.id, bySlug)

  if (spec === undefined) {
    return (
      <div className="graph-workbench">
        <div className="graph-empty elev-1">
          <h2 className="t-headline-md">{HEADING.explicit}</h2>
          <p className="t-body-md">
            This document is configured to offer the graph view, but it declares no graph. The
            reader has the full text.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="graph-workbench" data-panel={selected === null ? 'closed' : 'open'}>
      <div className="graph-stage">
        <header className="graph-head">
          <h1 className="graph-title t-headline-lg">{heading}</h1>
          {derived ? (
            <span className="graph-chip t-code-sm" data-chip="derived">
              {DERIVED_CHIP}
            </span>
          ) : null}
        </header>

        <div
          className="graph-canvas grid-canvas"
          ref={containerRef}
          data-visible={visible !== false}
          onKeyDown={onKeyDown}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClick}
            onPaneClick={close}
            fitView
            fitViewOptions={FIT}
            nodesFocusable
            edgesFocusable={false}
            elementsSelectable
            proOptions={{ hideAttribution: true }}
            minZoom={0.2}
            maxZoom={2}
          >
            {/* The grid is `--grid-line` on a 24px pitch (spec §5.2/§7.2). */}
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--grid-line)" />
            <Controls showInteractive={false} aria-label="Graph zoom controls" />
          </ReactFlow>
        </div>
      </div>

      <Inspector
        node={selected}
        target={target}
        context={context}
        onOpen={open}
        onClose={close}
        closeRef={closeRef}
      />
    </div>
  )
}

/**
 * The reader's inline mini-canvas for a ` ```graph ` block (M4.13.1).
 *
 * ## What this is, and what it deliberately is not
 *
 * It is the same canvas: `layoutGraph`, `MetroNodeMemo`, the `graph-canvas`
 * styling, the `edge-trace` dashed-edge treatment, `fitView` — all imported from
 * the module above, which is also why it costs nothing extra on the critical
 * path. This module is the only thing that imports `@xyflow/react`, so loading
 * it here lands the library in the chunk it was always going to land in.
 *
 * It is not a second graph view: no workbench, no inspector, no panel, no
 * switcher, no dragging, no zoom controls, no keyboard affordances. The reader's
 * job is reading, and a diagram embedded in prose should behave like a picture in
 * a document — it is there to be looked at. Hover still lights a node (that is
 * CSS, and it is the same CSS the workbench uses), and the full experience is one
 * click away through the link the caller renders beside it.
 *
 * The `slugs` prop is optional on purpose: without it a node simply is not
 * marked as resolving to a section, which affects a data attribute and nothing
 * else. Nothing here navigates, so nothing here can navigate wrongly.
 */
export type GraphInlineProps = {
  spec: GraphSpec
  /** Section slugs, so a node whose id *is* a section can be marked as one. */
  slugs?: ReadonlySet<string>
}

/** The band the inline canvas sizes itself within, and the padding around it. */
const CANVAS_MIN = 168
const CANVAS_MAX = 360
const CANVAS_PADDING = 72
/** A wide reading column, in px — the worst case for a graph that wants width. */
const COLUMN_ESTIMATE = 700

export function GraphInline({ spec, slugs }: GraphInlineProps): JSX.Element {
  const placed = useMemo(() => layoutGraph(spec), [spec])
  const bounds = useMemo(() => layoutBounds(placed), [placed])

  /**
   * The canvas is sized to the graph it holds, not to a fixed 360px.
   *
   * A four-column chain laid out left-to-right is 1056 units wide and **64** tall.
   * `fitView` fits that into a reading column at the workbench's own
   * `MIN_FIT_ZOOM` of 0.6, so the graph is 634×38 — and a 360px box around a 38px
   * graph is 300px of nothing above and below it, which is exactly what the
   * M4.13 screenshot showed: a thin row of nodes adrift in an empty field.
   *
   * So the height is derived from the *layout*, in three steps, every one of them
   * a pure function of the spec the pipeline gave us:
   *
   *   1. the zoom `fitView` will choose at the reading column's width, computed
   *      with `FIT`'s own padding and the same `MIN_FIT_ZOOM` clamp the workbench
   *      uses — so this is not a second guess at the fit;
   *   2. the fitted content's height, plus a band of padding;
   *   3. a floor and a ceiling, because a diagram in a document has a size range
   *      and neither end of it is interesting.
   *
   * The column width is an estimate, and being wrong costs a little more or less
   * padding. The reason it is an estimate and *not* a measurement is layout
   * shift: a height that arrives after a `ResizeObserver` fires moves everything
   * below it, and M4.10 spent a milestone driving document CLS to 0.000. A number
   * computed from the spec is known on the first paint.
   */
  const height = useMemo(() => {
    const usable = COLUMN_ESTIMATE * (1 - 2 * FIT.padding)
    const zoom = Math.max(MIN_FIT_ZOOM, Math.min(1, usable / Math.max(bounds.width, 1)))
    const fitted = Math.round(bounds.height * zoom) + CANVAS_PADDING
    return Math.min(CANVAS_MAX, Math.max(CANVAS_MIN, fitted))
  }, [bounds.height, bounds.width])

  const { nodes, edges } = useMemo(() => {
    const declared = new Map(spec.nodes.map((node) => [node.id, node]))
    const nodes: Node[] = []
    for (const position of placed) {
      const node = declared.get(position.id)
      if (node === undefined) continue
      nodes.push({
        id: position.id,
        type: 'metro',
        position: { x: position.x + NODE_WIDTH / 2, y: position.y + NODE_HEIGHT / 2 },
        data: {
          node,
          hasSection: slugs?.has(position.id) ?? false,
        },
        draggable: false,
        connectable: false,
        selectable: false,
        focusable: false,
      })
    }

    const edges: Edge[] = []
    spec.edges.forEach((edge, index) => {
      if (!declared.has(edge.from) || !declared.has(edge.to)) return
      edges.push({
        id: `inline-${index}`,
        source: edge.from,
        target: edge.to,
        ...(edge.dashed === true ? { className: 'graph-edge--dashed' } : {}),
        ...(edge.label === undefined ? {} : { label: edge.label }),
        selectable: false,
        focusable: false,
      })
    })
    return { nodes, edges }
  }, [spec, placed, slugs])

  return (
    <div
      className="graph-canvas graph-inline"
      data-read-only="true"
      style={{ height: `${height}px` }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={FIT}
        minZoom={0.2}
        maxZoom={2}
        // Read-only, end to end: nothing drags, nothing connects, nothing is
        // selected, and neither wheel nor double-click zooms — a diagram in a
        // document is looked at, not operated on. Panning is off for the same
        // reason: the reader scrolls this page, and a canvas that swallows the
        // scroll wheel is a canvas that traps the reader mid-paragraph.
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        panOnDrag={false}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      >
        {/* The grid is `--grid-line` on a 24px pitch (spec §5.2/§7.2). */}
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--grid-line)" />
      </ReactFlow>
    </div>
  )
}


export default function GraphView(props: GraphViewProps): JSX.Element {
  return (
    <ReactFlowProvider>
      <GraphWorkbench {...props} />
    </ReactFlowProvider>
  )
}

