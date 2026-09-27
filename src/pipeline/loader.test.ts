/**
 * §6.1 — loading. `fetch(docPath)` first; a 404 or a `file://` page means the drop
 * screen. Failures are reasons, never exceptions, and never a blank screen.
 */

import { describe, expect, it, vi } from 'vitest'
import { isFileProtocol, loadDocument, looksLikeHtml } from './loader'

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

/* ------------------------------------------------------------------ *
 * A5 — a 200 response whose body is the app shell is NOT the document
 * ------------------------------------------------------------------ */

/** The real `index.html`, which is what a static host returns for a miss. */
const APP_SHELL = `<!doctype html>
<html lang="en" data-theme="dark">
  <head><meta charset="UTF-8" /><title>Unfold</title></head>
  <body><div id="root"></div></body>
</html>
`

const htmlResponse = (body: string, contentType = 'text/html'): Response =>
  ({
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => body,
  }) as unknown as Response

describe('looksLikeHtml', () => {
  it('catches a text/html content type', () => {
    expect(looksLikeHtml('text/html; charset=utf-8', '# Real')).toBe(true)
    expect(looksLikeHtml('TEXT/HTML', '# Real')).toBe(true)
  })

  it('catches a shell body even when the header is wrong', () => {
    expect(looksLikeHtml('text/plain', APP_SHELL)).toBe(true)
  })

  it('catches an xml prolog', () => {
    expect(looksLikeHtml(null, '<?xml version="1.0"?><html></html>')).toBe(true)
  })

  it('tolerates a byte-order mark and leading whitespace', () => {
    expect(looksLikeHtml(null, `\uFEFF\n  <!doctype html><html>`)).toBe(true)
  })

  it('does not flag a real markdown document', () => {
    for (const body of ['# Title\n\nProse.', 'Plain text, no markup.', '', '   \n\n']) {
      expect(looksLikeHtml('text/markdown', body)).toBe(false)
    }
  })

  it('does not flag markdown that merely mentions html tags in prose', () => {
    const body = 'Use a <span> element in your template.\n\n## Section\n\nMore prose about <div> tags.'
    expect(looksLikeHtml('text/markdown', body)).toBe(false)
  })

  it('only sniffs the first 256 bytes', () => {
    const body = `${'x'.repeat(300)}\n<!doctype html>`
    expect(looksLikeHtml('text/markdown', body)).toBe(false)
  })
})

describe('A5: a 200 response containing the app shell is treated as not-found', () => {
  it('refuses an HTML body and explains why', async () => {
    const fetcher = vi.fn(async () => htmlResponse(APP_SHELL))
    const result = await loadDocument('./missing.md', { fetcher: fetcher as unknown as typeof fetch })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('not-found')
      expect(result.message).toMatch(/app shell/i)
      expect(result.message).toContain('./missing.md')
      expect(result.message).toMatch(/unfold\.config\.json/)
    }
  })

  it('never hands the shell back as a document', async () => {
    const fetcher = vi.fn(async () => htmlResponse(APP_SHELL))
    const result = await loadDocument('./missing.md', { fetcher: fetcher as unknown as typeof fetch })
    expect(result.ok).toBe(false)
    expect('source' in result).toBe(false)
  })

  it('refuses on content-type alone, even when the body looks like markdown', async () => {
    // Deliberate, and a real trade-off: an HTML content type on a path we
    // expect to be markdown is the shell-fallback signature, so the header
    // wins. The cost is that a host serving .md as text/html will be refused
    // — a false negative, which §1.1 prefers over a fictional document.
    const fetcher = vi.fn(async () => htmlResponse('# Real document\n\nProse.', 'text/html'))
    const result = await loadDocument('./doc.md', { fetcher: fetcher as unknown as typeof fetch })
    expect(result.ok).toBe(false)
  })

  it('accepts a real markdown document served as text/markdown', async () => {
    const fetcher = vi.fn(async () => htmlResponse('# Real document\n\nProse.', 'text/markdown'))
    const result = await loadDocument('./doc.md', { fetcher: fetcher as unknown as typeof fetch })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.source).toBe('# Real document\n\nProse.')
  })

  it('survives a response with no headers object at all', async () => {
    const bare = { ok: true, status: 200, text: async () => '# Doc\n' } as unknown as Response
    const result = await loadDocument('./doc.md', { fetcher: (async () => bare) as unknown as typeof fetch })
    expect(result.ok).toBe(true)
  })

  it('a genuinely missing file still reports 404, not the shell message', async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 404 }) as Response)
    const result = await loadDocument('./missing.md', { fetcher: fetcher as unknown as typeof fetch })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('404')
  })
})
