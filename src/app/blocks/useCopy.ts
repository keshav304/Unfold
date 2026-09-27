/**
 * Copy-to-clipboard with the "Copied ✓" acknowledgement (§7.1). Falls back to a
 * hidden textarea + `execCommand` where the async clipboard API is unavailable
 * or blocked (a `file://` page is not a secure context).
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export function useCopy(value: string, resetAfterMs = 2000): { copied: boolean; copy: () => Promise<void> } {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = useCallback(async () => {
    const ok = await writeToClipboard(value)
    if (!ok) return
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), resetAfterMs)
  }, [resetAfterMs, value])

  return { copied, copy }
}

async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path.
  }

  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
