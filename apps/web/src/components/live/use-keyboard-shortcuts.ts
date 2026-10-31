import { useEffect, useRef } from 'react'
import type { LiveSession } from './use-live-sessions'

interface UseKeyboardShortcutsOptions {
  sessions: LiveSession[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onExpand: (id: string) => void
  onFocusSearch: () => void
  onToggleHelp: () => void
  enabled: boolean
}

function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  return (
    tag === 'input' || tag === 'textarea' || tag === 'select' || el.hasAttribute('contenteditable')
  )
}

export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions): void {
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const opts = optionsRef.current

      if (!opts.enabled) return

      // Escape always works, even in inputs
      if (e.key === 'Escape') {
        if (opts.selectedId) {
          opts.onSelect(null)
          e.preventDefault()
        }
        return
      }

      // Skip all other shortcuts when an input is focused
      if (isInputFocused()) return

      // Ignore key events with modifier keys (Ctrl, Alt, Meta)
      if (e.ctrlKey || e.altKey || e.metaKey) return

      const key = e.key

      switch (key) {
        case 'j': {
          const sessions = opts.sessions
          if (sessions.length === 0) break
          if (opts.selectedId === null) {
            const firstId = sessions[0].id
            opts.onSelect(firstId)
            scrollSessionIntoView(firstId)
          } else {
            const currentIndex = sessions.findIndex((s) => s.id === opts.selectedId)
            const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % sessions.length
            const nextId = sessions[nextIndex].id
            opts.onSelect(nextId)
            scrollSessionIntoView(nextId)
          }
          e.preventDefault()
          break
        }

        case 'k': {
          const sessions = opts.sessions
          if (sessions.length === 0) break
          if (opts.selectedId === null) {
            const lastId = sessions[sessions.length - 1].id
            opts.onSelect(lastId)
            scrollSessionIntoView(lastId)
          } else {
            const currentIndex = sessions.findIndex((s) => s.id === opts.selectedId)
            const prevIndex =
              currentIndex === -1
                ? sessions.length - 1
                : (currentIndex - 1 + sessions.length) % sessions.length
            const prevId = sessions[prevIndex].id
            opts.onSelect(prevId)
            scrollSessionIntoView(prevId)
          }
          e.preventDefault()
          break
        }

        case 'Enter':
          if (opts.selectedId) {
            opts.onExpand(opts.selectedId)
            e.preventDefault()
          }
          break

        case '/':
          opts.onFocusSearch()
          e.preventDefault()
          break

        case '?':
          opts.onToggleHelp()
          e.preventDefault()
          break
      }
    }

    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('keydown', handler)
    }
  }, [])
}

function scrollSessionIntoView(sessionId: string): void {
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-session-id="${sessionId}"]`)
    if (el) {
      el.scrollIntoView({ block: 'nearest' })
    }
  })
}
