import type { ProjectSummary } from '../hooks/use-projects'
import { useTick } from '../hooks/use-status'
import { runtimeInfo } from '../lib/runtime'
import { useIsLiveConnected, useIsLiveInitialized, useLiveSessionStore } from '../store/live-session-store'

interface StatusBarProps { projects: ProjectSummary[] }

export function StatusBar({ projects }: StatusBarProps) {
  const connected = useIsLiveConnected()
  const initialized = useIsLiveInitialized()
  const lastUpdate = useLiveSessionStore((s) => s.lastUpdateTs)
  useTick(10_000)
  const age = lastUpdate ? Math.max(0, Math.floor((Date.now() - lastUpdate) / 1000)) : null
  const stale = age !== null && age > 30
  const label = !initialized ? 'Connecting…' : !connected ? 'Reconnecting…' : stale ? 'Updates delayed' : 'Live updates'
  const dot = !initialized ? 'bg-zinc-500' : !connected ? 'bg-red-500' : stale ? 'bg-amber-500' : 'bg-green-500'
  const sourceLabel = runtimeInfo.mode === 'demo' ? 'Demo · Simulated sessions' : runtimeInfo.requestReplies ? 'Codex · Requests & replies' : runtimeInfo.questionReplies ? 'Codex · Question replies' : 'Codex logs · Read only'
  return (
    <footer className="app-footer shrink-0 min-h-9 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-5 flex items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400" aria-label="Data freshness status">
      <div className="flex items-center gap-3 min-w-0" role="status">
        <span className="inline-flex items-center gap-2 whitespace-nowrap"><span className={`w-1.5 h-1.5 rounded-full ${dot}`} />{label}</span>
        {age !== null && <span className="hidden sm:inline text-zinc-400 dark:text-zinc-400">Last {runtimeInfo.mode === 'codex' ? 'scan' : 'event'} {age < 10 ? 'just now' : age < 60 ? `${age}s ago` : `${Math.floor(age / 60)}m ago`}</span>}
      </div>
      <div className="flex items-center gap-4 whitespace-nowrap">
        <span className="hidden md:inline">{projects.length} projects · {projects.reduce((n, p) => n + p.sessionCount, 0)} sessions</span>
        <span className="text-zinc-400 dark:text-zinc-400" title={runtimeInfo.mode === 'codex' ? 'Local Codex sessions. Answer pending requests on the board or conversation page when connected. Search covers indexed excerpts.' : undefined}>{sourceLabel}</span>
      </div>
    </footer>
  )
}
