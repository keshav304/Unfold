/**
 * The popover shell (spec §7.5): Level-2 glass card, opened by hover *and* by
 * keyboard focus, dismissed by Esc or pointer-leave.
 *
 * **Why this portals to `<body>` and positions `fixed`.** A chip inside a table
 * cell sits in the reader's `overflow-x: auto` wrapper (§7.1). An absolutely
 * positioned popover inside that wrapper is *clipped* by it — the popover would
 * work everywhere except inside a table, which is exactly where a technical
 * document puts most of its file paths. A `position: fixed` element portalled to
 * `<body>` is positioned against the viewport and clipped by nothing, so one
 * code path works in prose, in a list and in a cell. The unit suite asserts the
 * portal target; Playwright asserts it visually.
 *
 * Placement and dismissal belong to this component. Document data does not: the
 * caller supplies the description and the backlinks, so the popover stays
 * generic (spec §1).
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ChipTarget } from './EntityChip'

/** §7.5: hover opens after a beat, so a passing cursor does not flash a card. */
export const POPOVER_OPEN_DELAY_MS = 150

export type Backlink = { slug: string; title: string }

export type ChipPopoverProps = {
  target: ChipTarget
  /** Section the chip sits in; excluded from its own backlink list. */
  sectionSlug: string
  /** Backlinks: the sections that mention this entity (§6.6). */
  backlinks: Backlink[]
  /** One line about the entity, from the config-extensible descriptions map. */
  description?: string | undefined
  /** Glossary definition, when the document provides one. */
  definition?: string | undefined
  /** Click a backlink: navigate + flash. */
  onNavigate: (slug: string) => void
  children: ReactNode
}

/** Where the card goes, in viewport coordinates. */
type Placement = { top: number; left: number }

/** The accessible name of a card, derived from the target — never invented. */
function describeTarget(target: ChipTarget): string {
  if (target.kind === 'glossary') return target.term
  return target.symbol === undefined ? target.path : `${target.path}::${target.symbol}`
}

function placementFor(anchor: DOMRect, card: DOMRect, margin: number): Placement {
  // Prefer below the chip; flip above when there is no room. Then clamp
  // horizontally so a chip near the right edge cannot push the card offscreen.
  const below = anchor.bottom + margin
  const top = below + card.height <= window.innerHeight ? below : Math.max(margin, anchor.top - card.height - margin)
  const raw = anchor.left + anchor.width / 2 - card.width / 2
  const left = Math.min(Math.max(margin, raw), Math.max(margin, window.innerWidth - card.width - margin))
  return { top, left }
}

export function ChipPopover({
  target,
  sectionSlug,
  backlinks,
  description,
  definition,
  onNavigate,
  children,
}: ChipPopoverProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const timer = useRef<number | null>(null)
  const cardId = useId()

  const cancelPending = useCallback(() => {
    if (timer.current === null) return
    window.clearTimeout(timer.current)
    timer.current = null
  }, [])

  const close = useCallback(() => {
    cancelPending()
    setOpen(false)
    setPlacement(null)
  }, [cancelPending])

  const show = useCallback(() => {
    cancelPending()
    timer.current = window.setTimeout(() => setOpen(true), POPOVER_OPEN_DELAY_MS)
  }, [cancelPending])

  // Position once open, and keep up with resize and scroll, from the live rect.
  useEffect(() => {
    if (!open) return
    const place = (): void => {
      const chip = anchorRef.current?.querySelector('button')
      const card = cardRef.current
      if (chip === null || chip === undefined || card === null) return
      setPlacement(placementFor(chip.getBoundingClientRect(), card.getBoundingClientRect(), 8))
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  // Esc dismisses (§9) and returns focus to the chip, because the chip is what
  // the keyboard user was on when the card appeared.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close()
      anchorRef.current?.querySelector('button')?.focus()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, close])

  useEffect(() => cancelPending, [cancelPending])

  // The section the chip sits in is not a "mention elsewhere" of itself.
  const others = backlinks.filter((link) => link.slug !== sectionSlug)
  const key = target.kind === 'file' ? target.path : target.term

  return (
    <span
      ref={anchorRef}
      className="chip-anchor"
      onMouseEnter={show}
      onMouseLeave={close}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        // Focus moving *within* the chip's own subtree is not a dismissal.
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
        close()
      }}
    >
      {children}
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={cardRef}
              id={cardId}
              role="dialog"
              aria-label={describeTarget(target)}
              className="popover elev-2 glass"
              data-popover={key}
              style={{
                position: 'fixed',
                top: placement?.top ?? -9999,
                left: placement?.left ?? -9999,
                // Off-screen until measured, rather than flashing at 0,0.
                visibility: placement === null ? 'hidden' : 'visible',
              }}
              onMouseEnter={cancelPending}
              onMouseLeave={close}
            >
              <PopoverBody
                description={description}
                definition={definition}
                others={others}
                onNavigate={(slug) => {
                  close()
                  onNavigate(slug)
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </span>
  )
}

/**
 * A card with neither a description nor another mention would be an empty box
 * over the reader's text. §1.1 says hide what is absent, so the card says the
 * one true thing it knows rather than pretending to know more.
 */
function PopoverBody({
  description,
  definition,
  others,
  onNavigate,
}: {
  description: string | undefined
  definition: string | undefined
  others: Backlink[]
  onNavigate: (slug: string) => void
}): JSX.Element {
  return (
    <>
      {description === undefined || description === '' ? null : (
        <p className="popover__description t-body-sm">{description}</p>
      )}
      {definition === undefined || definition === '' ? null : (
        <p className="popover__definition t-body-sm">{definition}</p>
      )}
      {others.length === 0 ? (
        <p className="popover__empty t-body-sm">Not mentioned anywhere else.</p>
      ) : (
        <>
          <p className="popover__label t-label-caps">Mentioned in</p>
          <ul className="popover__links">
            {others.map((link) => (
              <li key={link.slug}>
                <button
                  type="button"
                  className="popover__link t-body-sm"
                  onClick={() => onNavigate(link.slug)}
                >
                  {link.title}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

