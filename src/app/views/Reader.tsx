/**
 * The reader view (spec §7.1). Renders the document as a column of blocks and
 * nothing else: no view decides its own chrome, and a document with no
 * sections still renders its introduction.
 */

import type { ReactNode } from 'react'
import type { Block, Doc } from '../../pipeline/types'
import { BlockView } from '../blocks/BlockView'
import { navigate, prefersReducedMotion } from '../navigate'
import type { InlineContext } from '../blocks/Inline'

export type ReaderProps = {
  doc: Doc
  slugs: ReadonlySet<string>
  onNavigate: (slug: string) => void
  /** Slug to flash, set right after a navigation. */
  flash?: string | null
}

/** The first paragraph of a section, for the inspector later (§7.6). */
export function firstProseOf(blocks: readonly Block[]): Block | undefined {
  return blocks.find((block) => block.kind === 'prose' || block.kind === 'quote')
}

function renderBlocks(blocks: readonly Block[], context: InlineContext, keyPrefix: string): ReactNode {
  return blocks.map((block, index) => (
    <BlockView key={`${keyPrefix}-${index}`} block={block} context={context} />
  ))
}

function renderSection(
  section: Doc['sections'][number],
  context: InlineContext,
  flash: string | null | undefined,
  level: 2 | 3,
): ReactNode {
  const Heading = level === 2 ? 'h2' : 'h3'
  return (
    <section
      key={section.slug}
      id={`section-${section.slug}`}
      className={`reader-section reader-section--h${level}`}
      data-slug={section.slug}
      {...(flash === section.slug ? { 'data-flash': 'true' } : {})}
      tabIndex={-1}
    >
      <Heading className={`reader-heading reader-heading--h${level}`}>
        <a
          className="reader-anchor"
          href={`#${section.slug}`}
          aria-label={`Link to ${section.title}`}
          onClick={(event) => {
            event.preventDefault()
            navigate(section.slug, context.onNavigate)
          }}
        >
          {section.title}
        </a>
      </Heading>
      {renderBlocks(section.blocks, context, section.slug)}
      {section.children.map((child) => renderSection(child, context, flash, 3))}
    </section>
  )
}

export function Reader({ doc, slugs, onNavigate, flash }: ReaderProps): JSX.Element {
  const context: InlineContext = { slugs, onNavigate }

  return (
    <div className="reader" data-reduced-motion={prefersReducedMotion() ? 'true' : 'false'}>
      {renderBlocks(doc.intro, context, 'intro')}
      {doc.sections.map((section) => renderSection(section, context, flash, 2))}
      {doc.sections.length === 0 && doc.intro.length === 0 ? (
        <p className="reader-empty">This document has no readable content.</p>
      ) : null}
    </div>
  )
}
