/**
 * Section splitting (spec §6.2): H2s are the top level, H3s nest inside them.
 * Content before the first H2 is the document introduction. Nothing is dropped.
 *
 * Headings deeper than H3 are flattened: their text is kept as prose inside the
 * enclosing section rather than inventing a nesting level the model lacks. An
 * H3 that appears before any H2 is promoted to the top level so its content
 * stays reachable.
 */

import type { Heading, Paragraph, RootContent } from 'mdast'
import { classifyNode } from './blocks'
import { toPlainText } from './mdast-text'
import { Slugger } from './slug'
import type { Block, Section } from './types'

export type SplitResult = {
  /** Title text of the first H1, if the document has one. */
  h1Title?: string
  intro: Block[]
  sections: Section[]
  /** Internal (`#slug`) link targets declared in the introduction. */
  introLinks: string[]
  /** `[@slug]` references from `steps` blocks, in document order. */
  stepRefs: string[]
}

type Draft = {
  level: 2 | 3
  slug: string
  title: string
  blocks: Block[]
  links: string[]
  children: Draft[]
}

function paragraph(text: string): Paragraph {
  return { type: 'paragraph', children: [{ type: 'text', value: text }] }
}

function headingText(node: Heading): string {
  return toPlainText(node).trim()
}

export function splitSections(root: readonly RootContent[], slugger: Slugger): SplitResult {
  const intro: Block[] = []
  const introLinks: string[] = []
  const stepRefs: string[] = []
  const sections: Draft[] = []
  let h1Title: string | undefined
  let h1Seen = false

  let currentH2: Draft | undefined
  let currentH3: Draft | undefined

  const push = (block: Block) => {
    if (currentH3 !== undefined) currentH3.blocks.push(block)
    else if (currentH2 !== undefined) currentH2.blocks.push(block)
    else intro.push(block)
  }

  const addLinks = (links: readonly string[]) => {
    const target = currentH3 ?? currentH2
    if (target === undefined) {
      for (const link of links) if (!introLinks.includes(link)) introLinks.push(link)
      return
    }
    for (const link of links) if (!target.links.includes(link)) target.links.push(link)
  }

  for (const node of root) {
    if (node.type === 'heading' && node.depth === 1) {
      const text = headingText(node)
      if (!h1Seen) {
        h1Seen = true
        if (text !== '') h1Title = text
        continue
      }
      // Further H1s are document boundaries, not sections: keep their words.
      if (text !== '') push({ kind: 'prose', node: paragraph(text) })
      continue
    }

    if (node.type === 'heading' && node.depth === 2) {
      const title = headingText(node)
      currentH2 = { level: 2, slug: slugger.slug(title), title, blocks: [], links: [], children: [] }
      currentH3 = undefined
      sections.push(currentH2)
      continue
    }

    if (node.type === 'heading' && node.depth === 3) {
      const title = headingText(node)
      const draft: Draft = { level: 3, slug: slugger.slug(title), title, blocks: [], links: [], children: [] }
      if (currentH2 !== undefined) {
        currentH2.children.push(draft)
        currentH3 = draft
      } else {
        // No H2 to nest under: promote so the content is not orphaned.
        const promoted: Draft = { ...draft, level: 2 }
        sections.push(promoted)
        currentH2 = promoted
        currentH3 = undefined
      }
      continue
    }

    if (node.type === 'heading') {
      const text = headingText(node)
      if (text !== '') push({ kind: 'prose', node: paragraph(text) })
      continue
    }

    const classified = classifyNode(node)
    if (classified !== null) {
      if (classified.stepRefs !== undefined) {
        for (const ref of classified.stepRefs) if (!stepRefs.includes(ref)) stepRefs.push(ref)
      }
      addLinks(classified.internalLinks)
      push(classified.block)
    }
  }

  const result: SplitResult = {
    intro,
    introLinks,
    sections: sections.map(materialise),
    stepRefs,
  }
  if (h1Title !== undefined) result.h1Title = h1Title
  return result
}

function materialise(draft: Draft): Section {
  return {
    level: draft.level,
    slug: draft.slug,
    title: draft.title,
    blocks: draft.blocks,
    children: draft.children.map(materialise),
    files: [],
    tests: [],
    wordCount: 0,
    linksTo: draft.links,
    text: '',
  }
}
