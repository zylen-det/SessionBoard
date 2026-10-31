import path from 'node:path'
import WebSocket from 'ws'

const clean = (value, limit = 200) => Array.from(String(value ?? '').replace(/\s+/g, ' ').trim()).slice(0, limit).join('')
const toolTypes = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'collabToolCall', 'webSearch', 'imageView', 'contextCompaction'])

function activityFor(item) {
  if (item.type === 'reasoning') return { kind: 'reasoning', detail: clean((item.summary ?? []).join(' ')) }
  if (item.type === 'agentMessage') return { kind: 'outputting', detail: '' }
  if (!toolTypes.has(item.type)) return null
  const details = {
    commandExecution: () => `Bash · ${item.command ?? ''}`,
    fileChange: () => `apply_patch${item.changes?.[0]?.path ? ` · ${item.changes[0].path}` : ''}`,
    mcpToolCall: () => `${item.server}/${item.tool}`,
    dynamicToolCall: () => item.tool,
    collabToolCall: () => item.tool,
    webSearch: () => `web_search${item.query ? ` · ${item.query}` : ''}`,
    imageView: () => `view_image${item.path ? ` · ${item.path}` : ''}`,
    contextCompaction: () => 'context_compaction',
  }
  return { kind: 'tool', detail: clean(details[item.type]()) }
}

/** Observe already-loaded daemon threads. Never start turns or answer server requests. */
export class CodexRuntime {
  constructor(home, { socketPath = process.env.AGENTHUD_CODEX_SOCKET || path.join(home, 'app-server-control', 'app-server-control.sock'), onChange = () => {}, discoveryMs = 2000, reconnectMs = 2000 } = {}) {
    this.socketPath = socketPath
    this.onChange = onChange
    this.discoveryMs = discoveryMs
    this.reconnectMs = reconnectMs
    this.threads = new Map()
    this.pending = new Map()
    this.sequence = 0
    this.connected = false
    this.stopped = true
  }

  start() { if (!this.stopped) return; this.stopped = false; this.connect() }

  connect() {
    if (this.stopped) return
    const socket = new WebSocket(`ws+unix://${this.socketPath}:/`, { perMessageDeflate: false, maxPayload: 32 * 1024 * 1024, handshakeTimeout: 5000 })
    this.socket = socket
    socket.on('error', () => socket.terminate())
    socket.on('close', () => {
      this.connected = false
      clearInterval(this.discoveryTimer)
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Codex observer disconnected')) }
      this.pending.clear()
      this.threads.clear()
      this.onChange()
      if (!this.stopped) { this.retryTimer = setTimeout(() => this.connect(), this.reconnectMs); this.retryTimer.unref() }
    })
    socket.on('message', (buffer) => {
      let message
      try { message = JSON.parse(buffer.toString()) } catch { return }
      const pending = this.pending.get(message.id)
      if (pending) {
        this.pending.delete(message.id); clearTimeout(pending.timer)
        if (message.error) pending.reject(new Error(message.error.message ?? 'Codex request failed'))
        else pending.resolve(message.result)
      } else if (message.id === undefined) this.handleNotification(message)
      // Approval and tool requests belong to the original Codex client.
    })
    socket.on('open', async () => {
      try {
        await this.request('initialize', {
          clientInfo: { name: 'agenthud-observer', version: '0.1.0' },
          capabilities: {
            experimentalApi: true,
            optOutNotificationMethods: ['rawResponseItem/completed', 'rawResponse/completed', 'item/reasoning/textDelta', 'item/commandExecution/outputDelta', 'item/fileChange/outputDelta'],
          },
        })
        socket.send(JSON.stringify({ method: 'initialized' }))
        this.connected = true
        await this.discover()
        if (this.connected && !this.stopped) { this.discoveryTimer = setInterval(() => this.discover().catch(() => {}), this.discoveryMs); this.discoveryTimer.unref() }
      } catch { socket.terminate() }
    })
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      if (this.socket?.readyState !== WebSocket.OPEN) return reject(new Error('Codex observer not connected'))
      const id = ++this.sequence
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} timed out`)) }, 8000)
      timer.unref()
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async discover() {
    if (this.discovering) return
    this.discovering = true
    try {
      const loaded = new Set()
      let cursor
      do {
        const page = await this.request('thread/loaded/list', { limit: 100, ...(cursor ? { cursor } : {}) })
        for (const id of page.data) loaded.add(id)
        cursor = page.nextCursor
      } while (cursor && loaded.size < 1000)
      for (const id of this.threads.keys()) if (!loaded.has(id)) this.threads.delete(id)
      for (const id of loaded) {
        if (this.threads.get(id)?.subscribed) continue
        // Only join threads already loaded by the user's client, with no overrides.
        try {
          const { thread } = await this.request('thread/read', { threadId: id, includeTurns: false })
          if (!['active', 'idle'].includes(thread.status?.type)) continue
          const entry = this.entry(id)
          entry.status = thread.status
          const version = entry.version
          const resumed = await this.request('thread/resume', { threadId: id, excludeTurns: true, initialTurnsPage: { limit: 1, sortDirection: 'desc', itemsView: 'full' } })
          entry.subscribed = true
          if (this.threads.get(id) !== entry || entry.version !== version) continue
          entry.status = resumed.thread.status
          const turn = resumed.initialTurnsPage?.data?.find((turn) => turn.status === 'inProgress')
          entry.turnId = turn?.id ?? null
          // Completed messages/reasoning have no active status; never infer them as current.
          for (const item of turn?.items ?? []) if (item.status === 'inProgress') this.setItem(entry, item)
        } catch { this.threads.delete(id) }
      }
      this.onChange()
    } finally { this.discovering = false }
  }

  entry(id) {
    if (!this.threads.has(id)) this.threads.set(id, { status: { type: 'active', activeFlags: [] }, items: new Map(), updatedAt: 0, version: 0, turnId: null, subscribed: false })
    return this.threads.get(id)
  }

  setItem(entry, item) {
    const activity = activityFor(item)
    if (!activity || !item.id) return
    entry.items.delete(item.id)
    entry.items.set(item.id, { ...activity, summaryIndex: null })
  }

  handleNotification({ method, params: p }) {
    if (!p?.threadId) return
    if (method === 'thread/closed' || method === 'thread/archived' || method === 'thread/deleted') { this.threads.delete(p.threadId); this.onChange(); return }
    const relevant = ['thread/status/changed', 'turn/started', 'turn/completed', 'item/started', 'item/completed', 'item/agentMessage/delta', 'item/reasoning/summaryTextDelta', 'item/reasoning/summaryPartAdded']
    if (!relevant.includes(method)) return
    const entry = this.entry(p.threadId)
    if (method === 'thread/status/changed') {
      entry.status = p.status
      if (p.status?.type !== 'active') { entry.items.clear(); entry.turnId = null }
    } else if (method === 'turn/started') {
      entry.status = { type: 'active', activeFlags: [] }; entry.items.clear(); entry.turnId = p.turn?.id ?? null
    } else if (method === 'turn/completed') {
      if (entry.turnId && p.turn?.id !== entry.turnId) return
      entry.status = { type: 'idle' }; entry.items.clear(); entry.turnId = null
    } else {
      if (entry.turnId && p.turnId && entry.turnId !== p.turnId) return
      if (p.turnId) entry.turnId = p.turnId
      if (entry.status.type !== 'active') return
      if (['item/started', 'item/completed'].includes(method) && p.item?.type === 'userMessage' && entry.promptItemId !== p.item.id) {
        entry.promptItemId = p.item.id
        entry.lastUserMessageAt = Date.now() / 1000
      }
      if (method === 'item/started') this.setItem(entry, p.item ?? {})
      if (method === 'item/completed') entry.items.delete(p.item?.id)
      if (method === 'item/agentMessage/delta' && p.itemId) {
        entry.items.delete(p.itemId)
        entry.items.set(p.itemId, { kind: 'outputting', detail: '' })
      }
      if (method.startsWith('item/reasoning/') && p.itemId) {
        const previous = entry.items.get(p.itemId)
        const samePart = previous?.summaryIndex === p.summaryIndex
        const summaryText = method.endsWith('summaryPartAdded') ? '' : `${samePart ? previous?.summaryText ?? previous?.detail ?? '' : ''}${p.delta ?? ''}`.slice(0, 1000)
        entry.items.delete(p.itemId)
        entry.items.set(p.itemId, { kind: 'reasoning', detail: clean(summaryText), summaryText, summaryIndex: p.summaryIndex })
      }
    }
    entry.updatedAt = Date.now() / 1000; entry.version++
    this.onChange()
  }

  decorate(session) {
    if (!this.connected) return { ...session, runtimeActivity: null }
    const entry = this.threads.get(session.id.replace(/^codex:/, ''))
    if (!entry) return { ...session, runtimeActivity: null }
    if (!['active', 'idle'].includes(entry.status.type)) return { ...session, runtimeActivity: null }
    const lastActivityAt = Math.max(session.lastActivityAt, entry.updatedAt)
    const lastUserMessageAt = Math.max(session.lastUserMessageAt ?? 0, entry.lastUserMessageAt ?? 0) || null
    if (entry.status.type === 'active') {
      const waiting = entry.status.activeFlags?.some((flag) => ['waitingOnApproval', 'waitingOnUserInput'].includes(flag))
      const activity = [...entry.items.values()].at(-1) ?? { kind: 'unknown', detail: '' }
      return {
        ...session, lastActivityAt, lastUserMessageAt, status: waiting ? 'paused' : 'working', closedAt: null,
        agentState: { ...session.agentState, group: waiting ? 'needs_you' : 'autonomous', state: waiting ? 'awaiting_input' : 'acting', label: waiting ? 'Waiting for input' : 'Running' },
        runtimeActivity: waiting ? null : { kind: activity.kind, detail: activity.detail, updatedAt: entry.updatedAt, source: 'app-server' },
      }
    }
    return { ...session, lastActivityAt, lastUserMessageAt, status: session.status === 'done' ? 'done' : 'paused', agentState: { ...session.agentState, group: 'needs_you', state: 'idle', label: 'Idle' }, runtimeActivity: null }
  }

  decorateSnapshot(snapshot) {
    const rows = [...snapshot.sessions, ...snapshot.recentlyClosed].map((session) => this.decorate(session))
    const sessions = rows.filter((session) => session.status !== 'done')
    const recentlyClosed = rows.filter((session) => session.status === 'done')
    return { ...snapshot, sessions, recentlyClosed, summary: { ...snapshot.summary, needsYouCount: sessions.filter((s) => s.agentState.group === 'needs_you' && s.agentState.state !== 'idle').length, autonomousCount: sessions.filter((s) => s.agentState.group === 'autonomous').length } }
  }

  stop() {
    this.stopped = true
    clearTimeout(this.retryTimer); clearInterval(this.discoveryTimer)
    this.socket?.terminate()
    this.connected = false
    this.threads.clear()
  }
}
