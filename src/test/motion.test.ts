/**
 * M4.4 — the §8 motion audit, as an executable budget.
 *
 * The brief for this task is "inventory EVERY animation/transition in src/;
 * exactly three signature moments; everything else ≤250ms ease-out; scroll
 * reveals fire once; ambient loops slow and low-opacity." A budget that is only
 * written down stops being true the day someone adds a fourth signature moment,
 * so this file turns each clause into a test over the parsed stylesheet — the
 * same technique `breakpoints.test.ts` uses, and for the same reason: a grep
 * over raw CSS also matches prose in comments.
 *
 * The inventory is the first test. It is printed on every run, because "exactly
 * three signature moments" is only meaningful if you can see which three, and
 * because a new animation showing up in that table is the whole point.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss, { type Declaration, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const readerCss = readFileSync(resolve(here, '../styles/reader.css'), 'utf8')
const tokensCss = readFileSync(resolve(here, '../styles/tokens.css'), 'utf8')
const ast = postcss.parse(readerCss, { from: 'reader.css' })
const tokensAst = postcss.parse(tokensCss, { from: 'tokens.css' })

/** One `animation` shorthand, decomposed. */
type Motion = {
  name: string
  duration: string
  iteration: string
  selector: string
}

/** The `animation` shorthands in the reader stylesheet, in source order. */
function animations(): Motion[] {
  const found: Motion[] = []
  ast.walkRules((rule: Rule) => {
    rule.walkDecls('animation', (decl: Declaration) => {
      if (decl.value.trim() === '' || decl.value === 'none') return
      const parts = decl.value.split(/\s+/u)
      found.push({
        name: parts[0] ?? '',
        duration: parts.find((part) => /var\(--motion-|\d+(\.\d+)?m?s\b/u.test(part)) ?? '',
        iteration: parts.includes('infinite') ? 'infinite' : '1',
        selector: rule.selector.replace(/\s+/gu, ' '),
      })
    })
  })
  return found
}

/**
 * The declared value of a token, e.g. `--motion-slow` → `250ms`.
 *
 * Read from the top-level `:root` block rather than by regex over the file,
 * because `tokens.css` declares every motion token a *second* time inside the
 * reduced-motion query, where they are all `0ms`. A regex that took the first
 * match would report every tier as zero and the whole budget would pass
 * vacuously — which is the failure mode a budget is most prone to.
 */
function tokenValue(name: string): string {
  let value: string | undefined
  for (const node of tokensAst.nodes) {
    if (node.type !== 'rule' || node.selector !== ':root') continue
    node.walkDecls(name, (decl) => {
      if (value === undefined) value = decl.value
    })
  }
  if (value === undefined) throw new Error(`${name} is not declared in :root in tokens.css`)
  return value
}

const ms = (value: string): number => {
  if (value.endsWith('ms')) return Number.parseFloat(value)
  if (value.endsWith('s')) return Number.parseFloat(value) * 1000
  return Number.NaN
}

/** The token a duration resolves through, or null if it is a literal. */
function tokenOf(duration: string): string | null {
  const match = duration.match(/var\((--motion-[a-z]+)\)/u)
  return match === null ? null : (match[1] as string)
}

/**
 * §8's three signature moments, named.
 *
 * `panel-in-overlay` / `panel-in-sheet` and `step-in-mobile` are the *same*
 * moments at other breakpoints, not extra ones — R11a settled that the panel
 * changes keyframe per mechanism for the same reason it changes position. The
 * M4.1 mode flip is emphatically not here: §8 says exactly three, and a mode
 * change is a change of density rather than of structure.
 */
const SIGNATURE = ['palette-spring', 'panel-in', 'step-in']

/** The one-shot reveal. §8 allows 500–600ms, and requires it to fire once. */
const REVEALS = ['section-flash']

/** The ambient loops: §8 requires them slow, and they never stop. */
const AMBIENT = ['loop-dash', 'edge-trace']

describe('§8 the inventory — every animation in the app, printed', () => {
  it('lists them all, and the list is short enough to read', () => {
    const all = animations()
    const rows = ['  animation                tier              iteration  signature']
    for (const motion of all) {
      const tier = tokenOf(motion.duration) ?? `LITERAL(${motion.duration})`
      rows.push(
        `  ${motion.name.padEnd(22)} ${tier.padEnd(18)} ${motion.iteration.padEnd(10)} ` +
          `${SIGNATURE.includes(motion.name) ? 'yes' : '—'}`,
      )
    }
    process.stdout.write(`\n§8 motion inventory (${all.length})\n${rows.join('\n')}\n\n`)

    // Eight `animation` shorthands: the three signature moments, the one-shot
    // reveal, and the two ambient loops. A seventh shorthand means something new
    // is moving, and the next three describes are where it has to justify itself.
    //
    // M4.14 added two of them, and the distinction this assertion exists to force
    // is the one it turns on: both are `edge-trace`, the ambient loop the graph
    // canvas has used since M3, on two more selectors (an ASCII connector's
    // hover, and a connector the source drew with gaps). *Nothing new moves.* So
    // the shorthand count went up and the **distinct-name** count did not, and the
    // next assertion is the one that would catch an eighth kind of motion rather
    // than a seventh place the sixth already runs.
    expect(all.length).toBe(8)
  })

  it('which is the same eight, not eight different things: the names are still the six', () => {
    const names = new Set(animations().map((motion) => motion.name))
    // The three signature moments, the one-shot reveal, and the two ambient loops.
    expect([...names].sort()).toEqual([...[...SIGNATURE, ...REVEALS, ...AMBIENT]].sort())
    // A name here that is not one of those six is a new kind of motion, whatever
    // the shorthand count says, and it has to be classified above first.
    for (const name of names) {
      expect([...SIGNATURE, ...REVEALS, ...AMBIENT], `unclassified animation: ${name}`).toContain(name)
    }
  })

  it('every duration resolves through a --motion-* token, never a literal', () => {
    // The reason the reduced-motion override can neutralise anything at all: it
    // zeroes the tokens and forces `animation-duration: 0ms !important`. A
    // literal duration is a duration reduced motion cannot reach.
    const literals = animations()
      .filter((motion) => tokenOf(motion.duration) === null)
      .map((motion) => `${motion.name}: ${motion.duration}`)
    expect(literals).toEqual([])
  })
})

describe('§8 exactly three signature moments', () => {
  it('the signature names are the palette, the graph panel and the stepper', () => {
    const names = new Set(animations().map((motion) => motion.name))
    for (const signature of SIGNATURE) {
      expect(names.has(signature), `${signature} is missing`).toBe(true)
    }
  })

  it('and nothing else is a signature', () => {
    // The test that makes "three" mean three. The mode flip is the near miss:
    // it is a whole-document reflow, and the tempting reading of §8 is that
    // anything that big deserves signature treatment. It is 250ms and it is not
    // one of the three, and this assertion is what keeps that true.
    const known = [...SIGNATURE, ...REVEALS, ...AMBIENT]
    const unexpected = animations()
      .map((motion) => motion.name)
      .filter((name) => !known.includes(name) && !name.startsWith('mode-flip'))
    expect(unexpected, 'an unclassified animation appeared — classify it before shipping it').toEqual([])
  })

  it('the mode flip is on the ceiling and is not one of the three', () => {
    // Declared as `animation-name` on an attribute selector rather than as a
    // shorthand, so it is absent from the table above. It is asserted here so
    // "the only motion outside the inventory" is a claim with a number on it.
    const byDirection = ["to-executive", "to-reference"]
    for (const direction of byDirection) {
      const rule = ast.nodes.find(
        (node) => node.type === 'rule' && node.selector === `.reader[data-mode-flip='${direction}']`,
      ) as Rule | undefined
      expect(rule, `the ${direction} flip keyframe is missing`).toBeDefined()
      let name = ''
      rule?.walkDecls('animation-name', (decl) => {
        name = decl.value
      })
      expect(name).toBe(`mode-flip-${direction === 'to-executive' ? 'a' : 'b'}`)
    }
    let duration = ''
    for (const node of ast.nodes) {
      if (node.type !== 'rule' || node.selector !== '.reader[data-mode-flip]') continue
      node.walkDecls('animation-duration', (decl) => {
        duration = decl.value
      })
    }
    expect(tokenOf(duration)).toBe('--motion-slow')
    expect(ms(tokenValue('--motion-slow'))).toBe(250)
  })
})

describe('§8 everything non-signature is ≤250ms', () => {
  it('no non-signature, non-reveal animation sits above the ceiling', () => {
    const offenders: string[] = []
    for (const motion of animations()) {
      // Ambient loops are exempt for a different reason and on a different tier:
      // §8 asks for them to be *slow*, and the tier test that covers them is the
      // one below. Skipping them here is not a hole — it is the other clause.
      if (SIGNATURE.includes(motion.name) || REVEALS.includes(motion.name)) continue
      if (AMBIENT.includes(motion.name)) continue
      const token = tokenOf(motion.duration)
      if (token === null) continue
      if (ms(tokenValue(token)) > 250) offenders.push(`${motion.name} → ${token}`)
    }
    expect(offenders).toEqual([])
  })

  it('and no transition sits on a tier above it either', () => {
    // `breakpoints.test.ts` already proves no transition is a bare literal; this
    // proves the *tier*, because a hover on `--motion-reveal` would pass that
    // test and still be a 560ms hover.
    const offenders: string[] = []
    ast.walkDecls('transition', (decl) => {
      if (decl.value.trim() === '' || decl.value === 'none') return
      const parent = decl.parent
      const where = parent !== undefined && parent.type === 'rule' ? parent.selector : '?'
      for (const wrapped of decl.value.match(/var\(--motion-[a-z]+\)/gu) ?? []) {
        // `var(--motion-fast)` → `--motion-fast`; `tokenValue` reads declarations,
        // not `var()` references.
        const token = wrapped.slice(4, -1)
        if (ms(tokenValue(token)) > 250) offenders.push(`${token} on ${where}`)
      }
    })
    expect(offenders).toEqual([])
  })
})

describe('§8 reveals fire once, ambient loops are slow', () => {
  it('the reveal is one-shot and inside the 500–600ms band', () => {
    for (const reveal of REVEALS) {
      const motion = animations().find((candidate) => candidate.name === reveal)
      expect(motion, `${reveal} is missing`).toBeDefined()
      expect(motion?.iteration, `${reveal} loops`).toBe('1')
      const token = tokenOf(motion?.duration ?? '') as string
      const value = ms(tokenValue(token))
      expect(value).toBeGreaterThanOrEqual(500)
      expect(value).toBeLessThanOrEqual(600)
    }
  })

  it('the ambient loops are infinite, and slow', () => {
    for (const name of AMBIENT) {
      const motion = animations().find((candidate) => candidate.name === name)
      expect(motion, `${name} is missing`).toBeDefined()
      expect(motion?.iteration, `${name} does not loop`).toBe('infinite')
      // "Slow" is §8's word, and the tier is where it is expressed. This is the
      // assertion that failed before M4.4: both loops were on
      // `--motion-reveal`, which is 560ms — a flicker, not an ambient loop.
      expect(tokenOf(motion?.duration ?? ''), `${name} is not on the ambient tier`).toBe(
        '--motion-ambient',
      )
      expect(ms(tokenValue('--motion-ambient'))).toBeGreaterThan(2000)
    }
  })

  it('the tiers are distinct numbers, so borrowing one is visible', () => {
    expect(tokenValue('--motion-reveal')).not.toBe(tokenValue('--motion-ambient'))
    expect(tokenValue('--motion-slow')).not.toBe(tokenValue('--motion-reveal'))
  })
})

describe('§8 reduced motion neutralises every tier', () => {
  it('the override zeroes all five tokens', () => {
    const block = tokensCss.match(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\n\}/u)?.[0] ?? ''
    for (const token of [
      '--motion-fast',
      '--motion-base',
      '--motion-slow',
      '--motion-reveal',
      '--motion-ambient',
    ]) {
      expect(block, `${token} is not zeroed under reduced motion`).toContain(`${token}: 0ms`)
    }
  })

  it('and forces every element to 0ms, so even a literal would be caught', () => {
    expect(tokensCss).toContain('animation-duration: 0ms !important')
    expect(tokensCss).toContain('animation-iteration-count: 1 !important')
    expect(tokensCss).toContain('transition-duration: 0ms !important')
  })
})
