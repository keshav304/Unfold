/**
 * In-app navigation (spec §7.1). Sets the hash and returns the slug so the
 * shell can scroll and flash the target. Falls back to a full hash change when
 * there is no `window`, so it is safe to call from tests.
 */

export function navigate(slug: string, onNavigate?: (slug: string) => void): void {
  if (typeof window !== 'undefined') {
    const next = `#${slug}`
    if (window.location.hash !== next) {
      window.location.hash = next
      // jsdom and some embedded engines do not synthesise the event.
      if (typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event('hashchange'))
    }
  }
  onNavigate?.(slug)
}

export function scrollToSlug(slug: string): void {
  if (typeof document === 'undefined') return
  const target = document.getElementById(`section-${slug}`)
  if (target === null) return
  // `scrollIntoView` is absent in some environments (jsdom, very old browsers).
  // Navigation is a convenience, never a crash path.
  if (typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
  }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
