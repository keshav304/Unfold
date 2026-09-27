/**
 * mdast → plain text helpers. Shared by entity extraction, word counts, search
 * records and glossary definitions so that text extraction behaves identically
 * everywhere in the pipeline.
 *
 * A link contributes its label text but never its URL: URLs are not prose, and
 * scanning them is how entity extraction ends up inventing file paths.
 */

import type { Content, Root, RootContent } from 'mdast'

/**
 * Plain text of a node with its line structure preserved. Soft line breaks
 * inside a paragraph matter for `Aliases:` lines, so this must not collapse them.
 */
export function toPlainTextLines(node: unknown): string[] {
  return collect(node).join('').split('\n').map((line) => line.trim())
}

function collect(node: unknown, parts: string[] = []): string[] {
  if (node === null || typeof node !== 'object') return parts
  const candidate = node as { type?: string; value?: string; children?: unknown[] }
  if (typeof candidate.type !== 'string') return parts
  if (typeof candidate.value === 'string') {
    parts.push(candidate.value)
    return parts
  }
  for (const child of candidate.children ?? []) collect(child, parts)
  return parts
}

/** Plain text of a node, whitespace-collapsed. Never throws. */
export function toPlainText(node: unknown): string {
  const parts: string[] = []
  collectText(node, parts)
  return parts.join('').replace(/\s+/gu, ' ').trim()
}

function collectText(node: unknown, parts: string[]): void {
  if (node === null || typeof node !== 'object') return
  const candidate = node as { type?: string; value?: string; children?: unknown[] }
  if (typeof candidate.type !== 'string') return

  if (typeof candidate.value === 'string') {
    parts.push(candidate.value)
    return
  }
  for (const child of candidate.children ?? []) collectText(child, parts)
}

/**
 * The phrasing runs of a node, in document order, skipping *all* code: fenced
 * code blocks, indented code and inline code spans. Glossary terms and custom
 * config patterns read from these — a term in backticks is a literal string the
 * author is quoting, not a concept being referenced (spec §6.5).
 */
export function collectProseRuns(node: unknown, runs: string[] = []): string[] {
  if (node === null || typeof node !== 'object') return runs
  const candidate = node as { type?: string; value?: string; children?: unknown[] }
  if (typeof candidate.type !== 'string') return runs

  if (candidate.type === 'code' || candidate.type === 'inlineCode' || candidate.type === 'html') {
    return runs
  }
  if (candidate.type === 'link' || candidate.type === 'linkReference') {
    // Label text only — never the URL.
    for (const child of candidate.children ?? []) collectProseRuns(child, runs)
    return runs
  }
  if (typeof candidate.value === 'string') {
    runs.push(candidate.value)
    return runs
  }
  for (const child of candidate.children ?? []) collectProseRuns(child, runs)
  return runs
}

/**
 * The inline-code spans of a node, in document order, skipping fenced code.
 * The file family reads from these (spec §6.5): backticked text in prose is an
 * author pointing at a real file, and technical documents write paths that way
 * far more often than in bare prose.
 */
export function collectInlineRuns(node: unknown, runs: string[] = []): string[] {
  if (node === null || typeof node !== 'object') return runs
  const candidate = node as { type?: string; value?: string; children?: unknown[] }
  if (typeof candidate.type !== 'string') return runs

  if (candidate.type === 'code' || candidate.type === 'html') return runs
  if (candidate.type === 'inlineCode') {
    if (typeof candidate.value === 'string') runs.push(candidate.value)
    return runs
  }
  for (const child of candidate.children ?? []) collectInlineRuns(child, runs)
  return runs
}


/** Plain text of a node with code excluded, whitespace-collapsed. */
export function toProseText(node: unknown): string {
  return collectProseRuns(node).join(' ').replace(/\s+/gu, ' ').trim()
}

/** Plain text of a list of nodes, joined by blank lines (paragraph breaks). */
export function blocksToPlainText(nodes: readonly unknown[]): string {
  return nodes
    .map((node) => toPlainText(node))
    .filter((text) => text !== '')
    .join('\n\n')
}

/** Word count of already-plain text. */
export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)
  return matches === null ? 0 : matches.length
}

/** Walk a tree, calling `visit` for every node. Never throws on odd shapes. */
export function walk(root: Root | Content, visit: (node: RootContent) => void): void {
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (node === null || typeof node !== 'object') continue
    const candidate = node as { type?: string; children?: unknown[] }
    if (typeof candidate.type !== 'string') continue
    visit(node as RootContent)
    if (Array.isArray(candidate.children)) {
      for (let i = candidate.children.length - 1; i >= 0; i -= 1) {
        const child = candidate.children[i]
        if (child !== null && typeof child === 'object') stack.push(child)
      }
    }
  }
}
