/**
 * Web analytics: the claims, asserted.
 *
 * Four things are true of this feature and each one is checkable in jsdom, so
 * none of them is left as a comment:
 *
 *  - **It is mounted, once.** The component injects a script into the head and
 *    guards against doing it twice — which matters because a second copy of an
 *    analytics script double-counts every page view, silently, and shows up in
 *    neither the console nor a screenshot.
 *  - **It is deferred.** A render-blocking script here would be a first-party
 *    regression on the §10.1 critical path, in exchange for no data.
 *  - **It sets no cookie.** This is the privacy claim the README makes, so it is
 *    a test rather than a promise: an empty cookie jar is what "no identifier,
 *    nothing to consent to" means in practice.
 *  - **The mode is pinned to production**, so `npm run dev` does not report and
 *    a preview deploy's traffic is not counted as production.
 *
 * What is deliberately *not* tested here: whether Vercel's own script works.
 * That is platform code, served from a URL this repository does not own, and a
 * test that mocked it would be asserting that a mock was called.
 * `tests/e2e/analytics.spec.ts` covers the part that is ours — the request is
 * made, the console stays quiet, and the document still renders.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { Analytics } from '@vercel/analytics/react'
import { renderFixture } from './render-helpers'

/** The analytics script tags currently in the document, in order. */
function analyticsScripts(): HTMLScriptElement[] {
  return Array.from(
    document.head.querySelectorAll<HTMLScriptElement>('script[src*="/_vercel/insights/"]'),
  )
}

afterEach(() => {
  // The component dedupes by `src` for the life of the document, so the tags must
  // be removed between tests or the second scenario asserts the first one's work.
  for (const script of analyticsScripts()) script.remove()
  cleanup()
})

describe('web analytics is mounted once, deferred, and cookie-free', () => {
  it('the app mounts exactly one analytics script', async () => {
    const { container } = await renderFixture('kitchen-sink')
    expect(container.querySelector('.app')).not.toBeNull()
    // Waited for, not asserted synchronously, and the wait is the finding: the
    // shell's first paint is the loading state, and the analytics effect commits
    // with the render that has the document in it. An assertion written against
    // the moment `renderFixture` returns would be asserting a timing detail of
    // React's flush rather than a fact about the app — and it fails.
    await waitFor(() => expect(analyticsScripts()).toHaveLength(1))
    expect(analyticsScripts()[0]?.src).toContain('/_vercel/insights/script.js')
  })

  it('and remounting the app does not add a second one', async () => {
    // The double-counting failure is invisible everywhere: two identical
    // scripts, both working, every number doubled.
    const first = await renderFixture('kitchen-sink')
    first.unmount()
    await renderFixture('minimal')
    await waitFor(() => expect(analyticsScripts()).toHaveLength(1))
    // …and still one, not two. The dedupe is by `src` for the life of the
    // document, which is what stops every re-render from counting the view twice.
    expect(analyticsScripts()).toHaveLength(1)
  })

  it('the script is deferred, so it cannot block first paint', async () => {
    await renderFixture('kitchen-sink')
    await waitFor(() => expect(analyticsScripts()).toHaveLength(1))
    const script = analyticsScripts()[0]
    expect(script, 'no analytics script was injected').toBeDefined()
    expect(script?.defer ?? script?.async, 'the analytics script is render-blocking').toBe(true)
  })

  it('and nothing sets a cookie — no identifier means nothing to consent to', async () => {
    await renderFixture('kitchen-sink')
    await waitFor(() => expect(analyticsScripts()).toHaveLength(1))
    // The app's own preferences (reading mode, palette) live in `localStorage`,
    // which never leaves the browser. The cookie jar is what would cross the wire,
    // so the jar is what the claim is about.
    expect(document.cookie).toBe('')
    expect(analyticsScripts()).toHaveLength(1)
  })

  it('the mode is pinned to production, so a dev server does not report', async () => {
    await renderFixture('kitchen-sink')
    await waitFor(() => expect(analyticsScripts()).toHaveLength(1))
    const mode = (window as unknown as { vam?: string }).vam
    expect(mode).toBe('production')
  })

  it('it renders nothing visible — an element here would be a layout shift', () => {
    // CLS is gated at 0.000, and a wrapper `<div>` around nothing is still a box
    // in the layout. The component's contract is that it renders null.
    const { container } = render(<Analytics mode="production" />)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('and the document still renders with analytics on', async () => {
    // The last word: enabling telemetry must not have cost the app its document.
    const { container } = await renderFixture('kitchen-sink')
    await waitFor(() => expect(analyticsScripts()).toHaveLength(1))
    expect(container.querySelector('.reader')).not.toBeNull()
    expect(container.querySelectorAll('.ascii-diagram')).toHaveLength(1)
    expect(container.textContent).toContain('Runtime shape')
  })
})
