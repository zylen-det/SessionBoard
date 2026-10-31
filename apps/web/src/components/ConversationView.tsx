import { ConversationThread } from '@claude-view/shared/components/conversation/ConversationThread'
import { ThinkingIndicator } from '@claude-view/shared/components/conversation/ThinkingIndicator'
import { chatRegistry } from '@claude-view/shared/components/conversation/blocks/chat/registry'
import { developerRegistry } from '@claude-view/shared/components/conversation/blocks/developer/registry'
import { FindProvider } from '@claude-view/shared/contexts/FindContext'
import { ConversationActionsProvider } from '@claude-view/shared/contexts/conversation-actions-context'
import type { SessionOwnership } from '@claude-view/shared/types/generated/SessionOwnership'
import {
  ArrowLeft,
  ChevronDown,
  Download,
  FileX,
  MessageSquare,
  PanelRight
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { ExpandProvider } from '../contexts/ExpandContext'
import { ThreadHighlightProvider } from '../contexts/ThreadHighlightContext'
import { useChatPanel } from '../hooks/use-chat-panel'
import { useCommandExecutor } from '../hooks/use-command-executor'
import type { ProjectSummary } from '../hooks/use-projects'
import { useProjectSessions } from '../hooks/use-projects'
import { useRichSessionData } from '../hooks/use-rich-session-data'
import { isNotFoundError, useSession } from '../hooks/use-session'
import { useSessionDetail } from '../hooks/use-session-detail'
import { blocksToMessages } from '../lib/blocks-to-messages'
import {
  type ExportMetadata,
  downloadHtml,
  exportToPdf,
  generateStandaloneHtml,
} from '../lib/export-html'
import { downloadMarkdown, generateMarkdown } from '../lib/export-markdown'
import { isForeignSessionId } from '../lib/providers'
import { cn } from '../lib/utils'
import { useActiveSessions } from '../store/live-session-store'
import { useMonitorStore } from '../store/monitor-store'
import { CommitsPanel } from './CommitsPanel'
import { ErrorBoundary } from './ErrorBoundary'
import { FilesTouchedPanel, buildFilesTouched } from './FilesTouchedPanel'
import { EmptyState, ErrorState, Skeleton } from './LoadingStates'
import { SearchInput } from './SearchInput'
import { SessionMetricsBar } from './SessionMetricsBar'
import { DisplayModeToggle } from './live/DisplayModeToggle'
import { SessionDetailPanel } from './live/SessionDetailPanel'
import { historyToPanelData } from './live/session-panel-data'

export function ConversationView() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const { summaries } = useOutletContext<{
    summaries: ProjectSummary[]
  }>()
  const activeSessions = useActiveSessions()
  const liveSession = activeSessions.find((s) => s.id === sessionId)
  const ownership: SessionOwnership | null = liveSession?.ownership ?? null

  // Session metadata
  const { data: sessionDetail, error: detailError } = useSessionDetail(sessionId || null)
  const projectDir = sessionDetail?.project ?? ''
  const project = summaries.find((p) => p.name === projectDir)
  const projectName = project?.displayName || projectDir

  // Foreign-provider sessions (codex:…, cursor:…) have no CC JSONL: the
  // legacy /parsed endpoint (used for export + file-gone detection) does
  // not apply — blocks are the only transcript source.
  const isForeignSession = !!sessionId && isForeignSessionId(sessionId)

  // Full session for export (loads in background; CC sessions only)
  const { data: session, error: sessionError } = useSession(
    isForeignSession ? null : sessionId || null,
  )

  // Rich data + hook events for the side panel
  const { data: sessionsPage } = useProjectSessions(projectDir || undefined, { limit: 500 })
  const sessionInfo = sessionsPage?.sessions.find((s) => s.id === sessionId)
  const { data: richData } = useRichSessionData(sessionId || null)
  // FSM: single state machine replaces useConversation + TanStack chain
  const { store, dispatch, pendingCmdsRef, blocks, historyPagination, viewMode } =
    useChatPanel(sessionId)
  useCommandExecutor(store, dispatch, pendingCmdsRef)

  // Dispatch ownership so FSM transitions to cc_cli.watching when CLI-owned
  useEffect(() => {
    dispatch({ type: 'OWNERSHIP_CHANGED', tier: ownership })
  }, [ownership, dispatch])

  // Pagination: stable callback — matches ChatSession pattern
  const handleLoadOlderHistory = useCallback(() => {
    dispatch({ type: 'LOAD_OLDER_HISTORY' })
  }, [dispatch])

  // Detect missing JSONL (session in DB but file deleted). Never fires for
  // foreign sessions — they have no JSONL to lose.
  const isFileGone = !isForeignSession && !!sessionDetail && isNotFoundError(sessionError)

  // Loading: gate on sessionDetail only (blocks arrive async from new hook)
  const isLoading = isFileGone ? false : !sessionDetail && !detailError

  const displayMode = useMonitorStore((s) => s.displayMode)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  const [searchParams] = useSearchParams()

  // In-session find (Cmd+F / Ctrl+F)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const findOpenRef = useRef(findOpen)
  useEffect(() => {
    findOpenRef.current = findOpen
  }, [findOpen])

  const backUrl = useMemo(() => {
    const preserved = new URLSearchParams()
    const proj = searchParams.get('project')
    const branch = searchParams.get('branch')
    if (proj) preserved.set('project', proj)
    if (branch) preserved.set('branch', branch)
    const qs = preserved.toString()
    return qs ? `/sessions?${qs}` : '/sessions'
  }, [searchParams])

  // Export source: CC sessions use the legacy /parsed transcript; foreign
  // sessions (codex:…) have no /parsed — convert their blocks instead.
  const exportMessages = useMemo(() => {
    if (isForeignSession) return blocks.length > 0 ? blocksToMessages(blocks) : null
    return session?.messages ?? null
  }, [isForeignSession, blocks, session])

  const exportsReady = !!exportMessages

  const exportMeta: ExportMetadata | undefined = useMemo(() => {
    if (!sessionDetail) return undefined
    return {
      sessionId: sessionId || '',
      projectName,
      projectPath: sessionDetail.projectPath,
      primaryModel: sessionDetail.primaryModel,
      durationSeconds: sessionDetail.durationSeconds,
      totalInputTokens: sessionDetail.totalInputTokens,
      totalOutputTokens: sessionDetail.totalOutputTokens,
      messageCount: exportMessages?.length ?? 0,
      userPromptCount: sessionDetail.userPromptCount,
      toolCallCount: sessionDetail.toolCallCount,
      filesEditedCount: sessionDetail.filesEditedCount,
      filesReadCount: sessionDetail.filesReadCount,
      commitCount: sessionDetail.commitCount,
      gitBranch: sessionDetail.gitBranch,
      exportDate: new Date().toISOString(),
    }
  }, [sessionDetail, sessionId, projectName, exportMessages])

  const handleExportHtml = useCallback(() => {
    if (!exportMessages) return
    const html = generateStandaloneHtml(exportMessages, exportMeta)
    downloadHtml(html, `conversation-${sessionId}.html`)
  }, [exportMessages, sessionId, exportMeta])

  const handleExportPdf = useCallback(() => {
    if (!exportMessages) return
    exportToPdf(exportMessages, exportMeta)
  }, [exportMessages, exportMeta])

  const handleExportMarkdown = useCallback(() => {
    if (!exportMessages) return
    const markdown = generateMarkdown(exportMessages, projectName, sessionId)
    downloadMarkdown(markdown, `conversation-${sessionId}.md`)
  }, [exportMessages, projectName, sessionId])

  // Retained export shortcuts.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return
      if (e.key.toLowerCase() === 'e') {
        e.preventDefault()
        handleExportHtml()
      } else if (e.key.toLowerCase() === 'p') {
        e.preventDefault()
        handleExportPdf()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleExportHtml, handleExportPdf])

  // Cmd+F / Escape for find bar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        setFindOpen(true)
      }
      if (e.key === 'Escape' && findOpenRef.current) {
        setFindOpen(false)
        setFindQuery('')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Close export menu on outside click
  useEffect(() => {
    if (!exportMenuOpen) return
    function handleClick(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [exportMenuOpen])

  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 1100)

  // Side panel data
  const panelData = useMemo(() => {
    if (!sessionDetail) return undefined
    return historyToPanelData(sessionDetail, richData ?? undefined, sessionInfo)
  }, [sessionDetail, richData, sessionInfo])

  // ----- Early returns -----

  if (isLoading) {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
        <div className="flex items-center justify-between px-6 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <div className="h-5 w-32 bg-gray-200 rounded animate-pulse" />
          <div className="flex items-center gap-2">
            <div className="h-8 w-16 bg-gray-200 rounded animate-pulse" />
            <div className="h-8 w-16 bg-gray-200 rounded animate-pulse" />
          </div>
        </div>
        <div className="flex-1 p-6">
          <div className="max-w-4xl mx-auto">
            <Skeleton label="conversation" rows={4} withHeader={false} />
          </div>
        </div>
      </div>
    )
  }

  if (detailError) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <ErrorState message={detailError.message} onBack={() => navigate(backUrl)} />
      </div>
    )
  }

  if (!blocks.length && ownership === null && !sessionDetail) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <EmptyState
          icon={<MessageSquare className="w-6 h-6 text-gray-400" />}
          title="No conversation data found"
          description="This session may have been deleted or moved."
          action={{ label: 'Back to sessions', onClick: () => navigate(backUrl) }}
        />
      </div>
    )
  }

  if (isFileGone && sessionDetail) {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
        <div className="flex items-center justify-between px-6 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-4">
            <Link
              to={backUrl}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Sessions
            </Link>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">{projectName}</span>
          </div>
        </div>
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 min-w-0 flex items-center justify-center">
            <div className="text-center max-w-md px-6">
              <FileX className="w-12 h-12 text-amber-400 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                Session conversation data is no longer available
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                The JSONL file for this session has been removed from disk. Session metrics are
                still available in the sidebar.
              </p>
              <Link
                to={backUrl}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2"
              >
                Back to sessions
              </Link>
            </div>
          </div>
          <aside className="w-[300px] flex-shrink-0 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-y-auto p-4 space-y-4 hidden lg:block">
            {sessionDetail.userPromptCount > 0 && (
              <SessionMetricsBar
                prompts={sessionDetail.userPromptCount}
                filesRead={sessionDetail.filesReadCount}
                filesEdited={sessionDetail.filesEditedCount}
                reeditRate={
                  sessionDetail.filesEditedCount > 0
                    ? sessionDetail.reeditedFilesCount / sessionDetail.filesEditedCount
                    : null
                }
                commits={sessionDetail.commitCount}
                variant="vertical"
              />
            )}
            <FilesTouchedPanel
              files={buildFilesTouched(
                sessionDetail.filesRead ?? [],
                sessionDetail.filesEdited ?? [],
              )}
            />
            <CommitsPanel commits={sessionDetail.commits ?? []} />
          </aside>
        </div>
      </div>
    )
  }

  // Registry: chat bubbles (compact) vs developer terminal view
  const registry = displayMode === 'developer' ? developerRegistry : chatRegistry

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* Conversation Header */}
      <div className="flex items-center justify-between px-6 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-4">
          <Link
            to={backUrl}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Sessions
          </Link>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <span className="font-medium text-gray-900 dark:text-gray-100">{projectName}</span>
        </div>

        <div className="flex items-center gap-2">
          <DisplayModeToggle />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPanelOpen(!panelOpen)}
            aria-pressed={panelOpen}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              panelOpen
                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
            )}
            title="Toggle detail panel"
          >
            <PanelRight className="w-4 h-4" />
          </button>
          {/* Export dropdown */}
          <div className="relative" ref={exportMenuRef}>
            <button
              type="button"
              onClick={() => setExportMenuOpen(!exportMenuOpen)}
              disabled={!exportsReady}
              aria-label="Export options"
              aria-expanded={exportMenuOpen}
              aria-haspopup="menu"
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-gray-300 rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1',
                exportsReady
                  ? 'hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer'
                  : 'opacity-50 cursor-not-allowed',
              )}
            >
              <Download className="w-4 h-4" />
              <span>Export</span>
              <ChevronDown
                className={cn('w-3.5 h-3.5 transition-transform', exportMenuOpen && 'rotate-180')}
                aria-hidden="true"
              />
            </button>
            {exportMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-50 py-1">
                <button
                  type="button"
                  onClick={() => {
                    handleExportHtml()
                    setExportMenuOpen(false)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  HTML
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleExportPdf()
                    setExportMenuOpen(false)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  PDF
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleExportMarkdown()
                    setExportMenuOpen(false)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Markdown
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Two-column: Conversation + Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Conversation thread + input bar */}
        <div className="flex-1 min-w-0 flex flex-col relative">
          {/* Cmd+F find bar */}
          {findOpen && (
            <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-white/[0.06] px-4 py-2 flex-shrink-0">
              <SearchInput
                value={findQuery}
                onChange={setFindQuery}
                placeholder="Find in conversation..."
                autoFocus
                shortcutHint="Cmd+F"
                onClose={() => {
                  setFindOpen(false)
                  setFindQuery('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setFindOpen(false)
                    setFindQuery('')
                  }
                }}
              />
            </div>
          )}

          {/* Virtuoso manages its own scroll — no overflow-y-auto wrapper.
              flex-1 min-h-0 gives Virtuoso a measurable viewport height.
              Same layout pattern as ChatSession. */}
          <FindProvider value={findQuery}>
            <ThreadHighlightProvider>
              <ExpandProvider>
                <div className="flex-1 min-h-0 min-w-0 flex flex-col">
                  {blocks.length === 0 && viewMode === 'loading' ? (
                    <ThinkingIndicator phase="loading" centered />
                  ) : (
                    <ErrorBoundary>
                      <ConversationActionsProvider
                        actions={{
                          retryMessage: (localId) => dispatch({ type: 'RETRY_MESSAGE', localId }),
                          respondPermission: (rid, allowed, perms) =>
                            dispatch({
                              type: 'RESPOND_PERMISSION',
                              requestId: rid,
                              allowed,
                              updatedPermissions: perms,
                            }),
                          answerQuestion: (rid, answers) =>
                            dispatch({ type: 'ANSWER_QUESTION', requestId: rid, answers }),
                          approvePlan: (rid, approved, feedback, bypassPermissions) =>
                            dispatch({
                              type: 'APPROVE_PLAN',
                              requestId: rid,
                              approved,
                              feedback,
                              bypassPermissions,
                            }),
                          submitElicitation: (rid, response) =>
                            dispatch({ type: 'SUBMIT_ELICITATION', requestId: rid, response }),
                        }}
                      >
                        <ConversationThread
                          blocks={blocks}
                          renderers={registry}
                          onStartReached={handleLoadOlderHistory}
                          isFetchingOlder={historyPagination.isFetchingOlder}
                          hasOlderMessages={historyPagination.hasOlderMessages}
                        />
                      </ConversationActionsProvider>
                    </ErrorBoundary>
                  )}
                </div>
              </ExpandProvider>
            </ThreadHighlightProvider>
          </FindProvider>
        </div>

        {/* Right: Detail panel */}
        {panelOpen && panelData && (
          <SessionDetailPanel panelData={panelData} onClose={() => setPanelOpen(false)} inline />
        )}
      </div>
    </div>
  )
}
