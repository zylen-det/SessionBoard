import { ChevronRight, Home, Monitor, Moon, PanelLeft, Search, Settings, Sun } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import type { NotificationSoundSettings } from '../hooks/use-notification-sound'
import { useTheme } from '../hooks/use-theme'
import { useAppStore } from '../store/app-store'
import { NotificationSoundPopover } from './live/NotificationSoundPopover'

interface HeaderProps {
  soundSettings: NotificationSoundSettings
  onSoundSettingsChange: (patch: Partial<NotificationSoundSettings>) => void
  onSoundPreview: () => void
  audioUnlocked: boolean
  onToggleMobileSidebar?: () => void
  mobileSidebarOpen?: boolean
}

const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor } as const

export function Header({ soundSettings, onSoundSettingsChange, onSoundPreview, audioUnlocked, onToggleMobileSidebar, mobileSidebarOpen }: HeaderProps) {
  const { pathname } = useLocation()
  const openCommandPalette = useAppStore((s) => s.openCommandPalette)
  const { theme, cycleTheme } = useTheme()
  const ThemeIcon = THEME_ICONS[theme]
  const page = pathname.startsWith('/sessions/') ? 'Session'
    : pathname === '/sessions' ? 'Sessions' : pathname === '/search' ? 'Search'
      : pathname === '/settings' ? 'Settings' : 'Board'

  return (
    <header className="app-header shrink-0 h-16 flex items-center border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-5 gap-5">
      {onToggleMobileSidebar && (
        <button type="button" onClick={onToggleMobileSidebar} aria-label={mobileSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'} aria-expanded={mobileSidebarOpen} className="shrink-0 p-2 -ml-2 rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900">
          <PanelLeft className="w-4 h-4" />
        </button>
      )}
      <Link to="/" className="flex items-center gap-2.5 shrink-0 text-zinc-900 dark:text-zinc-100 hover:opacity-80 transition-opacity">
        <Home className="w-4 h-4 text-zinc-500" />
        <span className="text-sm font-semibold">Session Board</span>
      </Link>
      <div className="hidden sm:flex items-center gap-3 text-sm min-w-0">
        <ChevronRight className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-600" />
        <span className="text-zinc-500 dark:text-zinc-400 truncate">{page}</span>
      </div>
      <nav className="ml-auto flex items-center gap-1.5" aria-label="Main actions">
        <button type="button" onClick={openCommandPalette} aria-label="Search sessions (Command K)" className="global-search flex items-center gap-2.5 w-60 mr-3 px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors">
          <Search className="w-4 h-4 shrink-0" />
          <span className="search-label">Search sessions</span>
          <kbd className="search-label ml-auto text-xs text-zinc-400 dark:text-zinc-500">⌘K</kbd>
        </button>
        <NotificationSoundPopover settings={soundSettings} onSettingsChange={onSoundSettingsChange} onPreview={onSoundPreview} audioUnlocked={audioUnlocked} />
        <button type="button" onClick={cycleTheme} aria-label={`Theme: ${theme}. Click to cycle.`} title={`Theme: ${theme}`} className="p-2 rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors">
          <ThemeIcon className="w-4 h-4" />
        </button>
        <Link to="/settings" aria-label="Settings" className="p-2 rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors">
          <Settings className="w-4 h-4" />
        </Link>
      </nav>
    </header>
  )
}
