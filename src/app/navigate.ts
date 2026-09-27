/**
 * In-app navigation (spec §7.1). Sets the hash and returns the slug so the
 * shell can scroll and flash the target. Falls back to a full hash change when
 * there is no `window`, so it is safe to call from tests.
 */

export function navigate(slug: string, onNavigate?: (slug: string) => void): void {
  if (typeof window !== 'undefined') {
    const next = `#${slug}`
    if (window.location.hash !== next) window.location.hash = next
    else window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
  onNavigate?.(slug)
}

export function scrollToSlug(slug: string): void {
  if (typeof document === 'undefined') return
  const target = document.getElementById(`section-${slug}`)
  target?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
