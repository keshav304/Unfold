/**
 * Derived document map (spec §6.7, second half). Only used when the document has
 * no explicit `graph` block. Both thresholds must hold:
 *
 *   - ≥ DERIVED_GRAPH_MIN_LINKS valid internal cross-links
 *   - ≥ DERIVED_GRAPH_MIN_SECTIONS distinct H2 sections appearing as a link
 *     source or target
 *
 * Nodes are H2 sections. Edges are internal links; a link from an H3 resolves to
 * its parent H2, and self-links are ignored. Below threshold there is no graph
 * at all — the capability is simply off.
 */

import { DERIVED_GRAPH_MIN_LINKS, DERIVED_GRAPH_MIN_SECTIONS } from './constants'
import type { GraphSpec } from './dsl/types'
import type { Section } from './types'

/** One internal cross-link between two top-level sections. */
export type CrossLink = {
  from: string
  to: string
  /** The H3 (or H2) slug the link text pointed at. */
  targetSlug: string
}

export type DerivationResult = {
  /** True when both thresholds hold. */
  derived: boolean
  links: CrossLink[]
  /** Distinct H2 slugs that appear as a link source or target. */
  linkedSections: string[]
  /** Why derivation was refused — surfaced in dev mode, never in the UI. */
  reason?: 'too-few-links' | 'too-few-sections' | 'no-h2-sections' | 'not-enough'
  spec?: GraphSpec
}

/** The H2 slug a slug belongs to, or the slug itself if it is already an H2. */
export function resolveToH2(sections: readonly Section[], slug: string): string | undefined {
  for (const section of sections) {
    if (section.slug === slug) return section.slug
    for (const child of section.children) {
      if (child.slug === slug) return section.slug
    }
  }
  return undefined
}

export function deriveGraph(
  sections: readonly Section[],
  links: readonly CrossLink[],
): DerivationResult {
  const linkedSections = Array.from(new Set(links.flatMap((link) => [link.from, link.to])))

  if (sections.length === 0) {
    return { derived: false, links: [...links], linkedSections, reason: 'no-h2-sections' }
  }
  if (links.length < DERIVED_GRAPH_MIN_LINKS) {
    return { derived: false, links: [...links], linkedSections, reason: 'too-few-links' }
  }
  if (linkedSections.length < DERIVED_GRAPH_MIN_SECTIONS) {
    return { derived: false, links: [...links], linkedSections, reason: 'too-few-sections' }
  }

  const nodes = sections.map((section) => ({ id: section.slug, label: section.title }))
  const edges: GraphSpec['edges'] = []
  const seen = new Set<string>()

  for (const link of links) {
    if (link.from === link.to) continue
    const key = `${link.from}->${link.to}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push({ from: link.from, to: link.to })
  }

  return { derived: true, links: [...links], linkedSections, spec: { nodes, edges } }
}
