/**
 * Hash routing (spec §4): `#<slug>` is a section, `#/graph` and `#/stepper` are
 * the other views. A route to a view the document cannot support falls back to
 * the reader — never an error, never a blank screen (§1.3).
 */

export type Route =
  | { name: 'reader'; slug?: string }
  | { name: 'graph' }
  | { name: 'stepper' }

export const READER_HASH = '#/'

/** Read a location hash into a route. Unknown or empty hashes are the reader. */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#+/u, '')
  if (raw === '' || raw === '/') return { name: 'reader' }
  if (raw === '/graph') return { name: 'graph' }
  if (raw === '/stepper') return { name: 'stepper' }
  return { name: 'reader', slug: decodeURIComponent(raw) }
}

/** The hash a route should be written to. */
export function hashFor(route: Route): string {
  if (route.name === 'graph') return '#/graph'
  if (route.name === 'stepper') return '#/stepper'
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
