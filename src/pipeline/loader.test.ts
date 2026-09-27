/**
 * §6.1 — loading. `fetch(docPath)` first; a 404 or a `file://` page means the drop
 * screen. Failures are reasons, never exceptions, and never a blank screen.
 */

import { describe, expect, it, vi } from 'vitest'
import { isFileProtocol, loadDocument } from './loader'

const okResponse = (body: string): Response =>
  ({ ok: true, status: 200, text: async () => body }) as Response

describe('loadDocument', () => {
  it('returns the source on success', async () => {
    const fetcher = vi.fn(async () => okResponse('# Hello'))
    const result = await loadDocument('./doc.md', { fetcher: fetcher as unknown as typeof fetch })
    expect(result).toEqual({ ok: true, source: '# Hello', path: './doc.md' })
    expect(fetcher).toHaveBeenCalledWith('./doc.md')
  })

  it('a 404 means the drop screen, not an exception', async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 404 }) as Response)
    const result = await loadDocument('./missing.md', { fetcher: fetcher as unknown as typeof fetch })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('not-found')
      expect(result.message).toContain('404')
    }
  })

  it('a non-404 HTTP failure still degrades with a reason', async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 500 }) as Response)
    const result = await loadDocument('./doc.md', { fetcher: fetcher as unknown as typeof fetch })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not-found')
  })

  it('a network throw becomes a fetch-failed reason', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('offline')
    })
    const result = await loadDocument('./doc.md', { fetcher: fetcher as unknown as typeof fetch })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('fetch-failed')
  })

  it('a file:// page short-circuits to the drop screen without fetching', async () => {
    const fetcher = vi.fn(async () => okResponse('# Hello'))
    const result = await loadDocument('./doc.md', {
      fetcher: fetcher as unknown as typeof fetch,
      location: { protocol: 'file:' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('file-protocol')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('an empty path is a reason, not a crash', async () => {
    const result = await loadDocument('   ', { fetcher: (async () => okResponse('')) as unknown as typeof fetch })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('no-source')
  })

  it('never rejects, whatever fetch does', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    await expect(loadDocument('./doc.md', { fetcher: fetcher as unknown as typeof fetch })).resolves.toBeDefined()
  })
})

describe('isFileProtocol', () => {
  it('detects the file protocol', () => {
    expect(isFileProtocol({ protocol: 'file:' })).toBe(true)
    expect(isFileProtocol({ protocol: 'https:' })).toBe(false)
  })
})
