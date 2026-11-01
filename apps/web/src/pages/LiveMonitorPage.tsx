import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LiveMonitorSkeleton } from '../components/LoadingStates'
import { SessionGrid } from '../components/live/SessionGrid'
import { KeyboardShortcutHelp } from '../components/live/KeyboardShortcutHelp'
import { LiveFilterBar } from '../components/live/LiveFilterBar'
import { LiveMonitorEmptyState } from '../components/live/LiveMonitorEmptyState'
import { SessionDetailPanel } from '../components/live/SessionDetailPanel'
import { filterLiveSessions } from '../components/live/live-filter'
import { boardStatus, KANBAN_GROUP_BY_STORAGE_KEY, type KanbanGroupBy } from '../components/live/types'
import { lastPromptTime } from '../components/live/session-order'
import { useKeyboardShortcuts } from '../components/live/use-keyboard-shortcuts'
import { useLiveSessionFilters } from '../components/live/use-live-session-filters'
import { useTrackEvent } from '../hooks/use-track-event'
import { useLiveCommandStore } from '../store/live-command-context'
import {
  useActiveSessions,
  useIsLiveConnected,
  useIsLiveInitialized,
  useLiveSummary,
  useRecentlyClosed,
} from '../store/live-session-store'

export function LiveMonitorPage() {
  const trackEvent = useTrackEvent()
  useEffect(() => {
    trackEvent('live_monitor_viewed')
  }, [])
  const sessions = useActiveSessions()
  const serverSummary = useLiveSummary()
  const isConnected = useIsLiveConnected()
  const isInitialized = useIsLiveInitialized()
  const recentlyClosed = useRecentlyClosed()

  // Tick every ~1s for duration computation + stalled detection
  const [currentTime, setCurrentTime] = useState<number>(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(interval)
  }, [])
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const setLiveContext = useLiveCommandStore((s) => s.setContext)

  // Open an existing session from a history deep link.
  const focusSessionId = searchParams.get('focus')

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally minimal deps — only fire when focusSessionId changes
  useEffect(() => {
    if (focusSessionId) {
      setSelectedId(focusSessionId)
      const params = new URLSearchParams(searchParams)
      params.delete('focus')
      params.delete('view')
      setSearchParams(params, { replace: true })
    }
  }, [focusSessionId])

  // Filters
  const [filters, filterActions] = useLiveSessionFilters(searchParams, setSearchParams)

  const [savedGroupBy, setSavedGroupBy] = useState<KanbanGroupBy>(() => {
    try { return localStorage.getItem(KANBAN_GROUP_BY_STORAGE_KEY) === 'none' ? 'none' : 'project-branch' } catch { return 'project-branch' }
  })
  const groupBy: KanbanGroupBy = searchParams.has('groupBy') ? searchParams.get('groupBy') === 'project-branch' ? 'project-branch' : 'none' : savedGroupBy
  const handleGroupByChange = useCallback((value: KanbanGroupBy) => {
    const params = new URLSearchParams(searchParams)
    params.set('groupBy', value)
    setSavedGroupBy(value)
    try { localStorage.setItem(KANBAN_GROUP_BY_STORAGE_KEY, value) } catch { /* Storage is optional. */ }
    setSearchParams(params, { replace: true })
  }, [searchParams, setSearchParams])

  const needsYouOnly = searchParams.get('needYou') === '1' || filters.statuses.includes('needs_you')
  const savedStatuses = filters.statuses.filter((status) => status !== 'needs_you')
  const allSessions = useMemo(() => [...new Map([...sessions, ...recentlyClosed].map((session) => [session.id, session])).values()], [sessions, recentlyClosed])
  const visibleSessions = useMemo(() => filterLiveSessions(allSessions, { ...filters, statuses: [] })
    .filter((session) => needsYouOnly ? boardStatus(session) === 'needs_you' : !savedStatuses.length || savedStatuses.includes(boardStatus(session)))
    .sort((a, b) => lastPromptTime(b) - lastPromptTime(a) || a.id.localeCompare(b.id)), [allSessions, filters, needsYouOnly])

  const handleToggleNeedsYou = useCallback(() => {
    const params = new URLSearchParams(searchParams)
    if (needsYouOnly) {
      params.delete('needYou')
      const statuses = filters.statuses.filter((status) => status !== 'needs_you')
      if (statuses.length) params.set('status', statuses.join(','))
      else params.delete('status')
    } else params.set('needYou', '1')
    setSearchParams(params, { replace: true })
  }, [searchParams, setSearchParams, needsYouOnly, filters.statuses])

  const handleStatusChange = useCallback((statuses: string[]) => {
    const params = new URLSearchParams(searchParams)
    if (statuses.includes('needs_you')) params.set('needYou', '1')
    else {
      params.delete('needYou')
      if (statuses.length) params.set('status', statuses.join(','))
      else params.delete('status')
    }
    setSearchParams(params, { replace: true })
  }, [searchParams, setSearchParams])

  const availableProjects = useMemo(() => {
    const set = new Set([...sessions, ...recentlyClosed].map((s) => s.projectDisplayName || s.project))
    return Array.from(set).sort()
  }, [sessions, recentlyClosed])

  const availableBranches = useMemo(() => {
    const set = new Set([...sessions, ...recentlyClosed].filter((s) => s.effectiveBranch).map((s) => s.effectiveBranch!))
    return Array.from(set).sort()
  }, [sessions, recentlyClosed])

  // Session selection
  const handleSelectSession = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id))
  }, [])

  // Expand selected session (navigate to detail)
  const handleExpandSession = useCallback(
    (id: string) => {
      navigate(`/sessions/${id}`)
    },
    [navigate],
  )

  // Toggle help callback for command palette
  const handleToggleHelp = useCallback(() => {
    setShowHelp((prev) => !prev)
  }, [])

  // Keyboard shortcuts
  useKeyboardShortcuts({
    sessions: visibleSessions,
    selectedId,
    onSelect: setSelectedId,
    onExpand: handleExpandSession,
    onFocusSearch: () => {
      if (searchInputRef.current) searchInputRef.current.focus()
      else {
        document.querySelector<HTMLButtonElement>('[data-board-filter-trigger]')?.click()
        requestAnimationFrame(() => searchInputRef.current?.focus())
      }
    },
    onToggleHelp: handleToggleHelp,
    enabled: !showHelp,
  })

  // Register live command context for unified Cmd+K
  const commandContext = useMemo(
    () => ({
      sessions: allSessions,
      onFilterStatus: handleStatusChange,
      onClearFilters: filterActions.clearAll,
      onSelectSession: handleSelectSession,
      onToggleHelp: handleToggleHelp,
    }),
    [
      allSessions,
      handleSelectSession,
      handleToggleHelp,
      handleStatusChange,
      filterActions.clearAll,
    ],
  )

  useEffect(() => {
    setLiveContext(commandContext)
  }, [commandContext, setLiveContext])

  useEffect(() => {
    return () => setLiveContext(null)
  }, [setLiveContext])

  // Show skeleton until the server's first summary event arrives.
  if (!isInitialized) {
    return <LiveMonitorSkeleton />
  }

  return (
    <div className="task-board h-full flex flex-col">
      <div className="board-content flex-1 min-h-0 px-6 pt-3 pb-4 flex flex-col overflow-hidden">
        <div className="max-w-7xl mx-auto w-full flex-1 min-h-0 flex flex-col">
          <div className="board-controls flex items-center justify-end gap-2 shrink-0 pb-3">
            <button type="button" aria-pressed={needsYouOnly} onClick={handleToggleNeedsYou} className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${needsYouOnly ? 'border-zinc-300 bg-zinc-200 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100' : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Need you
            </button>
            <LiveFilterBar
              filters={{ ...filters, statuses: needsYouOnly ? [] : savedStatuses }}
              onStatusChange={handleStatusChange}
              onProjectChange={filterActions.setProjects}
              onBranchChange={filterActions.setBranches}
              onSearchChange={filterActions.setSearch}
              onClear={filterActions.clearAll}
              availableProjects={availableProjects}
              availableBranches={availableBranches}
              searchInputRef={searchInputRef}
              groupByValue={groupBy}
              onGroupByChange={handleGroupByChange}
            />
          </div>
          {allSessions.length === 0 && isConnected ? (
            <LiveMonitorEmptyState processCount={serverSummary?.processCount ?? 0} />
          ) : (
            <SessionGrid groupBy={groupBy} sessions={visibleSessions} selectedId={selectedId} onSelect={handleSelectSession} currentTime={currentTime} />
          )}
        </div>
      </div>

      {/* Session detail panel */}
      {selectedId &&
        (() => {
          const session =
            sessions.find((s) => s.id === selectedId) ??
            recentlyClosed.find((s) => s.id === selectedId)
          if (!session) return null
          return (
            <SessionDetailPanel
              session={session}
              onClose={() => setSelectedId(null)}
            />
          )
        })()}

      <KeyboardShortcutHelp isOpen={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  )
}
