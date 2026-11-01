import { mockApi } from './api'
import { closedSessions, conversation, demoRuntimeActivity, liveSessions, summarize } from './data'

// Install before React mounts. Static production builds use the same mock layer.
const realFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.origin)
  if (!url.pathname.startsWith('/api/')) return realFetch(input, init)
  const request = input instanceof Request ? input : null
  const body = typeof init?.body === 'string' ? init.body : request ? await request.clone().text() : undefined
  await new Promise(resolve => setTimeout(resolve, 80))
  return mockApi(url, init?.method ?? request?.method ?? 'GET', body)
}

class DemoEventSource extends EventTarget {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2
  CONNECTING = 0
  OPEN = 1
  CLOSED = 2
  readyState = 0
  withCredentials = false
  url: string
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  private timer?: ReturnType<typeof setInterval>
  constructor(url: string | URL) {
    super()
    this.url = String(url)
    setTimeout(() => {
      if (this.readyState === 2) return
      this.readyState = 1
      const event = new Event('open')
      this.dispatchEvent(event); this.onopen?.(event)
      if (this.url.includes('/live/stream')) {
        this.emit('snapshot', { summary: summarize(), sessions: liveSessions, recentlyClosed: closedSessions })
        let step = 0
        this.timer = setInterval(() => {
          step++
          liveSessions.forEach((session, i) => {
            if (session.agentState.group !== 'autonomous') return
            const updated = {
              ...session,
              runtimeActivity: demoRuntimeActivity(i - 3 + step),
              lastActivityAt: Math.floor(Date.now() / 1000),
              tokens: { ...session.tokens, outputTokens: session.tokens.outputTokens + 48, totalTokens: session.tokens.totalTokens + 48 },
            }
            liveSessions[i] = updated
            this.emit('session_upsert', { session: updated })
          })
        }, 4000)
      } else if (this.url.includes('/indexing/')) {
        this.emit('done', { indexed: 84, total: 84, bytes_processed: 48000000, bytes_total: 48000000 })
      } else if (this.url.includes('/monitor/stream')) {
        const snapshot = () => ({ timestamp: Date.now() / 1000, cpuPercent: 22 + Math.sin(Date.now() / 5000) * 8, memoryUsedBytes: 10737418240, memoryTotalBytes: 34359738368, diskUsedBytes: 180000000000, diskTotalBytes: 512000000000, topProcesses: [{ name: 'Claude Code (mock)', processCount: 8, cpuPercent: 18, memoryBytes: 2147483648 }], sessionResources: liveSessions.map(s => ({ sessionId: s.id, pid: s.pid, cpuPercent: 2.3, memoryBytes: 268435456 })) })
        this.emit('init', { systemInfo: { hostname: 'demo-workstation', os: 'Linux', osVersion: 'Demo', arch: 'x86_64', cpuCoreCount: 12, totalMemoryBytes: 34359738368 }, snapshot: snapshot(), oracleAgeSecs: 0 })
        this.timer = setInterval(() => this.emit('snapshot', snapshot()), 2000)
      }
    }, 50)
  }
  private emit(type: string, data: unknown) {
    if (this.readyState !== 1) return
    const event = new MessageEvent(type, { data: JSON.stringify(data) })
    this.dispatchEvent(event)
    if (type === 'message') this.onmessage?.(event)
  }
  close() { this.readyState = 2; clearInterval(this.timer) }
}
window.EventSource = DemoEventSource as unknown as typeof EventSource

// Preserve Vite's HMR socket; only intercept the application's session channels.
const NativeWebSocket = window.WebSocket
class DemoSocket extends EventTarget {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
  CONNECTING = 0; OPEN = 1; CLOSING = 2; CLOSED = 3
  readyState = 0
  url: string
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  constructor(url: string | URL, protocols?: string | string[]) {
    super()
    this.url = String(url)
    if (!this.url.includes('/api/') && !this.url.includes('/ws/')) return new NativeWebSocket(url, protocols) as unknown as DemoSocket
    setTimeout(() => { if (this.readyState !== 3) { this.readyState = 1; const e = new Event('open'); this.dispatchEvent(e); this.onopen?.(e) } }, 50)
  }
  send(data: string) {
    const message = JSON.parse(data)
    const id = this.url.match(/sessions\/([^/]+)/)?.[1] ?? 'demo-session-001'
    if (message.modes) {
      this.emit({ frame: 'handshake_ack', session_id: id, modes: message.modes })
      for (const block of conversation(id)) this.emit({ frame: 'block_delta', ...block })
      this.emit({ frame: 'block_buffer_end' })
      this.emit({ frame: 'terminal_buffer_end' })
    }
  }
  private emit(data: unknown) { if (this.readyState === 1) { const e = new MessageEvent('message', { data: JSON.stringify(data) }); this.dispatchEvent(e); this.onmessage?.(e) } }
  close() { this.readyState = 3 }
}
window.WebSocket = DemoSocket as unknown as typeof WebSocket
