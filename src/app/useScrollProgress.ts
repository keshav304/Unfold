/**
 * Read progress + scroll position (spec §7.10). Two independent signals, both
 * fed to CSS custom properties so no component hardcodes a duration.
 */

import { useEffect, useState } from 'react'

export function useScrollProgress(): { progress: number; past: boolean } {
  const [progress, setProgress] = useState(0)
  const [past, setPast] = useState(false)

  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      const doc = document.documentElement
      const scrollable = doc.scrollHeight - doc.clientHeight
      setProgress(scrollable <= 0 ? 0 : Math.min(1, Math.max(0, doc.scrollTop / scrollable)))
      setPast(window.scrollY > 600)
    }
    const onScroll = () => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return { progress, past }
}
