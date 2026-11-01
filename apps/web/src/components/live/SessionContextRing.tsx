import type { LiveSession } from './use-live-sessions'

export function SessionContextRing({ session }: { session: LiveSession }) {
  const limit = session.statuslineContextWindowSize
  const rawPercent = session.statuslineUsedPct ?? (limit && limit > 0 ? session.contextWindowTokens / limit * 100 : null)
  const percent = rawPercent != null && Number.isFinite(rawPercent) ? Math.max(0, Math.min(100, rawPercent)) : null
  const label = percent == null ? 'Context usage unavailable' : `Context usage: ${Math.round(percent)}%`
  const title = percent != null && limit && limit > 0
    ? `${label} (${session.contextWindowTokens.toLocaleString()} / ${limit.toLocaleString()} tokens)`
    : label
  const color = percent == null ? 'text-zinc-400 dark:text-zinc-600'
    : percent >= 80 ? 'text-red-500' : percent >= 60 ? 'text-amber-500' : 'text-blue-500 dark:text-blue-400'

  return (
    <span
      className={`session-context inline-flex items-center gap-1 ${color}`}
      role={percent == null ? 'img' : 'meter'}
      aria-label={label}
      aria-valuemin={percent == null ? undefined : 0}
      aria-valuemax={percent == null ? undefined : 100}
      aria-valuenow={percent ?? undefined}
      title={title}
    >
      <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
        {percent != null && (
          <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2.5"
            pathLength="100" strokeDasharray={`${percent} 100`} transform="rotate(-90 10 10)" />
        )}
      </svg>
      {percent != null && <span className="text-[10px] tabular-nums">{Math.round(percent)}%</span>}
    </span>
  )
}
