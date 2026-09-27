/**
 * Inline content rendering: text, emphasis, strong, inline code, links, and the
 * entity chips that §6.5 hangs off prose.
 *
 * Internal links (`#slug`) resolve in-app (scroll + flash). Unresolvable ones
 * render as muted text with a tooltip — never as broken navigation (§6.4).
 * No `dangerouslySetInnerHTML` anywhere (§4).
 *
 * **Chips are produced here, not by the block renderers.** One code path means
 * a file path is a chip in a paragraph, in a list item, in a blockquote and in
 * a table cell (A3) — and it means the rule 'never inside a fenced block' is
 * enforced in exactly one place, by the fact that fenced blocks never reach
 * this function.
 */

import type { Content, RootContent } from 'mdast'
import { Fragment, type ReactNode } from 'react'
import { internalLinksOf } from '../../pipeline/blocks'
import { extractEntities } from '../../pipeline/entities'
import { navigate } from '../navigate'
import { EntityChip, GlossaryChip } from '../components/EntityChip'
import type { ChipTarget } from '../components/EntityChip'

export type InlineContext = {
  /** Slugs that exist in the document. */
  slugs: ReadonlySet<string>
  /** Called after an in-app navigation so the shell can flash the target. */
  onNavigate?: (slug: string) => void
  /**
   * The section currently being rendered, so a chip's popover can exclude it
   * from its own backlink list and so per-section dedupe (§6.5) has a scope.
   */
  sectionSlug?: string
  /** Chips are rendered only when the document is capable of them (§1.1). */
  entities?: boolean
  /** Glossary chips need the `glossary` capability and the term table. */
  glossary?: { term: string; aliases: string[]; definition: string }[]
  /** `filePath` → the sections mentioning it (§6.6). */
  backlinks?: Record<string, string[]>
  /** Slug → section title, to label backlinks. */
  titles?: ReadonlyMap<string, string>
  /** Config-extensible description map; empty by default (§7.5). */
  descriptions?: Record<string, string>
  /**
   * The document's link reference definitions, `[label]: url`.
   *
   * Needed whenever a reference link is present: mdast gives a
   * `linkReference` node only a label and an identifier, so without the
   * definitions the renderer has no URL to put on it.
   */
  linkDefinitions?: Record<string, { url: string; title?: string }>
  /**
   * The configured file-extension list (spec §1.4, §6.5).
   *
   * This is not optional in spirit: `extractEntities` matches a dotted token
   * only when its extension is in the list, so a renderer that omits it silently
   * produces *zero* chips. The renderer must not carry its own list, and it must
   * not fall back to a default either — the deployer's list is the truth.
   */
  fileExtensions: readonly string[]
}

function childrenOf(
  node: Content | RootContent,
  context?: InlineContext,
): ReactNode {
  const node_ = node as { children?: Content[] }
  const children = node_.children ?? []
  return children.map((child, index) => renderInline(child, index, context))
}

/* ------------------------------------------------------------------ *
 * Chip matching
 *
 * The patterns are the pipeline's, not a second copy. `extractEntities` is the
 * only definition of 'what is a file path' (spec §6.5); if the renderer had its
 * own regex the two would drift, and a chip would appear on a string the
 * extractor never recorded — which is precisely the 'fictional entity' failure
 * §1.1 forbids.
 * ------------------------------------------------------------------ */

/** One match inside a text run, resolved to the chip that should render it. */
type TextMatch = { start: number; end: number; target: ChipTarget }

type Matcher = {
  fileFamily: (text: string) => TextMatch[]
  glossaryFamily: (text: string) => TextMatch[]
}

const NO_MATCHES: Matcher = { fileFamily: () => [], glossaryFamily: () => [] }

/**
 * Build the matchers for one context, once per context object.
 *
 * A memo keyed on the identity of the pieces the patterns depend on. The
 * patterns are the expensive part and the context is rebuilt per section, so
 * without this every section would recompile the glossary alternation.
 */
function matcherFor(context: InlineContext | undefined): Matcher {
  if (context === undefined) return NO_MATCHES
  const glossary = context.glossary ?? []
  if (context.entities !== true && glossary.length === 0) return NO_MATCHES

  const fileFamily =
    context.entities === true
      ? fileMatchesIn(context.fileExtensions)
      : () => []
  const glossaryFamily =
    glossary.length === 0 ? () => [] : glossaryMatchesIn(glossary)

  return { fileFamily, glossaryFamily }
}

const matcherCache = new WeakMap<InlineContext, Matcher>()

function matcher(context: InlineContext | undefined): Matcher {
  if (context === undefined) return NO_MATCHES
  const cached = matcherCache.get(context)
  if (cached !== undefined) return cached
  const built = matcherFor(context)
  matcherCache.set(context, built)
  return built
}

/**
 * Locate file/test/symbol mentions in one text run.
 *
 * `extractEntities` returns whole matches without offsets, so the offset is
 * recovered here with a forward scan of the same (case-sensitive) string. A
 * lowercase-insensitive locate would mis-place a path whose case differs
 * between the regex's view and the DOM's.
 */
function fileMatchesIn(
  extensions: readonly string[],
): (text: string) => TextMatch[] {
  return (text: string) => {
    const { files, tests } = extractEntities([text], {
      fileExtensions: extensions,
    })
    const out: TextMatch[] = []
    for (const test of tests) {
      const at = text.indexOf(test.id)
      if (at === -1) continue
      out.push({
        start: at,
        end: at + test.id.length,
        target: { kind: 'file', path: test.path, testId: test.testId },
      })
    }
    for (const file of files) {
      const written =
        file.symbol === undefined ? file.path : `${file.path}::${file.symbol}`
      const at = text.indexOf(written)
      if (at === -1) continue
      out.push({
        start: at,
        end: at + written.length,
        target:
          file.symbol === undefined
            ? { kind: 'file', path: file.path }
            : { kind: 'file', path: file.path, symbol: file.symbol },
      })
    }
    return out.sort((a, b) => a.start - b.start)
  }
}

/**
 * Locate glossary terms and aliases in one text run. The extractor is the
 * authority on word boundaries and longest-alternative-wins (spec §6.5); this
 * only recovers offsets.
 */
function glossaryMatchesIn(
  glossary: readonly { term: string; aliases: string[] }[],
): (text: string) => TextMatch[] {
  return (text: string) => {
    const { glossaryHits } = extractEntities([text], {
      glossary: [...glossary],
    })
    const out: TextMatch[] = []
    for (const hit of glossaryHits) {
      // The hit text is the matched span; find *that* span, not the term, so an
      // alias hit is placed where the alias was actually written.
      const at = text.toLowerCase().indexOf(hit.text.toLowerCase())
      if (at === -1) continue
      out.push({
        start: at,
        end: at + hit.text.length,
        target: { kind: 'glossary', term: hit.term, isAlias: hit.isAlias },
      })
    }
    return out.sort((a, b) => a.start - b.start)
  }
}

/**
 * Overlapping matches resolved in favour of the earlier, longer one. A glossary
 * term inside a file path (`src/adapter.ts` when `Adapter` is a term) must not
 * produce two chips for one span of text.
 */
function dedupeMatches(matches: TextMatch[]): TextMatch[] {
  const out: TextMatch[] = []
  let consumed = 0
  for (const match of matches) {
    if (match.start < consumed) continue
    out.push(match)
    consumed = match.end
  }
  return out
}

/** The backlinks a file target should show, resolved to titles (§6.6). */
function backlinksFor(
  target: ChipTarget,
  context: InlineContext,
): { slug: string; title: string }[] {
  if (target.kind !== 'file') return []
  const slugs = context.backlinks?.[target.path.toLowerCase()] ?? []
  const titles = context.titles
  return slugs.map((slug) => ({ slug, title: titles?.get(slug) ?? slug }))
}

/** The description for a target from the config map; empty by default (§7.5). */
function descriptionFor(
  target: ChipTarget,
  context: InlineContext,
): string | undefined {
  const descriptions = context.descriptions
  if (descriptions === undefined) return undefined
  if (target.kind === 'glossary') return descriptions[target.term]
  return (
    descriptions[target.path] ??
    descriptions[`${target.path}::${target.symbol ?? ''}`]
  )
}

function definitionFor(
  target: ChipTarget,
  context: InlineContext,
): string | undefined {
  if (target.kind !== 'glossary') return undefined
  return context.glossary?.find((entry) => entry.term === target.term)
    ?.definition
}

/** One chip, wired to its popover data. The only place a chip is created. */
function renderChip(
  target: ChipTarget,
  text: string,
  key: number,
  context: InlineContext,
): ReactNode {
  const shared = {
    sectionSlug: context.sectionSlug ?? '',
    backlinks: backlinksFor(target, context),
    description: descriptionFor(target, context),
    definition: definitionFor(target, context),
    onNavigate: (slug: string) => context.onNavigate?.(slug),
  }
  if (target.kind === 'glossary') {
    return (
      <GlossaryChip
        key={key}
        term={target.term}
        isAlias={target.isAlias}
        {...shared}
      >
        {text}
      </GlossaryChip>
    )
  }
  return (
    <EntityChip key={key} target={target} {...shared}>
      {text}
    </EntityChip>
  )
}

/**
 * A text run, split into plain spans and chips.
 *
 * `inline: true` means the run came from a backticked span, where the file
 * family reads (A2 / §6.5) but the glossary family does not. Passing it as a
 * flag rather than checking the node type twice keeps the two families'
 * reachability in one readable place.
 */
function renderTextWithChips(
  text: string,
  key: number,
  context: InlineContext | undefined,
  options: { inline: boolean },
): ReactNode {
  if (context === undefined) return <Fragment key={key}>{text}</Fragment>
  const { fileFamily, glossaryFamily } = matcher(context)
  const matches = dedupeMatches([
    ...fileFamily(text),
    ...(options.inline ? [] : glossaryFamily(text)),
  ])
  if (matches.length === 0) return <Fragment key={key}>{text}</Fragment>

  const parts: ReactNode[] = []
  let cursor = 0
  for (const match of matches) {
    if (match.start > cursor)
      parts.push(
        <Fragment key={`${key}-t${cursor}`}>
          {text.slice(cursor, match.start)}
        </Fragment>,
      )
    parts.push(
      renderChip(
        match.target,
        text.slice(match.start, match.end),
        key * 1000 + parts.length,
        context,
      ),
    )
    cursor = match.end
  }
  if (cursor < text.length)
    parts.push(
      <Fragment key={`${key}-t${cursor}`}>{text.slice(cursor)}</Fragment>,
    )
  return <Fragment key={key}>{parts}</Fragment>
}

export function renderInline(
  node: Content | RootContent,
  key: number,
  context?: InlineContext,
): ReactNode {
  switch (node.type) {
    case 'text':
      return renderTextWithChips(node.value, key, context, { inline: false })

    case 'emphasis':
      return <em key={key}>{childrenOf(node, context)}</em>

    case 'strong':
      return <strong key={key}>{childrenOf(node, context)}</strong>

    case 'delete':
      return <del key={key}>{childrenOf(node, context)}</del>

    case 'inlineCode':
      // A2: the mono pill *is* the chip when the span names a file, so an
      // author who writes `src/app.ts` gets a chip with no extra markup.
      return (
        <code key={key} className='inline-code'>
          {renderTextWithChips(node.value, key, context, { inline: true })}
        </code>
      )

    case 'break':
      return <br key={key} />

    case 'link':
      return renderLink(node, key, context)

    case 'linkReference':
      return renderLinkReference(node, key, context)

    case 'imageReference': {
      // `[alt][ref]` — the same shape as a link, but an image. Resolved through
      // the definitions; unresolved, it degrades to its alt text rather than to
      // nothing.
      const definition = context?.linkDefinitions?.[(node.identifier ?? '').toLowerCase()]
      if (definition === undefined) return <Fragment key={key}>{node.alt ?? ''}</Fragment>
      return (
        <img
          key={key}
          className="inline-image"
          src={definition.url}
          alt={node.alt ?? ''}
          title={definition.title ?? node.alt ?? undefined}
          loading="lazy"
        />
      )
    }

    case 'image': {
      const src = node.url
      const external = /^https?:/iu.test(src)
      return (
        <img
          key={key}
          className='inline-image'
          src={src}
          alt={node.alt ?? ''}
          title={node.alt ?? undefined}
          loading='lazy'
          {...(external ? { referrerPolicy: 'no-referrer' } : {})}
        />
      )
    }

    default: {
      const value =
        'value' in node && typeof node.value === 'string' ? node.value : ''
      return <Fragment key={key}>{value}</Fragment>
    }
  }
}

/**
 * `[label][ref]`, resolved through the document's own definitions.
 *
 * The stranger round found this: a reference link reached the default branch,
 * which has no `value` to render, so ``See [`contributing.md`][contrib]`` came
 * out as "See  in…" — the author's text deleted, and any chip inside it deleted
 * with it. Reference links are common in exactly the READMEs this app is meant
 * to be pointed at.
 *
 * An unresolved reference keeps its label as plain text: the same rule §6.4 sets
 * for internal links, and the only one that does not drop words.
 */
function renderLinkReference(
  node: Extract<Content, { type: 'linkReference' }>,
  key: number,
  context?: InlineContext,
): ReactNode {
  const definition = context?.linkDefinitions?.[(node.identifier ?? '').toLowerCase()]
  if (definition === undefined) return <Fragment key={key}>{childrenOf(node, context)}</Fragment>

  // Reshaped into a plain link and handed to the same code path, so a reference
  // link cannot drift from an inline one. A `linkReference` node has no title
  // of its own, so the definition's is the one that applies.
  const link: Extract<Content, { type: 'link' }> = {
    type: 'link',
    url: definition.url,
    children: node.children,
    ...(definition.title === undefined ? {} : { title: definition.title }),
  }
  return renderLink(link, key, context)
}

function renderLink(
  node: Extract<Content, { type: 'link' }>,
  key: number,
  context?: InlineContext,
): ReactNode {
  const label = node.children
    .map((child) =>
      'value' in child && typeof child.value === 'string' ? child.value : '',
    )
    .join('')

  // Only `#slug` hrefs are internal. Everything else is a normal link.
  if (!node.url.startsWith('#') || node.url.length < 2) {
    const external = /^[a-z][a-z0-9+.-]*:/iu.test(node.url)
    return (
      <a
        key={key}
        className='inline-link'
        href={node.url}
        title={node.title ?? undefined}
        {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
      >
        {/*
          With the context, not without it. Dropping it here meant a link label
          rendered as inert text: a file path in `See [src/a.ts](https://…)` got
          no chip, and a nested `#slug` link inside an external link silently
          stopped resolving.
        */}
        {childrenOf(node, context)}
      </a>
    )
  }

  let slug = node.url.slice(1)
  try {
    slug = decodeURIComponent(slug)
  } catch {
    // A malformed escape is still a link; use it verbatim.
  }
  slug = slug.trim().toLowerCase()

  if (context === undefined || !context.slugs.has(slug)) {
    // §6.4: unresolvable internal links are muted with a tooltip, not broken.
    return (
      <span
        key={key}
        className='inline-link inline-link--unresolved'
        title='This section does not exist in this document.'
      >
        {childrenOf(node)}
        <span className='visually-hidden'> (unresolved link: {label})</span>
      </span>
    )
  }

  return (
    <a
      key={key}
      className='inline-link inline-link--internal'
      href={`#${slug}`}
      title={node.title ?? undefined}
      onClick={(event) => {
        event.preventDefault()
        navigate(slug, context.onNavigate)
      }}
    >
      {childrenOf(node)}
    </a>
  )
}

/** Every internal link target declared inside a node, for the reader to index. */
export { internalLinksOf }
