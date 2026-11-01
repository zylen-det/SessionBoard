import { type CSSProperties, useEffect, useState } from 'react'
import './RuntimeActivity.css'

type ActivityKind = 'tool' | 'reasoning' | 'outputting' | 'unknown'

const TIMING = {
  tool: { '--d': '2.4s', '--st': '0s' },
  reasoning: { '--d': '2.2s', '--st': '.1s' },
  outputting: { '--d': '2.6s', '--st': '.13s' },
} satisfies Record<Exclude<ActivityKind, 'unknown'>, CSSProperties & Record<string, string>>

function ActivityGlyph({ kind }: { kind: Exclude<ActivityKind, 'unknown'> }) {
  return (
    <span className="runtime-glyph text-zinc-900 dark:text-white" style={TIMING[kind] as CSSProperties}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        {kind === 'tool' && <>
          <path className="runtime-term-c runtime-dash" pathLength="1" d="M11 14 L23 24 L11 34" />
          <path className="runtime-term-u" d="M26 35 H38" />
        </>}
        {kind === 'reasoning' && [11, 24, 37].map((cx, i) => (
          <circle key={cx} className="runtime-dot" style={{ '--i': i } as CSSProperties} cx={cx} cy="24" r="3.6" />
        ))}
        {kind === 'outputting' && ['M9 14 H39', 'M9 24 H29', 'M9 34 H34'].map((d, i) => (
          <path key={d} className="runtime-line runtime-dash" style={{ '--i': i } as CSSProperties} pathLength="1" d={d} />
        ))}
      </svg>
    </span>
  )
}

export function RuntimeActivity({ kind, text, title }: { kind: ActivityKind; text: string; title: string }) {
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
    <div className="session-runtime-activity mt-2 mb-3 flex items-start gap-1.5 text-xs text-zinc-500 dark:text-zinc-400" title={title}>
      {kind !== 'unknown' && <ActivityGlyph key={kind} kind={kind} />}
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
    </div>
  )
}
