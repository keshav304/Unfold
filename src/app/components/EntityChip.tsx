/**
 * Entity chips (spec §6.5, §7.5, amendment A2).
 *
 * A chip is a real `<button>`, not a styled `<span>`. That is the whole reason
 * keyboard users get the popover for free: focus and hover are the same
 * affordance, so §9's "popovers: keyboard-focusable" needs no separate code path
 * that could drift from the pointer one.
 *
 * The mono pill *is* the chip for files and symbols (§7.1 inline-code pill) —
 * an author who writes `` `src/app.ts` `` in prose gets a chip without adding any
 * markup, which is the point of A2.
 */

import type { ReactNode } from 'react'
import { ChipPopover, type Backlink } from './ChipPopover'

/** What a chip points at. Derived from the document, never invented. */
export type ChipTarget =
  | { kind: 'file'; path: string; symbol?: string; testId?: string }
  | { kind: 'glossary'; term: string; isAlias: boolean }

/**
 * Everything a chip needs beyond its own text. The chip itself is presentational;
 * the data comes from the inline context, which already holds the whole
 * document's indexes (§6.6).
 */
export type ChipData = {
  /** The section the chip sits in, so it is not listed as its own backlink. */
  sectionSlug: string
  backlinks: Backlink[]
  /** From the config-extensible descriptions map; empty by default (§7.5). */
  description?: string | undefined
  /** A glossary entry's definition, when the document has one. */
  definition?: string | undefined
  onNavigate: (slug: string) => void
}

/**
 * The file family of chip targets.
 *
 * A file, symbol or test chip: the mono pill *is* the chip (§7.1), so an author
 * who writes a path in backticks gets a chip without adding any markup (A2).
 *
 * The type is the file family only, so a glossary term cannot be passed here and
 * silently render with a pill. `GlossaryChip` is the other branch, and the two
 * cannot be confused.
 */
export type FileChipTarget = { kind: 'file'; path: string; symbol?: string; testId?: string }

export type EntityChipProps = ChipData & {
  target: FileChipTarget
  /** Exactly the text that was written in the document. */
  children: ReactNode
}

/**
 * A file, symbol or test chip: the mono pill *is* the chip (§7.1), so an author
 * who writes a path in backticks gets a chip without adding any markup (A2).
 */
export function EntityChip({ target, children, ...data }: EntityChipProps): JSX.Element {
  return (
    <ChipPopover target={target} {...data}>
      <button
        type="button"
        className="entity-chip t-code-sm"
        data-chip="file"
        data-file={target.path}
        {...(target.symbol === undefined ? {} : { 'data-symbol': target.symbol })}
        {...(target.testId === undefined ? {} : { 'data-test-id': target.testId })}
      >
        {children}
      </button>
    </ChipPopover>
  )
}

/**
 * A glossary term gets a dotted underline rather than a pill (spec §6.5): it is
 * a word in a sentence, not a reference, and boxing it would rewrite the prose.
 * The alias flag travels with it so the popover knows which term was matched
 * when the author wrote an alias instead (§6.6).
 */
export function GlossaryChip({
  term,
  isAlias,
  children,
  ...data
}: ChipData & { term: string; isAlias: boolean; children: ReactNode }): JSX.Element {
  return (
    <ChipPopover target={{ kind: 'glossary', term, isAlias }} {...data}>
      <button
        type="button"
        className="glossary-chip"
        data-chip="glossary"
        data-term={term}
        {...(isAlias ? { 'data-alias': 'true' } : {})}
      >
        {children}
      </button>
    </ChipPopover>
  )
}
