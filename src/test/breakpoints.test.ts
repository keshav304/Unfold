/**
 * Breakpoints (DESIGN.md §5.3, spec §5.3):
 *   ≥1280   full workbench — nav rail 260px beside the reading column
 *   768–1279 nav rail becomes a drawer overlay; 50/50 split on the graph view
 *   <768    single pane, margins and gutters step down
 *
 * There is no browser in CI, so this asserts the *contract in the stylesheet*
 * — parsed with PostCSS, not grepped — rather than a pixel measurement.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss, { type AtRule, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../styles/reader.css'), 'utf8')
const ast = postcss.parse(css, { from: 'reader.css' })

/**
 * Every media container matching `params`, in source order.
 *
 * M3 split the workbench rules into their own blocks, so there is now more than
 * one `@media (max-width: 1279px)` in the stylesheet. A helper that returned the
 * last match made the reader's own rules invisible to the tests below — they
 * passed a check against a block that happened to be the M3 one, and failed for
 * reasons that had nothing to do with what they asserted.
 *
 * So the readers below union every matching block. That is the honest reading
 * of "what does the stylesheet declare at this width": the answer is whatever all
 * the blocks at that width collectively say, not whatever the last one says.
 */
function mediaAll(params: string): AtRule[] {
  const found: AtRule[] = []
  const wanted = params.replace(/\s+/gu, '')
  ast.walkAtRules('media', (rule) => {
    if (rule.params.replace(/\s+/gu, '').includes(wanted)) found.push(rule)
  })
  return found
}

/** Top-level rules when no media container is given, otherwise rules inside it. */
function ruleIn(container: AtRule | undefined, selector: string): Rule | undefined {
  let found: Rule | undefined
  const visit = (rule: Rule): void => {
    if (rule.selector === selector) found = rule
  }
  if (container === undefined) {
    // Only rules at the top level: a later media query overrides these.
    for (const node of ast.nodes) if (node.type === 'rule') visit(node)
  } else {
    container.walkRules(visit)
  }
  return found
}

/**
 * The last declaration of `prop` for `selector` across every matching block.
 *
 * `containers` empty means "the top level" — the rules outside any media query,
 * which is where the ≥1280 defaults live.
 */
function declInAny(containers: readonly AtRule[], selector: string, prop: string): string | undefined {
  let value: string | undefined
  if (containers.length === 0) {
    for (const node of ast.nodes) {
      if (node.type === 'rule' && node.selector === selector) {
        node.walkDecls(prop, (decl) => {
          value = decl.value
        })
      }
    }
    return value
  }
  for (const container of containers) {
    ruleIn(container, selector)?.walkDecls(prop, (decl) => {
      value = decl.value
    })
  }
  return value
}

/** Shorthand for a single container, kept for the top-level reads. */
function decl(container: AtRule | undefined, selector: string, prop: string): string | undefined {
  return declInAny(container === undefined ? [] : [container], selector, prop)
}

describe('≥1280: the full workbench', () => {
  it('the body is a two-column grid with the 260px nav rail', () => {
    expect(decl(undefined, '.app-body', 'grid-template-columns')).toContain('--nav-rail-width')
  })

  it('the rail is sticky and shown', () => {
    expect(ruleIn(undefined, '.toc')).toBeDefined()
  })
})

describe('768–1279: the rail becomes a drawer', () => {
  const query = mediaAll('max-width:1279px')

  it('the media query exists', () => {
    expect(query.length).toBeGreaterThan(0)
  })

  it('the body collapses to a single column', () => {
    expect(declInAny(query, '.app-body', 'grid-template-columns')).toBe('minmax(0, 1fr)')
  })

  it('the menu button appears', () => {
    expect(declInAny(query, '.app-menu', 'display')).toBe('inline-grid')
  })

  it('the rail is fixed and translated off-canvas', () => {
    expect(declInAny(query, '.toc', 'position')).toBe('fixed')
    expect(declInAny(query, '.toc', 'transform')).toContain('translateX')
  })

  it('the scrim is shown', () => {
    expect(declInAny(query, '.toc-scrim', 'display')).toBe('block')
  })
})

describe('<768: a single pane with tighter gutters', () => {
  const query = mediaAll('max-width:767px')

  it('the media query exists', () => {
    expect(query.length).toBeGreaterThan(0)
  })

  it('margins step down to --margin-mobile', () => {
    expect(declInAny(query, '.app-main', 'padding')).toContain('--margin-mobile')
  })

  it('the hero title switches to its mobile size token', () => {
    expect(declInAny(query, '.hero-title', 'font-size')).toBe('var(--text-display-lg-mobile-size)')
  })

  it('the rail takes the full viewport width at most', () => {
    expect(declInAny(query, '.toc', 'width')).toContain('100vw')
  })
})

describe('reduced motion (§8)', () => {
  it('the token layer zeroes every duration', () => {
    const tokens = readFileSync(resolve(here, '../styles/tokens.css'), 'utf8')
    expect(tokens).toContain('@media (prefers-reduced-motion: reduce)')
    expect(tokens).toContain('--motion-slow: 0ms')
  })

  it('the reader stylesheet hardcodes no duration', () => {
    // Every duration must come from --motion-*, or reduced motion cannot
    // neutralise it. Scanned over declarations only: a regex over the raw file
    // also matches prose in comments (a heading called "H2s" is not a 2s
    // duration).
    const offenders: string[] = []
    ast.walkDecls((decl) => {
      for (const prop of ['transition-duration', 'animation-duration', 'transition', 'animation'] as const) {
        if (decl.prop !== prop) continue
        // A shorthand may legitimately reference the tokens.
        if (/var\(--motion-/u.test(decl.value)) continue
        if (/\d+\s*m?s\b/u.test(decl.value)) {
          offenders.push(`${prop}: ${decl.value}`)
        }
      }
    })
    expect(offenders).toEqual([])
  })

  it('every transition in the reader resolves to a motion token', () => {
    const transitions: string[] = []
    ast.walkDecls('transition', (decl) => {
      if (decl.value.trim() !== '' && !/var\(--motion-/u.test(decl.value)) {
        transitions.push(decl.value)
      }
    })
    // `transition: none` is fine; a bare duration is not.
    expect(transitions.filter((value) => value !== 'none')).toEqual([])
  })
})

describe('M1.9d: the grid collapses with the rail', () => {
  it('the no-rail state is a single-column template', () => {
    const value = decl(undefined, ".app-body[data-rail='false']", 'grid-template-columns')
    expect(value).toBe('minmax(0, 1fr)')
    // Crucially not the two-column template, which is what squeezed the
    // content into the 260px rail column.
    expect(value).not.toContain('--nav-rail-width')
  })

  it('the with-rail state is still two columns', () => {
    expect(decl(undefined, '.app-body', 'grid-template-columns')).toContain('--nav-rail-width')
  })

  it('the collapsed rule wins at every breakpoint', () => {
    // The mobile queries set a single column anyway, so the collapse must be
    // declared at the top level, not inside a media query.
    const rule = ruleIn(undefined, ".app-body[data-rail='false']")
    expect(rule?.parent?.type).toBe('root')
  })
})

/* ------------------------------------------------------------------ *
 * M3.5 — the workbench layout (spec §5.3)
 *
 * Three rules this file exists to hold, each of which was a live trap:
 *
 *   a) the segmented tabs appear only below 768px, and offer Docs / Visual
 *      Graph and no Metrics tab;
 *   b) the graph workbench's panel column is *reserved* at every width, so
 *      opening the panel never reflows the grid and the canvas never moves;
 *   c) the hidden pane is `display: none`, because a React Flow canvas that is
 *      merely invisible still reports a size, and a `display: none` one does
 *      not — which is why the view re-fits when the tab becomes visible.
 * ------------------------------------------------------------------ */

describe('M3.5a: ≥1280 the workbench is rail + canvas + a reserved 440px panel', () => {
  it('the workbench is a two-column grid with the inspector column', () => {
    expect(declInAny([], '.graph-workbench', 'grid-template-columns')).toBe(
      'minmax(0, 1fr) var(--inspector-width)',
    )
  })

  it('the panel is the 440px token, not a literal', () => {
    // §5.2/§5.3: 440px lives in tokens.css as `--inspector-width`. A literal
    // here would be a second place to change it.
    const width = declInAny([], '.inspector', 'width')
    expect(width).toBe('var(--inspector-width)')
    expect(width).not.toMatch(/\d/)
  })

  it('the panel column is reserved whether or not the panel is open', () => {
    // The `data-panel` attribute flips when a node is selected. If the grid
    // template changed with it, opening the panel would reflow the canvas —
    // trap (c), and the reason the template above is unconditional.
    const template = declInAny([], '.graph-workbench', 'grid-template-columns')
    expect(template).not.toContain('data-panel')
    expect(declInAny([], ".graph-workbench[data-panel='closed']", 'grid-template-columns')).toBeUndefined()
    expect(declInAny([], ".graph-workbench[data-panel='open']", 'grid-template-columns')).toBeUndefined()
  })
})

describe('M3.5b: 768–1279 the canvas and the panel split 50/50', () => {
  const query = mediaAll('max-width:1279px')

  it('the split is two equal flexible columns', () => {
    expect(declInAny(query, '.graph-workbench', 'grid-template-columns')).toBe(
      'minmax(0, 1fr) minmax(0, 1fr)',
    )
  })

  it('the panel drops its fixed width, because half the viewport is not 440px', () => {
    expect(declInAny(query, '.inspector', 'width')).toBe('auto')
  })

  it('the rail is still the M1 drawer here, not a workbench column', () => {
    // §5.3: 768–1279 "nav rail becomes a drawer overlay". The workbench must not
    // re-add a rail column at this width.
    expect(declInAny(query, '.app-body', 'grid-template-columns')).toBe('minmax(0, 1fr)')
    expect(declInAny(query, '.toc', 'position')).toBe('fixed')
  })
})

describe('M3.5c: <768 one pane, switched by the segmented control', () => {
  const query = mediaAll('max-width:767px')

  it('the segmented control appears only here', () => {
    // Hidden at the top level, shown at this width — never the reverse, or the
    // workbench would have two navigation models at once.
    expect(declInAny([], '.workbench-tabs', 'display')).toBe('none')
    expect(declInAny(query, '.workbench-tabs', 'display')).toBe('flex')
  })

  it('the header view switcher steps aside for it, so the header does not overflow', () => {
    // §5.3 gives this layout its own navigation. Two controls doing one job is
    // not a redundancy question but a layout one: the M3 mobile screenshot showed
    // the switcher running off the right edge once the segmented control joined
    // a header that was already full.
    expect(declInAny(query, '.view-switcher', 'display')).toBe('none')
    expect(declInAny([], '.view-switcher', 'display')).toBe('flex')
  })

  it('the workbench is a single column', () => {
    expect(declInAny(query, '.graph-workbench', 'grid-template-columns')).toBe('minmax(0, 1fr)')
  })

  it('the hidden pane is display:none, so the canvas really measures zero', () => {
    // Trap (a). `visibility: hidden` or an off-canvas transform would leave the
    // canvas reporting a size, and React Flow's fit-view would then compute a
    // viewport for a pane nobody can see.
    expect(declInAny(query, ".app-body[data-pane='docs'] .graph-workbench", 'display')).toBe('none')
  })

  it('the panel is a full-width sheet, not a 440px column beside 375px', () => {
    expect(declInAny(query, '.inspector', 'width')).toBe('auto')
  })

  it('the stepper runs vertically on mobile (§7.7)', () => {
    expect(declInAny(query, '.stepper-dots', 'flex-direction')).toBe('column')
  })
})

describe('M3.6 the stepper hash is a real route', () => {
  it('the routing module round-trips a per-step hash', async () => {
    const { parseHash, hashFor, stepperHash } = await import('../app/routing')
    for (const step of [1, 2, 7, 42]) {
      expect(parseHash(stepperHash(step))).toEqual({ name: 'stepper', step })
      expect(hashFor({ name: 'stepper', step })).toBe(`#/stepper/${step}`)
    }
  })
})
