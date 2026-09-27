/**
 * The search palette (spec §7.4). ⌘K / Ctrl+K and `/` open it; results navigate.
 *
 * Three rules this component exists to hold:
 *
 *  1. **Groups render only when their data exists.** A document with no file
 *     entities has no Files group and no glossary term has no Glossary group —
 *     not an empty one (§1.1).
 *  2. **Focus is trapped while open and restored to the trigger on close**
 *     (§9). Restoring is the half that is easy to forget and impossible to
 *     work around once you have noticed it.
 *  3. **No dead UI (A4).** The palette is results and navigation only. M2 shipped
 *     it with no static rows at all, because the views it would have switched to
 *     did not exist yet; a row for a view that does not exist is a control that
 *     does nothing. M3 lifts the restriction for exactly the rows whose targets
 *     now exist — "Open the visual graph", "Open the stepper" — and the reading-
 *     mode row stays absent until M4.1 builds the thing it would toggle. Every
 *     row is capability-gated: a view this document cannot render is not offered
 *     at all (§1.1).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Command } from 'cmdk'
import type { Doc } from '../../pipeline/types'
import {
  ACTION_GROUP_ORDER,
  GROUP_LABEL,
  GROUP_ORDER,
  paletteActions,
  paletteGroups,
  paletteModeAction,
  useSearchIndex,
  type PaletteAction,
  type SearchHit,
} from '../search/useSearch'
import { HighlightedText } from '../components/HighlightedText'
import { navigate } from '../navigate'
import { hashFor, type ViewName } from '../routing'
import type { ReadingMode } from '../modes/reading-mode'

export type PaletteProps = {
  doc: Doc
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Navigate to a section: scroll, flash, hash (the shell owns the hash). */
  onNavigate: (slug: string) => void
  /** The view currently on screen, so the palette does not offer to open it. */
  activeView: ViewName
  /** Switch views. The shell owns the hash and the route state. */
  onGoToView: (view: ViewName) => void
  /** The current reading mode (§7.8), so the row can offer the other one. */
  readingMode: ReadingMode
  /** Switch reading mode. The shell owns it, because the shell persists it. */
  onSetReadingMode: (mode: ReadingMode) => void
}

const INPUT_LABEL = 'Search this document'
const LIST_LABEL = 'Search results'

/** `⌘K` on Apple platforms, `Ctrl+K` everywhere else (§7.4). */
export function isPaletteShortcut(event: KeyboardEvent): boolean {
  return event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)
}

/**
 * Is the `/` shortcut inert here? Yes inside a text field (spec §7.4, §9):
 * typing a slash into a search box must type a slash.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') return false
  const element = target as Partial<HTMLElement> & { isContentEditable?: boolean }
  const tag = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : ''
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return element.isContentEditable === true
}

function groupHits(hits: SearchHit[], groups: SearchHit['group'][]): [SearchHit['group'], SearchHit[]][] {
  return GROUP_ORDER.filter((group) => groups.includes(group))
    .map((group) => [group, hits.filter((hit) => hit.group === group)] as [SearchHit['group'], SearchHit[]])
    .filter(([, rows]) => rows.length > 0)
}

/** One result row. The whole row is the `cmdk` item, so click and Enter agree. */
function PaletteRow({
  hit,
  query,
  onChoose,
}: {
  hit: SearchHit
  query: string
  onChoose: (hit: SearchHit) => void
}): JSX.Element {
  return (
    <Command.Item
      className="palette-item"
      value={hit.id}
      onSelect={() => onChoose(hit)}
      data-group={hit.group}
    >
      <span className="palette-item__title t-code-md">
        <HighlightedText text={hit.title} query={query} />
      </span>
      {hit.snippet === null ? null : (
        <span className="palette-item__snippet t-body-sm">
          <HighlightedText text={hit.snippet.text} query={query} />
        </span>
      )}
    </Command.Item>
  )
}

/**
 * One static action row (§7.4). A `cmdk` item like any result, so the arrows and
 * Enter reach it without a second keyboard path to maintain.
 */
function PaletteActionRow({
  action,
  onRun,
}: {
  action: PaletteAction
  onRun: (action: PaletteAction) => void
}): JSX.Element {
  return (
    <Command.Item
      className="palette-item palette-item--action"
      value={action.id}
      onSelect={() => onRun(action)}
      // The value the existing tests read. A view row keys on the view it
      // opens; a mode row keys on the mode it selects, and says so in the
      // attribute name so the two are never confused for one another.
      data-action={action.kind === 'view' ? action.view : `mode:${action.mode}`}
      data-kind={action.kind}
    >
      <span className="palette-item__title t-code-md">{action.label}</span>
    </Command.Item>
  )
}

export function Palette({
  doc,
  open,
  onOpenChange,
  onNavigate,
  activeView,
  onGoToView,
  readingMode,
  onSetReadingMode,
}: PaletteProps): JSX.Element | null {
  const index = useSearchIndex(doc)
  const groups = useMemo(() => paletteGroups(doc), [doc])
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  const hits = useMemo(() => index.search(query), [index, query])

  /**
   * §7.4 static actions: "switch view (capable views only), toggle reading mode".
   *
   * M2's A4 rule — no dead UI — lifted in M3 for exactly the rows whose targets
   * now exist. The gate is the same one the header switcher uses: a view the
   * document cannot render is not offered, because clicking it would land on the
   * reader anyway (`resolveRoute`). M4.1 builds the thing the reading-mode row
   * toggles, so that row exists now too.
   *
   * The *current* view and the *current* mode are both omitted: "Open the view
   * you are already in" and "Switch to the mode you are already in" are not
   * switches, and a row that appears to do nothing is the dead UI A4 named.
   */
  const actions = useMemo(
    () => [...paletteActions(doc, activeView), ...paletteModeAction(readingMode)],
    [doc, activeView, readingMode],
  )

  /*
   * Actions are the palette's *default* state, and typing switches to search.
   *
   * `shouldFilter={false}` means cmdk will not filter them out for us, and
   * MiniSearch is the single authority on what a query matches (M2 decision) —
   * the action rows are not in the index, so a query must not half-match them.
   * Showing "Open graph" beside a search for "latency" would be a row that
   * ignores what the reader typed.
   */
  const showActions = query.trim() === ''

  // A fresh query per opening: last session's search is noise, not context.
  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  /**
   * Repair cmdk's list DOM so the combobox is actually a combobox.
   *
   * `Command.List` renders `role="listbox"` and `Command.Item` renders
   * `role="option"`, but cmdk puts three wrapper `div`s between them: a sizing
   * wrapper (`cmdk-list-sizer`, which it measures to set `--cmdk-list-height`),
   * a per-group wrapper, and each group's heading.
   *
   * `aria-required-children` requires a listbox's *direct* children to be
   * `option` or `group`, so an un-roled wrapper in between is a **critical**
   * violation: axe reports it, and a screen reader announces a listbox that
   * appears to hold nothing. `role="presentation"` does not help on the direct
   * child — axe rejects a presentation child of a listbox just the same.
   *
   * So the sizing wrapper becomes the listbox's one `group`, the per-group
   * wrappers become `presentation` (their children hoist into the sizing
   * group), and the heading does too. cmdk's own `cmdk-group-items` div is
   * already `role="group"`, so the group's accessible name moves there, where a
   * `group` is allowed to carry one.
   *
   * The result is the textbook shape:
   *
   *     listbox > group > [group > option…]
   *
   * Only attributes are touched. Restructuring the nodes themselves fights
   * React: the rows are children of the sizing wrapper, so removing it takes
   * the list with it, and React throws on the next render.
   *
   * cmdk renders these nodes itself and exposes no prop for any of it, so the
   * repair happens after mount. A jsdom test could assert the attributes; only
   * the Playwright axe scan can prove the consequence.
   */
  useEffect(() => {
    if (!open) return
    const list = listRef.current
    if (list === null) return
    list.querySelector('[cmdk-list-sizer]')?.setAttribute('role', 'group')
    for (const group of list.querySelectorAll('[cmdk-group]')) {
      const items = group.querySelector('[cmdk-group-items]')
      // A `group` may carry a name; a presentation wrapper may not, and an
      // `aria-label` on a generic element is itself a violation.
      if (items !== null && group.getAttribute('aria-label') !== null) {
        items.setAttribute('aria-label', group.getAttribute('aria-label') as string)
        group.removeAttribute('aria-label')
      }
      group.setAttribute('role', 'presentation')
      group.querySelector('[cmdk-group-heading]')?.setAttribute('role', 'presentation')
    }
  }, [open, query])

  /**
   * §7.4: a result navigates — scroll, flash and hash — and the palette closes.
   *
   * `navigate` rather than `onNavigate` directly: the callback only flashes and
   * scrolls, and the *hash* is what makes a result linkable and what the back
   * button reads. Every other in-app navigation in the app goes through it.
   */
  const choose = useCallback(
    (hit: SearchHit) => {
      onOpenChange(false)
      navigate(hit.target.slug, onNavigate)
    },
    [onNavigate, onOpenChange],
  )

  /**
   * A static action runs, then the palette closes.
   *
   * A **view** row writes the hash as well as going through `onGoToView`, for
   * the reason the M2 review recorded: a palette result that scrolls but never
   * touches the URL is not linkable and the back button cannot read it.
   * `onGoToView` owns the route state; this owns the address bar, and both write
   * the same value.
   *
   * A **mode** row writes no hash at all, and that is deliberate rather than an
   * oversight: the reading mode is persisted in localStorage (§7.8), not in the
   * URL. Putting it in the hash would also mean `#/graph` and a mode change
   * fighting over the one piece of state this app has agreed to keep in the
   * address bar, and §7.1 gives the hash exactly one job — which view and which
   * section.
   */
  const run = useCallback(
    (action: PaletteAction) => {
      onOpenChange(false)
      if (action.kind === 'mode') {
        if (action.mode !== undefined) onSetReadingMode(action.mode)
        return
      }
      const view = action.view
      if (view === undefined) return
      if (typeof window !== 'undefined' && window.location.hash !== hashFor({ name: view })) {
        window.location.hash = hashFor({ name: view })
      }
      onGoToView(view)
    },
    [onGoToView, onOpenChange, onSetReadingMode],
  )

  // Esc closes. cmdk owns Enter and the arrows; the trap is enforced on the
  // container's keydown below, and the Playwright suite proves it in a real
  // engine, which jsdom cannot.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onOpenChange(false)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, onOpenChange])

  if (!open) return null

  return (
    /*
     * The scrim closes the palette, and it must close on a press that *starts*
     * on the scrim — not on one that starts on a row and merely bubbles up.
     *
     * `onMouseDown` on the wrapper, unguarded, unmounts the palette on the
     * press: React tears the list down, the `click` that would have followed
     * arrives with no target, and the row's `onSelect` never runs. Every action
     * row was therefore dead in a real browser while passing every jsdom test,
     * because `fireEvent.click` sends no mousedown at all. The reader still
     * worked, so the search *results* hid it: cmdk selects those on its own
     * input handling, and only the static rows went through this path.
     *
     * `event.target === event.currentTarget` is the whole fix: a press on the
     * backdrop is a dismiss, a press on a row is the beginning of a choice.
     */
    <div
      className="palette-overlay glass"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false)
      }}
    >
      {/*
        `shouldFilter={false}`: the rows are already filtered by MiniSearch
        with the title boost, so cmdk's own substring pass would only drop
        results the index deliberately ranked highly.
      */}
      <Command
        className="palette elev-3"
        label={INPUT_LABEL}
        loop
        shouldFilter={false}
        onKeyDown={(event) => {
          // Tab must cycle *inside* the palette (§9). Letting it reach the
          // page behind is the classic dialog defect, and the Playwright suite
          // asserts it holds in a real engine.
          if (event.key === 'Tab') event.preventDefault()
        }}
      >
        <div className="palette-header">
          <span className="palette-header__icon" aria-hidden="true">
            ⌕
          </span>
          <Command.Input
            className="palette-input t-body-lg"
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the palette
            // exists to be typed into; focus lands here on open.
            autoFocus
            placeholder="Search sections, files and terms"
            aria-label={INPUT_LABEL}
            value={query}
            onValueChange={setQuery}
          />
          <span className="palette-header__esc t-label-caps" aria-hidden="true">
            Esc
          </span>
        </div>

        <Command.List className="palette-list" ref={listRef} aria-label={LIST_LABEL}>
          <Command.Empty className="palette-empty t-body-md">No matches in this document.</Command.Empty>
          {/*
            One `Command.Group` per action kind, each named. M4.1 added the
            reading-mode row, and lumping it under "Views" would have been a lie
            the screen reader repeats: it is not a view, and it does not navigate.
            Each group is skipped entirely when it has no rows — a document with
            no graph has no Views group at all, which is the same rule the search
            groups follow.
          */}
          {showActions
            ? ACTION_GROUP_ORDER.map((group) => {
                const rows = actions.filter((action) => action.group === group)
                if (rows.length === 0) return null
                return (
                  <Command.Group key={group} className="palette-group" heading={group} aria-label={group}>
                    {rows.map((action) => (
                      <PaletteActionRow key={action.id} action={action} onRun={run} />
                    ))}
                  </Command.Group>
                )
              })
            : null}
          {groupHits(hits, groups).map(([group, rows]) => (
            <Command.Group
              key={group}
              className="palette-group"
              // A group is a list of results, which is what this is.
              aria-label={GROUP_LABEL[group]}
              heading={GROUP_LABEL[group]}
            >
              {rows.map((hit) => (
                <PaletteRow key={hit.id} hit={hit} query={query} onChoose={choose} />
              ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>
  )
}