/**
 * Block dispatch (spec §6.3). One `Block` in, one component out.
 *
 * `graph` and `steps` are **deferred**: their views belong to M3, so in the
 * reader they render as their source. That is the §1.3 degrade path — the
 * content is fully visible and nothing is faked or dropped.
 */

import type { ReactNode } from 'react'
import type { Paragraph } from 'mdast'
import { tableCellText } from '../../pipeline/blocks'
import type { Block, InlineNode } from '../../pipeline/types'
import { renderInline, type InlineContext } from './Inline'
import { CodeBlock } from './CodeBlock'
import { Terminal } from './Terminal'
import { Loop } from './Loop'
import { Mermaid } from './Mermaid'

export type BlockProps = { block: Block; context: InlineContext }

function inline(node: Paragraph, context: InlineContext, key: string): ReactNode {
  return <span key={key}>{node.children.map((child, index) => renderInline(child, index, context))}</span>
}

/** A table cell's inline runs, through the same pipeline as prose (A3). */
function inlineNodes(cell: readonly InlineNode[], context: InlineContext): ReactNode {
  return cell.map((child, index) => renderInline(child, index, context))
}

/**
 * The scrollable table's landmark name.
 *
 * The wrapper is a `role="region"` so a keyboard user can reach the horizontal
 * scroller (§7.1), and every landmark on a page must have a *unique* name —
 * two regions both called "Table" is `landmark-unique`, and a screen-reader
 * user hears "Table" with no way to tell them apart. Naming each one after its
 * own header row is derived from the document, so two tables with different
 * columns are distinguishable and nothing is invented.
 */
function tableLabel(block: Extract<Block, { kind: 'table' }>): string {
  const header = block.header.map((cell) => tableCellText(cell)).filter((text) => text !== '')
  if (header.length === 0) return 'Table'
  return `Table: ${header.join(', ')}`
}

function listItems(items: readonly unknown[], context: InlineContext, ordered: boolean): ReactNode {
  return (
    <ol className="reader-list" start={1}>
      {items.map((item, index) => {
        const node = item as { children?: { type: string; children?: unknown[] }[] }
        return (
          <li key={index} className={ordered ? '' : 'reader-list__item'}>
            {ordered ? null : <span className="visually-hidden">bullet</span>}
            {(node.children ?? []).map((child, childIndex) => {
              if (child.type === 'paragraph') {
                return (
                  <p key={childIndex}>
                    {(child.children ?? []).map((grandchild, grandIndex) =>
                      renderInline(grandchild as never, grandIndex, context),
                    )}
                  </p>
                )
              }
              if (child.type === 'list') {
                return listItems((child as { children?: unknown[] }).children ?? [], context, false)
              }
              return null
            })}
          </li>
        )
      })}
    </ol>
  )
}

export function BlockView({ block, context }: BlockProps): ReactNode {
  switch (block.kind) {
    case 'prose':
      return <p className="reader-prose">{inline(block.node, context, block.kind)}</p>

    case 'quote':
      return <blockquote className="reader-quote">{inline(block.node, context, block.kind)}</blockquote>

    case 'list':
      return listItems(block.items, context, block.ordered)

    case 'code':
      return <CodeBlock code={block.code} lang={block.lang} />

    case 'terminal':
      return <Terminal code={block.code} />

    case 'mermaid':
      return <Mermaid code={block.code} />

    case 'loop':
      return <Loop labels={block.labels} />

    case 'table':
      return (
        <div className="reader-table-scroll" tabIndex={0} role="region" aria-label={tableLabel(block)}>
          <table className="reader-table">
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index} scope="col" style={alignOf(block.align[index])}>
                    <span className="reader-cell">{inlineNodes(cell, context)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} style={alignOf(block.align[cellIndex])}>
                      <span className="reader-cell">{inlineNodes(cell, context)}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )

    case 'hr':
      return <hr className="reader-hr" />

    case 'html':
      // Raw HTML is shown as source. Rendering it would mean injecting document
      // markup into the page, which §4 forbids outside a sanitised <br>.
      return <pre className="reader-html">{block.value}</pre>

    case 'graph':
    case 'steps':
      return (
        <CodeBlock
          code={deferredSource(block)}
          lang={block.kind}
          filePath={`${block.kind} (view arrives in a later milestone)`}
        />
      )

    default:
      return null
  }
}

function alignOf(align: string | null | undefined): { textAlign: 'left' | 'right' | 'center' } | undefined {
  if (align === 'right' || align === 'center') return { textAlign: align }
  return undefined
}

/** The DSL source for a block whose view has not shipped yet. */
function deferredSource(block: Extract<Block, { kind: 'graph' | 'steps' }>): string {
  if (block.kind === 'graph') {
    const nodes = block.spec.nodes.map((node) => `  ${node.id}: ${node.label}${node.sub === undefined ? '' : ` | ${node.sub}`}`)
    const edges = block.spec.edges.map(
      (edge) => `  ${edge.from} ${edge.dashed === true ? '-.-' : '->'} ${edge.to}${edge.label === undefined ? '' : ` | ${edge.label}`}`,
    )
    return ['nodes:', ...nodes, 'edges:', ...edges].join('\n')
  }
  return block.spec
    .map((step) => {
      const description = step.description === undefined ? '' : ` — ${step.description}`
      const source = step.sourceRef === undefined ? '' : ` [@${step.sourceRef}]`
      return `${step.index}. ${step.title}${description}${source}`
    })
    .join('\n')
}
