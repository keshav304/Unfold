import '@testing-library/jest-dom/vitest'

/**
 * jsdom implements neither of the observers a real browser ships, and cmdk
 * (M2.2) subscribes to a `ResizeObserver` on its list. Without a stub, merely
 * *opening* the palette throws, which would make the palette untestable in
 * jsdom — and the honest response to "the library needs an API jsdom lacks" is
 * to stub that API, not to skip the tests.
 *
 * The stub records nothing and fires nothing: layout is not what these tests
 * are about, and the Playwright suite (M2.PW3) is what proves the real
 * geometry. `IntersectionObserver` is here for the same reason — the scrollspy
 * uses it.
 */
class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return []
  }
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = NoopObserver as unknown as typeof ResizeObserver
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = NoopObserver as unknown as typeof IntersectionObserver
}

/**
 * `Element.scrollIntoView` is not implemented by jsdom at all (it is not a
 * function, not merely a no-op). cmdk calls it on the selected row to keep the
 * selection in view, and `navigate.ts` guards for its absence — so the app's own
 * navigation is already safe, and this stub is only for the library.
 */
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
}
