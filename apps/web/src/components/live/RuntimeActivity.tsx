import { type CSSProperties, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import './RuntimeActivity.css'

type ActivityKind = 'tool' | 'reasoning' | 'outputting' | 'unknown'

type GlyphKind = Exclude<ActivityKind, 'unknown'>
type Phase = 'enter' | 'loop' | 'exit'

// Keep the original entrance/exit proportions, including the final stagger.
const TIMING = {
  tool: { enter: 720, exit: 672, stagger: 0 },
  reasoning: { enter: 572, exit: 264, stagger: 100 },
  outputting: { enter: 500, exit: 320, stagger: 0 },
} as const

function ActivityGlyph({ kind, phase, glyphRef }: { kind: GlyphKind; phase: Phase; glyphRef: React.RefObject<HTMLSpanElement | null> }) {
  const timing = TIMING[kind]
  const id = useId()
  const gradientId = `${id}-gradient`
  const maskId = `${id}-mask`
  return (
    <span ref={glyphRef} className={`runtime-glyph text-zinc-900 dark:text-white runtime-glyph-${phase}`} data-kind={kind} data-phase={phase} style={{ '--enter': `${timing.enter}ms`, '--exit': `${timing.exit}ms`, '--st': `${timing.stagger}ms` } as CSSProperties}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        {kind === 'tool' && <>
          <path className="runtime-term-c runtime-dash" pathLength="1" d="M11 14 L23 24 L11 34" />
          <path className="runtime-term-u" d="M26 35 H38" />
        </>}
        {kind === 'reasoning' && [11, 24, 37].map((cx, i) => (
          <circle key={cx} className="runtime-dot" style={{ '--i': i } as CSSProperties} cx={cx} cy="24" r="3.6" />
        ))}
        {kind === 'outputting' && <>
          <defs>
            <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="48">
              <stop offset="0" stopColor="#000" />
              <stop offset=".19" stopColor="#fff" />
              <stop offset=".79" stopColor="#fff" />
              <stop offset=".96" stopColor="#000" />
            </linearGradient>
            <mask id={maskId} maskUnits="userSpaceOnUse" x="-8" y="0" width="64" height="48">
              <rect x="-8" y="0" width="64" height="48" fill={`url(#${gradientId})`} stroke="none" />
            </mask>
          </defs>
          <g mask={`url(#${maskId})`}>
            {[38, 30, 40, 26, 35].map((end, i) => (
              <path key={end} className="runtime-tp runtime-dash" style={{ '--i': i } as CSSProperties} pathLength="1" d={`M8 38 H${end}`} />
            ))}
          </g>
        </>}
      </svg>
    </span>
  )
}

function ActivityText({ kind, text }: { kind: ActivityKind; text: string }) {
  const [transition, setTransition] = useState({ kind, text, previous: '', revision: 0 })

  // Retain the outgoing text for its exit animation. Detail updates within a
  // phase update immediately without restarting either animation.
  if (transition.kind !== kind || transition.text !== text) {
    setTransition({
      kind,
      text,
      previous: transition.kind !== kind ? transition.text : transition.previous,
      revision: transition.revision + Number(transition.kind !== kind),
    })
  }

  useEffect(() => {
    if (!transition.previous) return
    const timer = window.setTimeout(() => {
      setTransition(current => ({ ...current, previous: '' }))
    }, 220)
    return () => window.clearTimeout(timer)
  }, [transition.revision, transition.previous])

  return (
      <span className="runtime-text-window min-w-0 flex-1">
        {transition.previous && (
          <span key={`out-${transition.revision}`} className="runtime-text-out line-clamp-2 break-words" aria-hidden="true">
            {transition.previous}
          </span>
        )}
        <span key={transition.revision} className={`line-clamp-2 break-words${transition.revision ? ' runtime-text-in' : ''}`}>
          {text}
        </span>
      </span>
  )
}

type Activity = { kind: ActivityKind; text: string; title: string }

export function RuntimeActivity(requestedActivity: Activity) {
  const lastGlyphKind = useRef<GlyphKind>('reasoning')
  if (requestedActivity.kind !== 'unknown') lastGlyphKind.current = requestedActivity.kind
  // Gaps between live items change the text, while the existing glyph keeps looping.
  const activity = { ...requestedActivity, kind: lastGlyphKind.current }
  const [shown, setShown] = useState(activity)
  const [phase, setPhase] = useState<Phase>('enter')
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const latest = useRef(activity)
  const glyphRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!media) return
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useLayoutEffect(() => {
    latest.current = activity
    if (reducedMotion) {
      setShown(current => current.kind === activity.kind && current.text === activity.text && current.title === activity.title ? current : activity)
      setPhase(reducedMotion ? 'loop' : 'enter')
    } else if (shown.kind === activity.kind && phase !== 'exit') {
      if (shown.text !== activity.text || shown.title !== activity.title) setShown(activity)
    } else if (phase !== 'exit') {
      // Exit from the exact frame currently on screen, even halfway through
      // an entrance or a dot bounce. Never jump back to a canonical pose.
      glyphRef.current?.querySelectorAll<SVGElement>('path, circle').forEach(element => {
        const style = getComputedStyle(element)
        element.style.setProperty('--exit-transform', style.transform)
        element.style.setProperty('--exit-opacity', style.opacity)
        element.style.setProperty('--exit-dash', style.strokeDashoffset)
      })
      setPhase('exit')
    }
  }, [activity.kind, activity.text, activity.title, shown.kind, shown.text, shown.title, phase, reducedMotion])

  useEffect(() => {
    if (reducedMotion || phase === 'loop') return
    const timing = TIMING[shown.kind]
    const timer = window.setTimeout(() => {
      if (phase === 'enter') setPhase('loop')
      else {
        // Coalesce rapid changes: finish the visible exit, then show the
        // latest requested activity instead of replaying obsolete phases.
        setShown(latest.current)
        setPhase('enter')
      }
    }, timing[phase] + 2 * timing.stagger)
    return () => window.clearTimeout(timer)
  }, [shown.kind, phase, reducedMotion])

  return (
    <div className="session-runtime-activity mt-2 mb-3 flex items-start gap-1.5 text-xs text-zinc-500 dark:text-zinc-400" title={shown.title}>
      <ActivityGlyph key={shown.kind} kind={shown.kind} phase={phase} glyphRef={glyphRef} />
      <ActivityText kind={shown.kind} text={shown.text} />
    </div>
  )
}
