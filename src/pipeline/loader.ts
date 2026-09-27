/**
 * Document loading (spec §6.1). `fetch(docPath)` first; on a 404 or a `file://`
 * page the caller is told to show the drop screen. Parse failures surface as a
 * reason string, never as a thrown error and never as a blank screen.
 *
 * A5: a static host answers a missing file with the SPA shell and status 200,
 * so "200" alone does not mean "here is your document". An HTML response is the
 * app's own page, and rendering it as a document produces a confident,
 * completely wrong 0-section reader.
 */

import { warn } from './warn'

export type LoadResult =
  | { ok: true; source: string; path: string }
  | { ok: false; reason: LoadFailureReason; path: string; message: string }

export type LoadFailureReason =
  | 'not-found'
  | 'file-protocol'
  | 'fetch-failed'
  | 'no-source'
  | 'not-markdown'

/** How much of the body we look at when sniffing. */
const SNIFF_BYTES = 256

/**
 * Is this response the app shell rather than a document?
 *
 * Two independent signals, because either alone has a blind spot: a host may
 * serve markdown as `text/html` (wrong MIME, right body), and a proxy may drop
 * or rewrite the header (right MIME, wrong body).
 */
export function looksLikeHtml(contentType: string | null | undefined, body: string): boolean {
  if (typeof contentType === 'string' && contentType.toLowerCase().includes('text/html')) return true
  const head = body
    .slice(0, SNIFF_BYTES)
    .replace(/^\uFEFF/u, '')
    .trimStart()
    .toLowerCase()
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<?xml')
}

/** True when the app is running from a `file://` URL (no fetch available). */
export function isFileProtocol(location?: { protocol?: string }): boolean {
  const protocol =
    location === undefined
      ? typeof window === 'undefined'
        ? undefined
        : window.location.protocol
      : location.protocol
  return protocol === 'file:'
}

/** The message a reader needs in order to fix a misconfigured `docPath`. */
export function appShellMessage(path: string): string {
  return `Document not found at ${path} — the server returned the app shell. Check the docPath in unfold.config.json, and make sure the document is deployed alongside dist/.`
}

function describe(status: number): string {
  return status === 404
    ? 'the document was not found (404)'
    : `the document could not be fetched (HTTP ${status})`
}

/**
 * Fetch a markdown document. `fetcher` is injectable so tests never touch the
 * network and the `file://` branch stays stubbable.
 */
export async function loadDocument(
  path: string,
  options: { fetcher?: typeof fetch; location?: { protocol?: string } } = {},
): Promise<LoadResult> {
  if (path.trim() === '') {
    return { ok: false, reason: 'no-source', path, message: 'no document path was configured' }
  }

  if (isFileProtocol(options.location)) {
    return {
      ok: false,
      reason: 'file-protocol',
      path,
      message: 'opened from the file system; a document must be dropped or picked',
    }
  }

  const fetcher = options.fetcher ?? (typeof fetch === 'function' ? fetch : undefined)
  if (fetcher === undefined) {
    return {
      ok: false,
      reason: 'fetch-failed',
      path,
      message: 'no fetch implementation is available in this environment',
    }
  }

  try {
    const response = await fetcher(path)
    if (!response.ok) {
      const message = describe(response.status)
      warn('load', `could not load ${path}`, message)
      return { ok: false, reason: 'not-found', path, message }
    }

    const source = await response.text()

    // A5: status 200 with an HTML body means the SPA fallback answered, not
    // the document. Refuse it rather than render our own shell as content.
    if (looksLikeHtml(response.headers?.get('content-type'), source)) {
      const message = appShellMessage(path)
      warn('load', `could not load ${path}`, message)
      return { ok: false, reason: 'not-found', path, message }
    }

    return { ok: true, source, path }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warn('load', `could not load ${path}`, message)
    return { ok: false, reason: 'fetch-failed', path, message }
  }
}

