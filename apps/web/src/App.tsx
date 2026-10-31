import { type CodeRenderContextValue, CodeRenderProvider } from '@claude-view/shared'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { CodeBlock } from './components/CodeBlock'
import { ColdStartOverlay } from './components/ColdStartOverlay'
import { CommandPalette } from './components/CommandPalette'
import { Header } from './components/Header'
import { ErrorState, LiveMonitorSkeleton } from './components/LoadingStates'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { CompactCodeBlock } from './components/live/CompactCodeBlock'
import { useLiveSSE } from './components/live/use-live-sessions'
import { useIndexingProgress } from './hooks/use-indexing-progress'
import { useJourneyTelemetry } from './hooks/use-journey-telemetry'
import { useIsMobile } from './hooks/use-media-query'
import { useNotificationSound } from './hooks/use-notification-sound'
import { usePatternAlert } from './hooks/use-pattern-alert'
import { useProjectSummaries } from './hooks/use-projects'
import { useTheme } from './hooks/use-theme'
import { useAppStore } from './store/app-store'
import { useLiveCommandStore } from './store/live-command-context'
import { useActiveSessions, useIsLiveInitialized } from './store/live-session-store'

export default function App() {
  const isMobile = useIsMobile()
  const location = useLocation()
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const { data: summaries, isLoading, error, refetch } = useProjectSummaries()
  const {
    isCommandPaletteOpen,
    openCommandPalette,
    closeCommandPalette,
    sidebarCollapsed,
    toggleSidebar,
  } = useAppStore()
  useTheme() // Apply dark class to <html>
  useJourneyTelemetry() // anonymous feature_opened + journey (server-gated)
  const indexingProgress = useIndexingProgress()
  useLiveSSE() // SSE transport — pushes events into zustand store
  const activeSessions = useActiveSessions()
  const liveInitialized = useIsLiveInitialized()
  const {
    settings: soundSettings,
    updateSettings: updateSoundSettings,
    previewSound,
    audioUnlocked,
  } = useNotificationSound(activeSessions, { initialized: liveInitialized })
  const liveContext = useLiveCommandStore((s) => s.context)
  usePatternAlert()

  const handleToggleSidebar = useCallback(() => {
    if (isMobile) setMobileSidebarOpen((open) => !open)
    else toggleSidebar()
  }, [isMobile, toggleSidebar])

  useEffect(() => {
    setMobileSidebarOpen(false)
  }, [location.pathname, location.search, isMobile])

  // Provide shiki-based code renderers to shared components via context
  const codeRenderValue = useMemo<CodeRenderContextValue>(
    () => ({ CodeBlock, CompactCodeBlock }),
    [],
  )

  // Global keyboard shortcut: Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        openCommandPalette()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        handleToggleSidebar()
      }
      if (e.key === 'Escape' && !isCommandPaletteOpen) setMobileSidebarOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openCommandPalette, handleToggleSidebar, isCommandPaletteOpen])

  // Loading state - show live monitor skeleton (home page is mission control)
  if (isLoading) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: role="status" is the right
      // ARIA pattern for a full-page loading live-region announcement. <output>
      // is for form computation results and would be semantically wrong here.
      <div
        className="min-h-screen bg-gray-50 dark:bg-gray-950"
        role="status"
        aria-busy="true"
        aria-label="Loading application"
      >
        <div className="h-14 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 animate-pulse" />
        <LiveMonitorSkeleton />
      </div>
    )
  }

  // Error state with retry button
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <ErrorState message={error.message} onRetry={() => refetch()} />
      </div>
    )
  }

  return (
    <CodeRenderProvider value={codeRenderValue}>
      <div className="h-screen flex flex-col bg-white dark:bg-gray-950">
        <a href="#main" className="skip-to-content">
          Skip to content
        </a>
        <Header
          soundSettings={soundSettings}
          onSoundSettingsChange={updateSoundSettings}
          onSoundPreview={previewSound}
          audioUnlocked={audioUnlocked}
          onToggleMobileSidebar={isMobile ? handleToggleSidebar : undefined}
          mobileSidebarOpen={mobileSidebarOpen}
        />
        <ColdStartOverlay progress={indexingProgress} />

        <div className="flex-1 flex overflow-hidden">
          {!isMobile && <Sidebar projects={summaries ?? []} collapsed={sidebarCollapsed} />}
          {isMobile && mobileSidebarOpen && (
            <>
              <button type="button" className="mobile-sidebar-backdrop fixed inset-x-0 bottom-9 z-30 bg-black/40" aria-label="Close sidebar" onClick={() => setMobileSidebarOpen(false)} />
              <div className="mobile-sidebar-drawer fixed left-0 bottom-9 z-40 flex">
                <Sidebar projects={summaries ?? []} onToggle={handleToggleSidebar} />
              </div>
            </>
          )}

          <main id="main" className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
            <Outlet context={{ summaries: summaries ?? [], indexingProgress }} />
          </main>
        </div>

        <StatusBar projects={summaries ?? []} />

        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onClose={closeCommandPalette}
          projects={summaries ?? []}
          liveContext={liveContext ?? undefined}
        />
      </div>
    </CodeRenderProvider>
  )
}
