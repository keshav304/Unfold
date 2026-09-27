/**
 * Scrollspy for the metro TOC (spec §7.3).
 *
 * The boundary rule that matters: at the very bottom of the document the last
 * H2 must become active. IntersectionObserver `rootMargin` tricks do not
 * achieve that reliably — at the end of the page the final section can be
 * shorter than the viewport and never reach the trigger line. So the bottom is
 * handled explicitly.
 */

import { useEffect, useState } from 'react'

export function useScrollSpy(slugs: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(slugs[0] ?? null)
  // A stable primitive, so passing a freshly-mapped array does not re-subscribe
  // on every render.
  const key = slugs.join(' ')

  useEffect(() => {
    if (slugs.length === 0) {
      setActive(null)
      return
    }

    const atBottom = () => {
      const doc = document.documentElement
      // 2px of slack so sub-pixel rounding at the end of a page still counts.
      return doc.scrollHeight - doc.clientHeight - window.scrollY <= 2
    }

    const update = () => {
      let next: string | null = slugs[0] ?? null

      if (atBottom()) {
        // The explicit rule: the last H2 owns the end of the document.
        next = slugs[slugs.length - 1] ?? null
      } else {
        // Otherwise the topmost section whose heading has passed the line.
        const line = 96
        for (const slug of slugs) {
          const element = document.getElementById(`section-${slug}`)
          if (element === null) continue
          if (element.getBoundingClientRect().top <= line) next = slug
          else break
        }
      }

      setActive(next)
    }

    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [key, slugs])

  return active
}
