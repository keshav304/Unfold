/**
 * Document loading (spec §6.1). `fetch(docPath)` first; on a 404 or a `file://`
 * page the caller is told to show the drop screen. Parse failures surface as a
 * reason string, never as a thrown error and never as a blank screen.
 */

import { warn } from './warn'

export type LoadResult =
  | { ok: true; source: string; path: string }
  | { ok: false; reason: LoadFailureReason; path: string; message: string }

export type LoadFailureReason = 'not-found' | 'file-protocol' | 'fetch-failed' | 'no-source'

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
    return { ok: true, source: await response.text(), path }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warn('load', `could not load ${path}`, message)
    return { ok: false, reason: 'fetch-failed', path, message }
  }
}
