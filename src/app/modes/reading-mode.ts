/**
 * Reading modes (spec §7.8): **Reference** shows everything, **Executive**
 * reduces each section to its summary. Pure — no DOM, no React, no storage
 * side effects beyond the two functions at the bottom — so the heuristic is
 * testable against the fixtures without a browser.
 *
 * ## The rule, read as an allowlist
 *
 * §7.8 states the reduction twice, positively ("title + first prose block + all
 * tables + blockquotes" for an H2, "title + first paragraph" for an H3) and once
 * as a denylist ("code/terminal/mermaid/lists hidden"). The positive statement
 * is the implementable one, so it is what `filterBlocksForMode` applies, and the
 * denylist falls out of it. That matters for the block kinds §7.8 does not name
 * — `loop`, `graph`, `steps`, `hr`, `html` — which an allowlist therefore hides
 * and a denylist would have left visible. `html` is raw markup shown as source
 * and `graph`/`steps` render as code in the reader, so hiding them is right
 * anyway; see `docs/DECISIONS.md`.
 *
 * ## The introduction is not a section
 *
 * §7.8 says "**per H2**", and the introduction is the prose before the first
 * H2 — it has no heading of its own. It is therefore never reduced, in either
 * mode. That is also what makes `no-structure.md` render identically in both
 * modes: a document with zero sections has only an introduction, and a mode
 * that only ever acts on sections has nothing to act on. Filtering the
 * introduction would have made a document with no H2s the *only* document the
 * mode changes, which is precisely backwards.
 */

import type { Block } from '../../pipeline/types'

/** §7.8. `reference` is the default; nothing is remembered unless it was set. */
export type ReadingMode = 'reference' | 'executive'

/**
 * Where the mode is remembered. Namespaced so it cannot collide with anything
 * the host page keeps in the same origin, and stable so a returning reader gets
 * the mode they left.
 */
export const MODE_STORAGE_KEY = 'unfold:reading-mode'

/**
 * The blocks an H2 keeps in executive mode: its first prose block, then every
 * table and every blockquote, in document order.
 *
 * "First prose block" is the first `prose` block *specifically* — not the first
 * block. A section that opens with a table still gets its lead paragraph, which
 * is the thing a skimming reader reads first; taking `blocks[0]` would have
 * dropped it for every section that leads with anything but a paragraph.
 */
function executiveBlocksForH2(blocks: readonly Block[]): Block[] {
  const kept: Block[] = []
  let leadTaken = false
  for (const block of blocks) {
    if (block.kind === 'prose') {
      if (leadTaken) continue
      leadTaken = true
      kept.push(block)
      continue
    }
    // Tables and blockquotes are *all* kept: §7.8 says "all tables +
    // blockquotes", and a table is the densest summary a technical document
    // has. A section with no prose at all still shows its table.
    if (block.kind === 'table' || block.kind === 'quote') kept.push(block)
  }
  return kept
}

/**
 * The blocks an H3 keeps: its first paragraph and nothing else. §7.8 is
 * explicit ("title + first paragraph") and does not extend the H2 allowance
 * of tables and blockquotes down to H3s.
 */
function executiveBlocksForH3(blocks: readonly Block[]): Block[] {
  const lead = blocks.find((block) => block.kind === 'prose')
  return lead === undefined ? [] : [lead]
}

/**
 * The blocks one section shows in `mode`.
 *
 * Reference is the identity — every block, in order, which is what makes the
 * mode switch lossless in the direction that matters: turning executive mode
 * off restores exactly the document that was there before.
 */
export function filterBlocksForMode(
  blocks: readonly Block[],
  level: 2 | 3,
  mode: ReadingMode,
): Block[] {
  if (mode === 'reference') return [...blocks]
  return level === 2 ? executiveBlocksForH2(blocks) : executiveBlocksForH3(blocks)
}

/**
 * Does this section lose anything in executive mode? Drives whether the
 * per-section "show all" override renders at all — a control that reveals
 * nothing is the dead UI A4 rejects.
 */
export function sectionIsReduced(
  blocks: readonly Block[],
  level: 2 | 3,
  mode: ReadingMode,
): boolean {
  return filterBlocksForMode(blocks, level, mode).length < blocks.length
}

/** The mode a stored value means. Anything unrecognised is `reference`. */
export function coerceMode(value: unknown): ReadingMode {
  return value === 'executive' ? 'executive' : 'reference'
}

/**
 * The stored mode, or `reference` when there is none.
 *
 * `localStorage` access is wrapped because it *throws* rather than returning
 * null in the environments this app is designed to run in: a `file://` open
 * (§6.1) has an opaque origin, and Safari's private mode rejects writes. A
 * reading mode is a preference; failing to read one is not a failure.
 */
export function readStoredMode(): ReadingMode {
  try {
    if (typeof localStorage === 'undefined') return 'reference'
    return coerceMode(localStorage.getItem(MODE_STORAGE_KEY))
  } catch {
    return 'reference'
  }
}

/** Remember the mode. A failed write is silent, for the same reason. */
export function writeStoredMode(mode: ReadingMode): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(MODE_STORAGE_KEY, mode)
  } catch {
    /* A preference that cannot be persisted is still a working preference. */
  }
}
