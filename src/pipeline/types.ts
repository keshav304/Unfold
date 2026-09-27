/**
 * The document model (spec §6.3). The document is data: every field here is
 * derived from the markdown source, never from what a particular document
 * happens to say.
 */

import type { Content, Paragraph, PhrasingContent, Root } from 'mdast'
import type { GraphSpec, StepSpec } from './dsl/types'

/** Table column alignment, `null` when the source declares none. */
export type Align = 'left' | 'right' | 'center' | null

/**
 * One inline node, the same type the prose renderer walks (amendment A3,
 * spec §6.3). A table cell is prose, so a cell carries inline runs and renders
 * through the same pipeline — entity chips included.
 */
export type InlineNode = PhrasingContent

/**
 * One cell's inline runs. `header` is a single row of cells; `rows` is a list
 * of such rows.
 */
export type InlineRun = InlineNode[]

/** One table row: the cells across it. */
export type InlineRow = InlineRun[]

export type BlockKind =
  | 'prose'
  | 'code'
  | 'table'
  | 'terminal'
  | 'mermaid'
  | 'loop'
  | 'graph'
  | 'steps'
  | 'quote'
  | 'list'
  | 'hr'
  | 'html'

export type Block =
  | { kind: 'prose'; node: Paragraph }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'table'; header: InlineRow; rows: InlineRow[]; align: Align[] }
  | { kind: 'terminal'; code: string }
  | { kind: 'mermaid'; code: string }
  | { kind: 'loop'; labels: string[] }
  | { kind: 'graph'; spec: GraphSpec }
  | { kind: 'steps'; spec: StepSpec[] }
  | { kind: 'quote'; node: Paragraph }
  | { kind: 'list'; ordered: boolean; items: Content[] }
  | { kind: 'hr' }
  | { kind: 'html'; value: string }

export type FileRef = {
  /** Path exactly as written in the document. */
  path: string
  /** Trailing `::symbol` when present. */
  symbol?: string
}

export type TestRef = {
  /** The full `path::test_id` string. */
  id: string
  path: string
  testId: string
}

export type Section = {
  level: 2 | 3
  slug: string
  title: string
  blocks: Block[]
  children: Section[]
  files: FileRef[]
  tests: TestRef[]
  wordCount: number
  /** Slugs of in-document headings this section links to. */
  linksTo: string[]
  /** Plain text of the section, used for search snippets (spec §6.6). */
  text: string
}

export type GlossaryEntry = {
  term: string
  aliases: string[]
  definition: string
}

/** Every renderer-gating flag (spec §1.1). Tier 0 features are not flags. */
export type CapabilityName =
  | 'graph'
  | 'stepper'
  | 'glossary'
  | 'entities'
  | 'mermaid'
  | 'loop'
  | 'terminal'

export type CapabilitySet = Record<CapabilityName, boolean>

/** One record in the search index (spec §6.6). */
export type SearchRecord = {
  id: string
  kind: 'section' | 'body' | 'file' | 'glossary'
  title: string
  slug: string
  text: string
  /** Aliases or symbol subtitles, searchable alongside `text`. */
  keywords: string[]
}

export type DocIndexes = {
  /** Flat, serialisable search records; `createSearchIndex` compiles them. */
  records: SearchRecord[]
  /** slug → section plain text, for ±45-char snippet windows. */
  sectionText: Record<string, string>
  /** file path (lowercased) → slugs of the sections mentioning it. */
  backlinks: Record<string, string[]>
  /** Every distinct file path mentioned anywhere in the document. */
  filePaths: string[]
}

/**
 * A link reference definition, `[label]: url "title"`.
 *
 * Kept on the `Doc` rather than resolved away at classify time: a
 * `linkReference` node carries only the label and the identifier, so the href
 * lives in the root's definition list. Without these the renderer has no URL to
 * put on the link — and a reference link rendered as nothing at all is silent
 * content loss.
 */
export type LinkDefinition = { url: string; title?: string }

export type Doc = {
  title: string
  description?: string
  /**
   * Identifier → definition, from the document's own reference definitions.
   *
   * Absent for a document that declares none, which is the common case.
   */
  linkDefinitions?: Record<string, LinkDefinition>
  /** Where the title came from — spec §7.2 fallback chain, minus the UI. */
  titleSource: 'frontmatter' | 'h1' | 'filename'
  intro: Block[]
  sections: Section[]
  glossary?: GlossaryEntry[]
  graph?: { spec: GraphSpec; derived: boolean }
  steps?: StepSpec[]
  capabilities: CapabilitySet
  /** Statistics derived purely from the parsed content (hero, spec §7.2). */
  stats: {
    words: number
    sections: number
    codeBlocks: number
    diagrams: number
  }
  /** Derived data (spec §6.6). Never authored, never invented. */
  indexes: DocIndexes
  /** Internal links whose target slug does not exist (spec §6.4). */
  unresolvedLinks: { from: string; to: string }[]
}

export type { GraphSpec, StepSpec, Root }
