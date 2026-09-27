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

function media(params: string): AtRule | undefined {
  let found: AtRule | undefined
  ast.walkAtRules('media', (rule) => {
    if (rule.params.replace(/\s+/gu, '').includes(params.replace(/\s+/gu, ''))) found = rule
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

function decl(container: AtRule | undefined, selector: string, prop: string): string | undefined {
  let value: string | undefined
  ruleIn(container, selector)?.walkDecls(prop, (decl) => {
    value = decl.value
  })
  return value
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
  const query = media('max-width:1279px')

  it('the media query exists', () => {
    expect(query).toBeDefined()
  })

  it('the body collapses to a single column', () => {
    expect(decl(query, '.app-body', 'grid-template-columns')).toBe('minmax(0, 1fr)')
  })

  it('the menu button appears', () => {
    expect(decl(query, '.app-menu', 'display')).toBe('inline-grid')
  })

  it('the rail is fixed and translated off-canvas', () => {
    expect(decl(query, '.toc', 'position')).toBe('fixed')
    expect(decl(query, '.toc', 'transform')).toContain('translateX')
  })

  it('the scrim is shown', () => {
    expect(decl(query, '.toc-scrim', 'display')).toBe('block')
  })
})

describe('<768: a single pane with tighter gutters', () => {
  const query = media('max-width:767px')

  it('the media query exists', () => {
    expect(query).toBeDefined()
  })

  it('margins step down to --margin-mobile', () => {
    expect(decl(query, '.app-main', 'padding')).toContain('--margin-mobile')
  })

  it('the hero title switches to its mobile size token', () => {
    expect(decl(query, '.hero-title', 'font-size')).toBe('var(--text-display-lg-mobile-size)')
  })

  it('the rail takes the full viewport width at most', () => {
    expect(decl(query, '.toc', 'width')).toContain('100vw')
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
