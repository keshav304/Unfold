/**
 * Block classification (spec §6.3, §6.9). One mdast node in, one `Block` out.
 *
 * The classifier never throws. A DSL block that fails to parse degrades to a
 * plain `code` block plus a dev-mode warning (spec §1.3) — never a crash, never
 * a blank space in the reader.
 */

import type { Content, Paragraph, PhrasingContent, RootContent, Table, TableCell } from 'mdast'
import { DSL_LANGUAGES } from './constants'
import { parseGraph } from './dsl/graph'
import { parseLoop } from './dsl/loop'
import { parseSteps } from './dsl/steps'
import { DslParseError } from './dsl/types'
import { toPlainText, walk } from './mdast-text'
import { isAsciiDiagram } from './terminal'
import type { Align, Block, InlineNode, InlineRow, InlineRun } from './types'
import { warn } from './warn'

export type ClassifyResult = {
  block: Block
  /** Internal (`#slug`) link targets declared inside this node. */
  internalLinks: string[]
  /** `[@slug]` references found in a `steps` block, resolved or not. */
  stepRefs?: string[]
}

function result(block: Block, node?: unknown): ClassifyResult {
  return node === undefined ? { block, internalLinks: [] } : { block, internalLinks: internalLinksOf(node) }
}

/** Internal (`#slug`) link URLs anywhere inside a node, order preserved. */
export function internalLinksOf(node: unknown): string[] {
  const urls: string[] = []
  walk(node as RootContent, (visited) => {
    if (visited.type !== 'link') return
    const url = (visited as { url?: unknown }).url
    if (typeof url !== 'string' || !url.startsWith('#') || url.length < 2) return
    let target = url.slice(1)
    try {
      target = decodeURIComponent(target)
    } catch {
      // A malformed percent-escape is still a link; use it verbatim.
    }
    target = target.trim().toLowerCase()
    if (target !== '' && !urls.includes(target)) urls.push(target)
  })
  return urls
}

function cellNodes(cell: TableCell): InlineRun {
  return cell.children.filter((child): child is PhrasingContent => child.type !== 'html')
}

function classifyTable(node: Table): Block {
  const header: InlineRow = []
  const rows: InlineRow[] = []
  const align: Align[] = []

  for (const row of node.children) {
    const cells = row.children.map((cell) => cellNodes(cell))
    if (cells.length === 0) continue
    // The first row of a GFM table is the header. An empty table is a table.
    if (header.length === 0) header.push(...cells)
    else rows.push(cells)
  }

  for (const entry of node.align ?? []) align.push(entry ?? null)
  while (align.length < header.length) align.push(null)

  return { kind: 'table', header, rows, align: align.slice(0, header.length) }
}

/** Plain text of a table cell, for search records and word counts (A3). */
export function tableCellText(cell: readonly InlineNode[]): string {
  return toPlainText({ type: 'paragraph', children: [...cell] })
}

/** Normalise a fence info string: `Graph`, `graph {a}`, `  graph ` → `graph`. */
export function normaliseLang(lang: string | null | undefined): string {
  if (lang === null || lang === undefined) return ''
  return lang.trim().split(/[\s{,:]/u)[0]?.toLowerCase() ?? ''
}

function asParagraph(node: Content): Paragraph {
  if (node.type === 'paragraph') return node
  return { type: 'paragraph', children: [] }
}

/**
 * A `definition` node (`[label]: url "title"`) is metadata, not content.
 *
 * mdast lifts reference definitions out of the flow entirely — they live on the
 * root, not in the section tree — but `classifyNode` is still handed them by the
 * section splitter, and the default branch turned each one into an `html` block
 * with an empty value. The reader therefore rendered one empty `<pre>` per
 * definition: a document with three reference links gained three blank boxes,
 * and the fixture that proves reference links work also proved this.
 *
 * Dropping them here is the §1.3 rule applied correctly: a construct the
 * renderer has no presentation for is absent, not rendered as a gap. The
 * definitions themselves are still collected in `parseDocument` and carried on
 * the `Doc`, so the links they resolve keep working.
 */
export function isDefinitionNode(node: RootContent | Content): boolean {
  return node.type === 'definition'
}

/**
 * Classify one node, or return `null` when the node has no presentation at all
 * (a link definition). A `null` is not an empty block: an empty block renders
 * an empty element, which is a gap on the page.
 */
export function classifyNode(node: RootContent | Content): ClassifyResult | null {
  if (isDefinitionNode(node)) return null

  switch (node.type) {
    case 'paragraph':
      return result({ kind: 'prose', node: asParagraph(node) }, node)

    case 'blockquote': {
      // A quote renders its first paragraph; anything richer keeps its text as
      // prose so no words are lost.
      const first = node.children.find((child) => child.type === 'paragraph')
      return result({ kind: 'quote', node: asParagraph(first ?? node) }, node)
    }

    case 'list':
      return result({ kind: 'list', ordered: node.ordered === true, items: node.children }, node)

    case 'thematicBreak':
      return { block: { kind: 'hr' }, internalLinks: [] }

    case 'table':
      return result(classifyTable(node as Table), node)

    case 'html':
      return { block: { kind: 'html', value: node.value }, internalLinks: [] }

    case 'code':
      return classifyCode(node)

    default: {
      // Unknown or future node type: keep whatever text it carries, never crash.
      const value = 'value' in node && typeof node.value === 'string' ? node.value : ''
      return { block: { kind: 'html', value }, internalLinks: [] }
    }
  }
}

function classifyCode(node: Extract<Content, { type: 'code' }>): ClassifyResult {
  const code = node.value
  const lang = normaliseLang(node.lang)

  if (lang === DSL_LANGUAGES.mermaid) return { block: { kind: 'mermaid', code }, internalLinks: [] }

  // Untagged fences may be ASCII diagrams (spec §6.9).
  if (lang === '' && isAsciiDiagram(code)) return { block: { kind: 'terminal', code }, internalLinks: [] }

  if (lang === DSL_LANGUAGES.graph) {
    try {
      return { block: { kind: 'graph', spec: parseGraph(code) }, internalLinks: [] }
    } catch (error) {
      return degrade(lang, code, error, 'graph')
    }
  }

  if (lang === DSL_LANGUAGES.steps) {
    try {
      const { steps, refs } = parseSteps(code)
      return { block: { kind: 'steps', spec: steps }, internalLinks: [], stepRefs: refs }
    } catch (error) {
      return degrade(lang, code, error, 'steps')
    }
  }

  if (lang === DSL_LANGUAGES.loop) {
    try {
      return { block: { kind: 'loop', labels: parseLoop(code) }, internalLinks: [] }
    } catch (error) {
      return degrade(lang, code, error, 'loop')
    }
  }

  return { block: { kind: 'code', lang, code }, internalLinks: [] }
}

function degrade(lang: string, code: string, error: unknown, language: string): ClassifyResult {
  const detail = error instanceof DslParseError ? error.message : String(error)
  warn('dsl', `malformed \`${language}\` block rendered as plain code`, detail)
  return { block: { kind: 'code', lang, code }, internalLinks: [] }
}
