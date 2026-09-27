/**
 * The reader view (spec §7.1). Renders the document as a column of blocks and
 * nothing else: no view decides its own chrome, and a document with no
 * sections still renders its introduction.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Block, Doc } from '../../pipeline/types'
import { INTRO_SLUG } from '../../pipeline/constants'
import { flattenSections } from '../../pipeline/indexes'
import { BlockView } from '../blocks/BlockView'
import { navigate, prefersReducedMotion } from '../navigate'
import { filterBlocksForMode, sectionIsReduced, type ReadingMode } from '../modes/reading-mode'
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
  /** §7.8. Defaults to `reference`, so a caller that forgets it loses nothing. */
  mode?: ReadingMode
  /** §7.8's per-section override: slugs the reader has expanded. */
  isExpanded?: (slug: string) => boolean
  onToggleSection?: (slug: string) => void
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
  mode: ReadingMode,
  isExpanded: (slug: string) => boolean,
  onToggleSection: ((slug: string) => void) | undefined,
): ReactNode {
  const Heading = level === 2 ? 'h2' : 'h3'
  // §7.8: the per-section "show all" override outranks the mode for this one
  // section, which is the whole point of it — a reader who has opened a section
  // is reading that section, whatever the rest of the document is doing.
  const expanded = isExpanded(section.slug)
  const shown = filterBlocksForMode(section.blocks, level, expanded ? 'reference' : mode)
  // A4: the override exists only where it has something to reveal *right now*.
  // The reduction is asked about `mode`, not about `'executive'` — checking
  // against a hardcoded mode offers a "show all" button in reference mode,
  // where every section is already showing all of itself.
  const canExpand = onToggleSection !== undefined && (expanded || sectionIsReduced(section.blocks, level, mode))
  return (
    <section
      key={section.slug}
      id={`section-${section.slug}`}
      className={`reader-section reader-section--h${level}`}
      data-slug={section.slug}
      data-expanded={expanded ? 'true' : 'false'}
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
      {renderBlocks(shown, context, section.slug)}
      {canExpand ? (
        <button
          type="button"
          className="section-expand t-label-caps"
          aria-expanded={expanded}
          onClick={() => onToggleSection(section.slug)}
        >
          {expanded ? 'Show less' : 'Show all'}
        </button>
      ) : null}
      {section.children.map((child) =>
        renderSection(child, context, flash, 3, mode, isExpanded, onToggleSection),
      )}
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
  mode = 'reference',
  isExpanded = () => false,
  onToggleSection,
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
      // Only carried when the document declares any; `exactOptionalPropertyTypes`
      // will not accept an explicit `undefined` here.
      ...(doc.linkDefinitions === undefined ? {} : { linkDefinitions: doc.linkDefinitions }),
    }
  }, [doc, slugs, onNavigate, descriptions, fileExtensions])

  // §7.8: "transition animates". The stylesheet needs two different
  // `animation-name`s to re-fire the same keyframes on a second change, so the
  // reader is handed the direction it moved in. Cleared once the animation has
  // had its `--motion-slow` to play, so the attribute is not lying about the
  // present a moment later.
  const [flip, setFlip] = useState<'to-executive' | 'to-reference' | null>(null)
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    setFlip(mode === 'executive' ? 'to-executive' : 'to-reference')
    const timer = window.setTimeout(() => setFlip(null), 300)
    return () => window.clearTimeout(timer)
  }, [mode])

  return (
    <div
      className="reader"
      data-reading-mode={mode}
      {...(flip === null ? {} : { 'data-mode-flip': flip })}
      data-reduced-motion={prefersReducedMotion() ? 'true' : 'false'}
    >
      {/*
        The introduction gets a real anchor (`#intro`) because it is indexed
        under that slug: a search hit on the introduction has to land somewhere,
        and "somewhere" must be a place the reader can be sent back to.

        It is rendered in full in **both** modes. §7.8's rule is stated per H2,
        and this is the prose before the first H2 — reducing it would make the
        one part of a document that every reader needs (what this is, why it
        exists) the part a skimming reader loses. See `modes/reading-mode.ts`.
      */}
      <div id={`section-${INTRO_SLUG}`} className="reader-intro" tabIndex={-1} data-slug={INTRO_SLUG}>
        {renderBlocks(doc.intro, { ...context, sectionSlug: INTRO_SLUG }, 'intro')}
      </div>
      {doc.sections.map((section) =>
        renderSection(section, contextFor(context, section.slug), flash, 2, mode, isExpanded, onToggleSection),
      )}
      {doc.sections.length === 0 && doc.intro.length === 0 ? (
        <p className="reader-empty">This document has no readable content.</p>
      ) : null}
    </div>
  )
}
