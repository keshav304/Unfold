/**
 * Which section, if any, a graph node is about.
 *
 * §7.6 says a node's panel shows a section title, its first prose block and its
 * file chips, and "Open section" goes to the reader at that slug. Which section
 * that is depends on the mode, and the two modes answer differently:
 *
 *   - **Derived** (M3.3): the pipeline built the nodes from the H2 sections
 *     themselves, so the node id *is* the slug. The mapping is total, and this
 *     module is a lookup.
 *   - **Explicit**: the author wrote the ids. `browser`, `api`, `db` are not
 *     slugs, and the DSL (§6.7) has no syntax for pointing a node at a section.
 *     So an explicit node resolves when — and only when — its id matches a
 *     section's slug, which is what an author does when they mean it to.
 *
 * A node that resolves to nothing is still a node: the panel shows the graph's
 * own label and subtitle, the "Open section" action is *disabled* rather than
 * hidden, and a dev-mode warning says which id did not resolve. The alternative
 * — dropping the action — would leave a panel with no way onward and no
 * explanation, and inventing a section for an unmatched id would be a fiction
 * (§1.1).
 *
 * This is lookup, not derivation. No thresholds, no links, no graph semantics
 * are recomputed here; the pipeline already decided what the graph is (M3.3).
 */

import { flattenSections } from '../../pipeline/indexes'
import type { Doc, Section } from '../../pipeline/types'

export type NodeTarget = {
  /** The slug "Open section" navigates to, when there is one. */
  slug: string | null
  /** The section itself, when the node resolved. */
  section: Section | null
}

/** Every section in the document, flattened, for a slug lookup. */
export function sectionsBySlug(doc: Doc): Map<string, Section> {
  return new Map(flattenSections(doc.sections).map((section) => [section.slug, section]))
}

/**
 * Resolve one node id against the document.
 *
 * The id is lowercased before lookup, because §6.4 makes anchors
 * case-insensitive and a derived node id is a slug verbatim while an authored
 * one is whatever the author typed.
 */
export function targetForNode(
  id: string,
  bySlug: ReadonlyMap<string, Section>,
): NodeTarget {
  const direct = bySlug.get(id)
  if (direct !== undefined) return { slug: direct.slug, section: direct }
  const lower = id.trim().toLowerCase()
  const caseInsensitive = bySlug.get(lower)
  if (caseInsensitive !== undefined) return { slug: caseInsensitive.slug, section: caseInsensitive }
  return { slug: null, section: null }
}

/** Every node id in a spec that resolves to no section. */
export function unresolvedNodeIds(doc: Doc, nodeIds: readonly string[]): string[] {
  const bySlug = sectionsBySlug(doc)
  return nodeIds.filter((id) => targetForNode(id, bySlug).section === null)
}