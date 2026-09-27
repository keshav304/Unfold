/**
 * The pipeline (spec §6.2): `markdown text → Doc`. A pure function — no DOM, no
 * fetch, no globals beyond the warning sink. Everything a view needs is either
 * in the `Doc` or derived from it.
 *
 * The one principle: the document is data. Anything the document does not
 * provide is simply absent from the Doc, and the app hides the feature.
 */

import type { Root, RootContent } from 'mdast'
import { splitFrontmatter } from './frontmatter'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

import { detectCapabilities } from './capabilities'
import { tableCellText } from './blocks'
import { DEFAULT_CONFIG, type UnfoldConfig } from './config'
import { deriveGraph, type CrossLink } from './derive-graph'
import { extractEntities, proseRunsOf } from './entities'
import { buildGlossary } from './glossary'
import { buildBacklinks, buildSearchRecords, flattenSections } from './indexes'
import { blocksToPlainText, countWords, toPlainText } from './mdast-text'
import { splitSections } from './sections'
import { Slugger } from './slug'
import type { Block, Doc, FileRef, GraphSpec, StepSpec, TestRef } from './types'
import { warn } from './warn'

export type ParseOptions = {
  /** Used for the title fallback chain (spec §7.2). */
  fileName?: string
  config?: UnfoldConfig
}

/** Title chain: config override > frontmatter > H1 > filename (spec §7.2). */
function resolveTitle(input: {
  configTitle: string | undefined
  frontmatterTitle: string
  h1Title: string | undefined
  fileName: string
}): { title: string; source: Doc['titleSource'] } {
  if (input.configTitle !== undefined && input.configTitle !== '') {
    return { title: input.configTitle, source: 'frontmatter' }
  }
  if (input.frontmatterTitle !== '') {
    return { title: input.frontmatterTitle, source: 'frontmatter' }
  }
  if (input.h1Title !== undefined && input.h1Title !== '') {
    return { title: input.h1Title, source: 'h1' }
  }
  return { title: filenameToTitle(input.fileName), source: 'filename' }
}

function filenameToTitle(fileName: string): string {
  const base = fileName.split('/').pop() ?? ''
  const withoutExt = base.replace(/\.[^.]+$/u, '')
  if (withoutExt === '') return 'Untitled'
  return withoutExt
    .replace(/[-_]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/\b\p{L}/gu, (character) => character.toUpperCase())
}

/** Prose-only text of a block, for indexing and word counts. */
export function blockToProseText(block: Block): string {
  switch (block.kind) {
    case 'prose':
    case 'quote':
      return toPlainText(block.node)
    case 'code':
    case 'terminal':
    case 'mermaid':
    case 'hr':
    case 'html':
      return ''
    case 'table':
      return [...block.header, ...block.rows.flat()].map(tableCellText).join(' ')
    case 'loop':
      return block.labels.join(' ')
    case 'list':
      return blocksToPlainText(block.items)
    case 'graph':
      return [
        ...block.spec.nodes.map((node) => `${node.label} ${node.sub ?? ''}`.trim()),
        ...block.spec.edges.map((edge) => `${edge.from} ${edge.to} ${edge.label ?? ''}`.trim()),
      ].join(' ')
    case 'steps':
      return block.spec.map((step) => `${step.title} ${step.description ?? ''}`.trim()).join(' ')
    default:
      return ''
  }
}

/** Parse markdown into the document model. Never throws. */
export function parseDocument(source: string, options: ParseOptions = {}): Doc {
  const config = options.config ?? DEFAULT_CONFIG
  const fileName = options.fileName ?? ''

  const split_ = splitFrontmatter(source)
  const body = split_.body
  const frontmatter = split_.data
  if (split_.malformed === true) {
    // A broken frontmatter block must not cost us the document body.
    warn('frontmatter', 'frontmatter is not a YAML mapping; the block was skipped')
  }

  let root: Root
  try {
    root = unified().use(remarkParse).use(remarkGfm).parse(body) as Root
  } catch (error) {
    warn('parse', 'markdown could not be parsed; the document is empty', String(error))
    root = { type: 'root', children: [] }
  }

  const split = splitSections(root.children as RootContent[], new Slugger())
  const sections = split.sections
  const flat = flattenSections(sections)

  /* ---------------- frontmatter fields (spec §6.2) ---------------------- */
  const fmTitle = typeof frontmatter['title'] === 'string' ? frontmatter['title'].trim() : ''
  const fmDescription = typeof frontmatter['description'] === 'string' ? frontmatter['description'].trim() : ''
  const { title, source: titleSource } = resolveTitle({
    configTitle: config.title,
    frontmatterTitle: fmTitle,
    h1Title: split.h1Title,
    fileName,
  })

  /* ---------------- explicit graph / steps: first block wins ------------- */
  // The introduction counts: a `graph` or `steps` block above the first H2 is
  // still a block the document provides.
  let explicitGraph: GraphSpec | undefined
  const steps: StepSpec[] = []
  for (const block of [...split.intro, ...flat.flatMap((section) => section.blocks)]) {
    if (block.kind === 'graph' && explicitGraph === undefined) explicitGraph = block.spec
    if (block.kind === 'steps') steps.push(...block.spec)
  }

  /* ---------------- per-section annotation ------------------------------- */
  const slugByLower = new Map<string, string>()
  for (const section of flat) slugByLower.set(section.slug.toLowerCase(), section.slug)

  const parentOf = new Map<string, string>()
  for (const section of sections) {
    for (const child of section.children) parentOf.set(child.slug, section.slug)
  }

  const glossary = buildGlossary(sections)
  const entityOptions = {
    fileExtensions: config.fileExtensions,
    extraPatterns: config.entityPatterns,
    glossary: glossary.map((entry) => ({ term: entry.term, aliases: entry.aliases })),
  }

  const filesBySection = new Map<string, FileRef[]>()
  const testsBySection = new Map<string, TestRef[]>()
  const crossLinks: CrossLink[] = []
  const unresolvedLinks: Doc['unresolvedLinks'] = []

  /** Resolve a link href to a known slug, or record it as unresolved (§6.4). */
  const canonical = (href: string, from: string): string | undefined => {
    const known = slugByLower.get(href.toLowerCase())
    if (known === undefined) {
      if (!unresolvedLinks.some((entry) => entry.from === from && entry.to === href)) {
        unresolvedLinks.push({ from, to: href })
      }
      return undefined
    }
    return known
  }

  const noteCrossLinks = (owner: string, hrefs: readonly string[]) => {
    const from = parentOf.get(owner) ?? owner
    for (const href of hrefs) {
      const target = canonical(href, owner)
      if (target === undefined) continue
      const to = parentOf.get(target) ?? target
      // A self-link is valid navigation but never a graph edge.
      if (from === to) continue
      crossLinks.push({ from, to, targetSlug: target })
    }
  }

  for (const section of flat) {
    const extracted = extractEntities(proseRunsOf(section.blocks), entityOptions)
    filesBySection.set(section.slug, extracted.files)
    testsBySection.set(section.slug, extracted.tests)
    section.files = extracted.files
    section.tests = extracted.tests

    const body_ = section.blocks
      .map((block) => blockToProseText(block))
      .filter((text) => text !== '')
      .join('\n\n')
    const childTitles = section.children.map((child) => child.title).join(' ')
    section.text = [section.title, body_, childTitles].filter((part) => part !== '').join('\n\n')
    section.wordCount = countWords(body_)

    // Rewrite hrefs to canonical slugs so `linksTo` is always resolvable.
    section.linksTo = section.linksTo
      .map((href) => canonical(href, section.slug))
      .filter((slug): slug is string => slug !== undefined)
    noteCrossLinks(section.slug, section.linksTo)
  }
  noteCrossLinks('', split.introLinks)

  /* ---------------- derived graph: only without an explicit block -------- */
  const derived =
    explicitGraph === undefined
      ? deriveGraph(sections, crossLinks)
      : { derived: false as const, links: [] as CrossLink[], linkedSections: [] as string[] }
  if (!derived.derived && derived.reason !== undefined) {
    warn('derive', 'no derived document map', `reason: ${derived.reason}`)
  }

  /* ---------------- resolve @slug step references (spec §6.8) ------------ */
  for (const step of steps) {
    if (step.sourceRef === undefined) continue
    const known = slugByLower.get(step.sourceRef.toLowerCase())
    if (known === undefined) {
      warn('steps', `step source "@${step.sourceRef}" does not match a section`, step.title)
      continue
    }
    step.source = known
  }

  /* ---------------- document-wide entity threshold (spec §1.1) ----------- */
  const introExtracted = extractEntities(proseRunsOf(split.intro), entityOptions)
  // A test id is still a file path for the document-wide threshold (§1.1), so
  // both kinds count toward `entities`.
  const filePaths = Array.from(
    new Set([
      ...flat.flatMap((section) => [
        ...(filesBySection.get(section.slug) ?? []).map((file) => file.path),
        ...(testsBySection.get(section.slug) ?? []).map((test) => test.path),
      ]),
      ...introExtracted.files.map((file) => file.path),
      ...introExtracted.tests.map((test) => test.path),
    ]),
  ).sort()

  /* ---------------- capabilities (spec §1.1) ----------------------------- */
  const capabilities = detectCapabilities({
    blocks: split.intro,
    sections,
    glossary,
    filePaths,
    ...(explicitGraph === undefined ? {} : { explicitGraph }),
    ...(derived.derived && derived.spec !== undefined ? { derivedGraph: derived.spec } : {}),
    ...(steps.length === 0 ? {} : { steps }),
    features: config.features,
  })

  /* ---------------- stats (spec §7.2) ------------------------------------ */
  const allBlocks: Block[] = [...split.intro, ...flat.flatMap((section) => section.blocks)]
  const introText = split.intro.map((block) => blockToProseText(block)).join('\n\n').trim()
  const codeBlocks = allBlocks.filter((block) => block.kind === 'code' || block.kind === 'terminal').length
  const diagrams = allBlocks.filter(
    (block) =>
      block.kind === 'mermaid' || block.kind === 'graph' || block.kind === 'loop' || block.kind === 'steps',
  ).length

  /* ---------------- indexes (spec §6.6) ---------------------------------- */
  const sectionText: Record<string, string> = {}
  for (const section of flat) sectionText[section.slug] = section.text

  const doc: Doc = {
    title,
    titleSource,
    intro: split.intro,
    sections,
    capabilities,
    stats: {
      words: countWords([introText, ...flat.map((section) => section.text)].join(' ')),
      sections: sections.length,
      codeBlocks,
      diagrams,
    },
    indexes: {
      records: buildSearchRecords({
        sections,
        intro: split.intro.map((block) => ({ text: blockToProseText(block) })),
        filesBySection,
        testsBySection,
        glossary,
      }),
      sectionText,
      backlinks: buildBacklinks(filesBySection),
      filePaths,
    },
    unresolvedLinks,
  }
  if (fmDescription !== '') doc.description = fmDescription
  if (glossary.length > 0) doc.glossary = glossary
  if (steps.length > 0) doc.steps = steps
  if (explicitGraph !== undefined) doc.graph = { spec: explicitGraph, derived: false }
  else if (derived.derived && derived.spec !== undefined) doc.graph = { spec: derived.spec, derived: true }

  return doc
}
