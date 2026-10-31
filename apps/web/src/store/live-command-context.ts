import { create } from 'zustand'
import type { LiveSession } from '../components/live/use-live-sessions'

export interface LiveCommandContext {
  sessions: LiveSession[]
  onFilterStatus: (statuses: string[]) => void
  onClearFilters: () => void
  onSelectSession: (id: string) => void
  onToggleHelp: () => void
}

interface LiveCommandStore {
  context: LiveCommandContext | null
  setContext: (context: LiveCommandContext | null) => void
}

export const useLiveCommandStore = create<LiveCommandStore>((set) => ({
  context: null,
  setContext: (context) => set({ context }),
}))
