import { useEffect, useRef, useState } from 'react'
import './ViewportShimmer.css'

/** Play two border sweeps each time a pending request enters the viewport. */
export function useViewportShimmer<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!enabled || !element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      setInView(entry.isIntersecting && entry.intersectionRatio >= 0.15)
    }, { threshold: 0.15 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [enabled])

  return { ref, className: enabled ? `viewport-shimmer ${inView ? 'viewport-shimmer--visible' : ''}` : '' }
}
