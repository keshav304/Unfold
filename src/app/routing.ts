/**
 * Hash routing (spec §4): `#<slug>` is a section, `#/graph` and `#/stepper` are
 * the other views. A route to a view the document cannot support falls back to
 * the reader — never an error, never a blank screen (§1.3).
 *
 * The stepper is deep-linkable per step (§7.7), which is a second segment after
 * the view: `#/stepper/3` is step 3. The format is recorded in DECISIONS.md.
 */

export type Route =
  | { name: 'reader'; slug?: string }
  | { name: 'graph' }
  | { name: 'stepper'; step?: number }
  /**
   * The welcome view (M4.12). It is a route rather than a special case in the
   * shell because it has to be *linkable*: the header wordmark goes to it, so a
   * reader can be sent back to the front door from anywhere, and that has to
   * survive a reload and a shared link.
   */
  | { name: 'welcome' }

/** `#/stepper` — the stepper, at whatever step the reader was last on. */
export const STEPPER_HASH = '#/stepper'

/**
 * The stepper hash for one step. Steps are numbered from 1, as authored.
 */
export function stepperHash(step: number): string {
  return `${STEPPER_HASH}/${Math.max(1, Math.trunc(step))}`
}

export const READER_HASH = '#/'

/** `#/welcome` — the front door (M4.12). */
export const WELCOME_HASH = '#/welcome'

/** Decode a hash fragment without ever throwing on a malformed escape. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Read a location hash into a route. Unknown or empty hashes are the reader. */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#+/u, '')
  if (raw === '' || raw === '/') return { name: 'reader' }
  if (raw === '/welcome') return { name: 'welcome' }
  if (raw === '/graph') return { name: 'graph' }
  if (raw === '/stepper') return { name: 'stepper' }
  // `#/stepper/3` — the deep link for one step (§7.7). Only digits: a
  // non-numeric segment is not a step, and is treated as unknown rather than
  // silently read as step 1, which would show the wrong step for a bad link.
  const stepper = /^\/stepper\/(\d+)$/u.exec(raw)
  if (stepper !== null) {
    const step = Number.parseInt(stepper[1] as string, 10)
    return step >= 1 ? { name: 'stepper', step } : { name: 'stepper' }
  }
  // An unknown `/view` is still a reader route; the leading slash is not part
  // of a slug, and a document that happens to have one is handled by lookup.
  return { name: 'reader', slug: safeDecode(raw.replace(/^\/+/u, '')) }
}

/** The hash a route should be written to. */
export function hashFor(route: Route): string {
  if (route.name === 'welcome') return WELCOME_HASH
  if (route.name === 'graph') return '#/graph'
  if (route.name === 'stepper') {
    return route.step === undefined ? STEPPER_HASH : stepperHash(route.step)
  }
  return route.slug === undefined || route.slug === '' ? READER_HASH : `#${route.slug}`
}

/**
 * Views a document can actually render (spec §1.1). The nav item for a view
 * that is not in this list must not be rendered at all — that is the whole
 * point of capability detection.
 */
export type ViewName = 'reader' | 'graph' | 'stepper'

export function capableViews(capabilities: {
  graph: boolean
  stepper: boolean
}): ViewName[] {
  const views: ViewName[] = ['reader']
  if (capabilities.graph) views.push('graph')
  if (capabilities.stepper) views.push('stepper')
  return views
}

/**
 * Resolve a route against a document's capabilities. An incapable or unknown
 * route degrades to the reader; a `#slug` that does not exist degrades to the
 * reader at the top.
 */
export function resolveRoute(route: Route, capabilities: { graph: boolean; stepper: boolean }): Route {
  if (route.name === 'graph' && !capabilities.graph) return { name: 'reader' }
  if (route.name === 'stepper' && !capabilities.stepper) return { name: 'reader' }
  return route
}
