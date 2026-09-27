/**
 * The reader view (spec §7.1). Renders the document as a column of blocks and
 * nothing else: no view decides its own chrome, and a document with no
 * sections still renders its introduction.
 */

import { useMemo, type ReactNode } from 'react'
import type { Block, Doc } from '../../pipeline/types'
import { INTRO_SLUG } from '../../pipeline/constants'
import { flattenSections } from '../../pipeline/indexes'
import { BlockView } from '../blocks/BlockView'
import { navigate, prefersReducedMotion } from '../navigate'
import type { InlineContext } from '../blocks/Inline'

export type ReaderProps = {
  doc: Doc
  slugs: ReadonlySet<string>
  onNavigate: (slug: string) => void
  /** Slug to flash, set right after a navigation. */
  flash?: string | null
  /**
   * The config-extensible entity description map (spec §7.5). Empty by default,
   * which is why a popover shows backlinks only until a deployer fills it in.
   */
  descriptions?: Record<string, string>
  /**
   * The configured file-extension list (spec §1.4). Required, not defaulted: a
   * missing list means "no extension is a file extension", i.e. no chips at all,
   * and silently rendering zero chips is exactly the failure this guards.
   */
  fileExtensions: readonly string[]
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

/**
 * The chip context for one section: the document-wide half plus its own slug.
 *
 * The shared half is built once in `Reader` and spread here, so the `WeakMap`
 * memo in `Inline` keys on one object per section rather than one per block.
 */
function contextFor(base: InlineContext, slug: string): InlineContext {
  return { ...base, sectionSlug: slug }
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

export function Reader({
  doc,
  slugs,
  onNavigate,
  flash,
  descriptions = {},
  fileExtensions,
}: ReaderProps): JSX.Element {
  const context: InlineContext = useMemo(() => {
    const titles = new Map<string, string>()
    for (const section of flattenSections(doc.sections)) titles.set(section.slug, section.title)
    return {
      slugs,
      onNavigate,
      // Capability-gated (§1.1): a document that is not `entities`-capable
      // renders no file chips at all, however many paths it happens to contain.
      entities: doc.capabilities.entities,
      // The glossary table itself is the gate; `capabilities.glossary` also
      // requires ≥2 entries, so a one-word glossary renders no chips.
      glossary: doc.capabilities.glossary ? (doc.glossary ?? []) : [],
      backlinks: doc.indexes.backlinks,
      titles,
      descriptions,
      fileExtensions,
    }
  }, [doc, slugs, onNavigate, descriptions, fileExtensions])

  return (
    <div className="reader" data-reduced-motion={prefersReducedMotion() ? 'true' : 'false'}>
      {/*
        The introduction gets a real anchor (`#intro`) because it is indexed
        under that slug: a search hit on the introduction has to land somewhere,
        and "somewhere" must be a place the reader can be sent back to.
      */}
      <div id={`section-${INTRO_SLUG}`} className="reader-intro" tabIndex={-1} data-slug={INTRO_SLUG}>
        {renderBlocks(doc.intro, { ...context, sectionSlug: INTRO_SLUG }, 'intro')}
      </div>
      {doc.sections.map((section) => renderSection(section, contextFor(context, section.slug), flash, 2))}
      {doc.sections.length === 0 && doc.intro.length === 0 ? (
        <p className="reader-empty">This document has no readable content.</p>
      ) : null}
    </div>
  )
}
