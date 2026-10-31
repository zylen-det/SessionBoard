import { Command } from 'lucide-react'

interface KeyCombo {
  mod?: boolean // Cmd on Mac
  ctrl?: boolean // Ctrl
  shift?: boolean
  key: string
}

interface ShortcutDef {
  keys: KeyCombo[]
  label: string
  separator?: string // e.g. "/" to show "j / k"
}

function ShortcutKbd({ combo }: { combo: KeyCombo }) {
  return (
    <kbd className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-mono bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-gray-700 dark:text-gray-300">
      {combo.mod && <Command className="w-3 h-3" />}
      {combo.ctrl && <span className="text-[10px]">Ctrl</span>}
      {combo.shift && <span className="text-[10px]">Shift</span>}
      {combo.key}
    </kbd>
  )
}

function ShortcutGroup({ title, shortcuts }: { title: string; shortcuts: ShortcutDef[] }) {
  return (
    <div>
      <h4 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
        {title}
      </h4>
      <div className="space-y-1.5">
        {shortcuts.map((s) => (
          <div key={s.label} className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              {s.keys.map((combo, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  {i > 0 && s.separator && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 mx-0.5">
                      {s.separator}
                    </span>
                  )}
                  <ShortcutKbd combo={combo} />
                </span>
              ))}
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function SettingsPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-6">Settings</h1>
      <div id="keyboard-shortcuts" className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-5 space-y-5 scroll-mt-6">
        <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">Keyboard Shortcuts</h2>
        <ShortcutGroup title="Global" shortcuts={[
          { keys: [{ mod: true, key: 'K' }], label: 'Command palette' },
          { keys: [{ mod: true, key: 'B' }], label: 'Toggle sidebar' },
        ]} />
        <ShortcutGroup title="Conversation" shortcuts={[
          { keys: [{ mod: true, key: 'F' }], label: 'Find in conversation' },
          { keys: [{ mod: true, shift: true, key: 'E' }], label: 'Export HTML' },
          { keys: [{ mod: true, shift: true, key: 'P' }], label: 'Export PDF' },
        ]} />
        <ShortcutGroup title="Live Monitor" shortcuts={[
          { keys: [{ key: 'j' }, { key: 'k' }], label: 'Next / previous session', separator: '/' },
          { keys: [{ key: 'Enter' }], label: 'Open selected session' },
          { keys: [{ key: 'Escape' }], label: 'Deselect' },
          { keys: [{ key: '/' }], label: 'Search' },
          { keys: [{ key: '?' }], label: 'Show all shortcuts' },
        ]} />
      </div>
    </div>
  )
}
