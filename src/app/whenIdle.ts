/**
 * Defer non-critical work until the browser is idle (M4.6, §10).
 *
 * The two heavy lazy chunks — mermaid and the Shiki highlighter — are already
 * dynamic imports, which means the *bytes* are deferred. What was not deferred
 * is the *main thread*: both were kicked off from a `useEffect` that runs during
 * the initial render, so a 645KB mermaid chunk and a full-document highlight pass
 * landed in the same burst as React's first commit. Under Lighthouse's 4× CPU
 * throttling that burst is the whole of the app's total blocking time.
 *
 * This is "defer non-critical work" and nothing more: the diagram still draws and
 * the code still gets highlighted. `{ timeout: 2000 }` is the important half —
 * without it, a document that never goes idle would never render its diagrams,
 * which is a behaviour change dressed up as an optimisation.
 */

/** `requestIdleCallback` where it exists, `setTimeout` where it does not. */
type IdleWindow = {
  requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

/** How long a deferred task may wait for an idle window before it runs anyway. */
const IDLE_TIMEOUT_MS = 2000

/**
 * Run `task` once the main thread is free, or after `IDLE_TIMEOUT_MS`,
 * whichever comes first. Returns a cancel function.
 */
export function whenIdle(task: () => void): () => void {
  if (typeof window === 'undefined') {
    task()
    return () => undefined
  }
  const idle = window as unknown as IdleWindow
  if (typeof idle.requestIdleCallback === 'function') {
    const handle = idle.requestIdleCallback(task, { timeout: IDLE_TIMEOUT_MS })
    return () => idle.cancelIdleCallback?.(handle)
  }
  const timer = window.setTimeout(task, 1)
  return () => window.clearTimeout(timer)
}
