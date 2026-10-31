import { useEffect, useReducer, useRef } from 'react'
import { normalizeBlocks } from '@claude-view/shared/utils/normalize-block'
import { runtimeInfo } from '../lib/runtime'
import {
  type ChatPanelStore,
  type Command,
  type RawEvent,
  coordinate,
  deriveBlocks,
  deriveCanFork,
  deriveCanSend,
  deriveConnectionStatus,
  deriveHistoryPagination,
  deriveInputBar,
  deriveThinkingState,
  deriveViewMode,
} from '../lib/chat-panel'

const initialStore: ChatPanelStore = {
  panel: { phase: 'empty' },
  outbox: { messages: [] },
  meta: null,
  projectPath: null,
  lastModel: null,
  lastPermissionMode: null,
  historyPagination: null,
}

/** E-B1: pendingCmdsRef ACCUMULATES via push; drain effect splices.
 *  StrictMode guard: React calls reducer twice with the same event ref — skip duplicate push. */
export function useChatPanel(sessionId: string | undefined, projectPath?: string) {
  const pendingCmdsRef = useRef<Command[]>([])
  const lastEventRef = useRef<RawEvent | null>(null)

  function reducer(state: ChatPanelStore, event: RawEvent): ChatPanelStore {
    const [newState, cmds] = coordinate(state, event)
    // Push only once per event: StrictMode calls reducer twice with the same reference.
    // Different dispatches in the same batch use different event objects → both push.
    if (cmds.length > 0 && event !== lastEventRef.current) {
      pendingCmdsRef.current.push(...cmds)
      lastEventRef.current = event
    }
    return newState
  }

  const [store, dispatch] = useReducer(reducer, initialStore)
  const latestStore = useRef(store)
  latestStore.current = store

  useEffect(() => {
    if (runtimeInfo.mode !== 'codex' || !sessionId?.startsWith('codex:')) return
    let stopped = false
    let busy = false
    const controller = new AbortController()
    const timer = setInterval(async () => {
      const state = latestStore.current
      if (busy || state.panel.phase !== 'nobody' || state.panel.sub.sub !== 'ready' || state.historyPagination?.fetchingOlder) return
      busy = true
      const offset = state.historyPagination?.offset ?? 0
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages?format=block&offset=${offset}&limit=5000`, { signal: controller.signal })
        if (!response.ok) return
        const data = await response.json()
        if (!stopped) dispatch({ type: 'HISTORY_OK', blocks: normalizeBlocks(data.blocks ?? []), total: data.total, offset })
      } catch { /* Keep the last known transcript during a temporary read failure. */ }
      finally { busy = false }
    }, 3000)
    return () => { stopped = true; controller.abort(); clearInterval(timer) }
  }, [sessionId])

  // Derived state
  const blocks = deriveBlocks(store)
  const canSend = deriveCanSend(store)
  const canFork = deriveCanFork(store)
  const inputBar = deriveInputBar(store)
  const viewMode = deriveViewMode(store)
  const connectionStatus = deriveConnectionStatus(store)
  const thinkingState = deriveThinkingState(store)
  const historyPagination = deriveHistoryPagination(store)

  // E-m3: Guard SELECT_SESSION re-dispatch
  // biome-ignore lint/correctness/useExhaustiveDependencies: projectPath and store.panel.phase intentionally excluded — only re-dispatch on sessionId change
  useEffect(() => {
    if (sessionId) {
      if (
        store.panel.phase === 'empty' ||
        ('sessionId' in store.panel && store.panel.sessionId !== sessionId)
      ) {
        dispatch({ type: 'SELECT_SESSION', sessionId, projectPath })
      }
    } else {
      dispatch({ type: 'DESELECT' })
    }
  }, [sessionId])

  return {
    store,
    dispatch,
    pendingCmdsRef,
    blocks,
    canSend,
    canFork,
    inputBar,
    viewMode,
    connectionStatus,
    thinkingState,
    historyPagination,
  }
}
