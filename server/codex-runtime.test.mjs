import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { WebSocketServer } from 'ws'
import { CodexRuntime } from './codex-runtime.mjs'

const session = { id: 'codex:thread-a', status: 'working', lastActivityAt: 1, closedAt: null, agentState: { group: 'autonomous', state: 'acting', label: 'Working' } }
const setup = () => { const runtime = new CodexRuntime('/unused'); runtime.connected = true; runtime.entry('thread-a').turnId = 'turn-a'; return runtime }
const emit = (runtime, method, params) => runtime.handleNotification({ method, params: { threadId: 'thread-a', turnId: 'turn-a', ...params } })
const activity = (runtime) => runtime.decorate(session).runtimeActivity

test('native requests drive Need you and are scoped to their thread/turn and live connection', () => {
  const runtime = setup()
  const request = { id: 42, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-a', turnId: 'turn-a', itemId: 'tool', command: 'bun test' } }
  runtime.handleServerRequest(request)
  assert.equal(runtime.decorate(session).agentState.state, 'awaiting_approval')
  assert.equal(runtime.decorate(session).pendingInteraction.variant, 'permission')
  runtime.handleServerRequest({ ...request, id: 43, params: { ...request.params, turnId: 'old-turn' } })
  assert.equal(runtime.interactions.requests.size, 1)
  emit(runtime, 'serverRequest/resolved', { requestId: 42 })
  assert.equal(runtime.interactions.requests.size, 0)
  runtime.handleServerRequest({ ...request, method: 'item/tool/call' })
  assert.equal(runtime.interactions.requests.size, 0)
  runtime.handleServerRequest(request)
  emit(runtime, 'item/completed', { item: { id: 'tool' } })
  assert.equal(runtime.interactions.requests.size, 0)
  runtime.handleServerRequest(request)
  emit(runtime, 'turn/completed', { turn: { id: 'turn-a' } })
  assert.equal(runtime.interactions.requests.size, 0)
  assert.equal(runtime.decorate(session).agentState.state, 'idle')
})

test('recorded async questions survive active and idle daemon states, and clear on a live user prompt', () => {
  const runtime = setup()
  const waiting = { ...session, status: 'paused', pendingQuestion: { id: 'question', text: 'Continue?', requestedAt: 10 }, agentState: { group: 'needs_you', state: 'awaiting_input' } }
  assert.equal(runtime.decorate(waiting).agentState.state, 'awaiting_input')
  emit(runtime, 'turn/completed', { turn: { id: 'turn-a' } })
  const snapshot = runtime.decorateSnapshot({ sessions: [waiting], recentlyClosed: [], summary: {} })
  assert.equal(snapshot.sessions[0].agentState.state, 'awaiting_input')
  assert.equal(snapshot.summary.needsYouCount, 1)
  assert.equal(snapshot.sessions[0].runtimeActivity, null)
  emit(runtime, 'turn/started', { turn: { id: 'turn-b' } })
  emit(runtime, 'item/completed', { turnId: 'turn-b', item: { id: 'reply', type: 'userMessage' } })
  assert.equal(runtime.decorate(waiting).agentState.group, 'autonomous')
})

test('observes tool, public reasoning summary and output lifecycle; finished items are never current', () => {
  const runtime = setup()
  emit(runtime, 'item/started', { item: { id: 'tool-a', type: 'commandExecution', command: 'bun test' } })
  assert.equal(activity(runtime).kind, 'tool')
  assert.equal(activity(runtime).detail, 'Bash · bun test')
  emit(runtime, 'item/completed', { item: { id: 'tool-a', type: 'commandExecution' } })
  assert.equal(activity(runtime).kind, 'unknown')
  emit(runtime, 'item/started', { item: { id: 'reason-a', type: 'reasoning', content: ['PRIVATE RAW REASONING'], summary: [] } })
  emit(runtime, 'item/reasoning/summaryTextDelta', { itemId: 'reason-a', summaryIndex: 0, delta: 'Checking the public plan' })
  emit(runtime, 'item/reasoning/textDelta', { itemId: 'reason-a', delta: 'PRIVATE RAW REASONING' })
  assert.equal(activity(runtime).detail, 'Checking the public plan')
  assert.doesNotMatch(JSON.stringify(runtime.decorate(session)), /PRIVATE/)
  emit(runtime, 'item/completed', { item: { id: 'reason-a', type: 'reasoning' } })
  emit(runtime, 'item/agentMessage/delta', { itemId: 'message-a', delta: 'Some text' })
  assert.equal(activity(runtime).kind, 'outputting')
  emit(runtime, 'turn/completed', { turn: { id: 'turn-a', status: 'completed' } })
  assert.equal(activity(runtime), null)
  assert.equal(runtime.decorate(session).agentState.state, 'idle')
})

test('keeps concurrent tools, ignores old-turn completions and clears activity on waiting/disconnect', () => {
  const runtime = setup()
  emit(runtime, 'item/started', { item: { id: 'tool-a', type: 'commandExecution', command: 'first' } })
  emit(runtime, 'item/started', { item: { id: 'tool-b', type: 'mcpToolCall', server: 'docs', tool: 'search' } })
  emit(runtime, 'item/completed', { item: { id: 'tool-a' } })
  assert.equal(activity(runtime).detail, 'docs/search')
  emit(runtime, 'turn/completed', { turn: { id: 'old-turn' } })
  emit(runtime, 'item/completed', { turnId: 'old-turn', item: { id: 'tool-b' } })
  assert.equal(activity(runtime).detail, 'docs/search')
  emit(runtime, 'thread/status/changed', { status: { type: 'active', activeFlags: ['waitingOnApproval'] } })
  assert.equal(activity(runtime), null)
  assert.equal(runtime.decorate(session).agentState.group, 'needs_you')
  runtime.connected = false
  assert.equal(activity(runtime), null)
})

test('live turn starts move a previously closed log record into running and idle removes its active detail', () => {
  const runtime = setup()
  const closed = { ...session, status: 'done', closedAt: 10, agentState: { group: 'needs_you', state: 'task_complete' } }
  emit(runtime, 'turn/started', { turn: { id: 'turn-b' } })
  emit(runtime, 'item/started', { turnId: 'turn-b', item: { id: 'edit', type: 'fileChange', changes: [{ path: 'src/app.tsx' }] } })
  const snapshot = runtime.decorateSnapshot({ sessions: [], recentlyClosed: [closed], summary: {} })
  assert.equal(snapshot.sessions.length, 1)
  assert.equal(snapshot.recentlyClosed.length, 0)
  assert.equal(snapshot.sessions[0].runtimeActivity.detail, 'apply_patch · src/app.tsx')
  emit(runtime, 'thread/status/changed', { status: { type: 'idle' } })
  assert.equal(activity(runtime), null)
})


test('subscribes only to loaded threads, hydrates active tools, and reconnects without keeping stale activity', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'agenthud-daemon-'))
  const socketPath = path.join(home, 'observer.sock')
  const server = createServer()
  const sockets = new WebSocketServer({ server })
  let current, joins = 0, collide = false
  const requests = []
  const runtime = new CodexRuntime(home, { socketPath, reconnectMs: 20, discoveryMs: 50 })
  const waitFor = async (predicate) => {
    for (let i = 0; i < 150; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)) }
    throw new Error('Observer did not reach expected state')
  }
  sockets.on('connection', (socket) => {
    current = socket
    socket.on('message', (buffer) => {
      const request = JSON.parse(buffer)
      requests.push(request)
      if (request.id === undefined) return
      if (collide && request.method === 'thread/read') socket.send(JSON.stringify({ id: request.id, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-a', turnId: 'turn-a', itemId: 'approval-tool', command: 'bun test' } }))
      const thread = { id: 'thread-a', status: { type: 'active', activeFlags: [] } }
      let result = {}
      if (request.method === 'thread/loaded/list') result = { data: ['thread-a'], nextCursor: null }
      if (request.method === 'thread/read') result = { thread }
      if (request.method === 'thread/resume') { joins++; result = { thread, initialTurnsPage: { data: [{ id: 'turn-a', status: 'inProgress', items: [{ id: 'active-tool', type: 'commandExecution', command: 'sleep 30', status: 'inProgress' }, { id: 'old-tool', type: 'commandExecution', command: 'finished', status: 'completed' }] }] } } }
      socket.send(JSON.stringify({ id: request.id, result }))
    })
  })
  try {
    await new Promise(resolve => server.listen(socketPath, resolve))
    runtime.start()
    await waitFor(() => activity(runtime)?.kind === 'tool')
    assert.equal(activity(runtime).detail, 'Bash · sleep 30')
    assert(requests.every(request => ['initialize', 'initialized', 'thread/loaded/list', 'thread/read', 'thread/resume'].includes(request.method)))
    assert.deepEqual(requests.find(request => request.method === 'thread/resume').params, { threadId: 'thread-a', excludeTurns: true, initialTurnsPage: { limit: 1, sortDirection: 'desc', itemsView: 'full' } })
    collide = true
    const read = await runtime.request('thread/read', { threadId: 'thread-a' })
    assert.equal(read.thread.id, 'thread-a', 'A server request with the same id must not consume the pending client RPC')
    const oldRequest = runtime.interactions.view('thread-a').requestId
    collide = false
    const cleared = new Promise(resolve => { const previous = runtime.onChange; runtime.onChange = () => { previous(); if (!runtime.connected) resolve() } })
    current.terminate()
    await cleared
    assert.equal(activity(runtime), null)
    assert.equal(runtime.interactions.view('thread-a'), null)
    await assert.rejects(runtime.interactions.respond('thread-a', { requestId: oldRequest, action: 'accept' }), { status: 409 })
    await waitFor(() => joins >= 2 && activity(runtime)?.kind === 'tool')
    current.send(JSON.stringify({ method: 'item/started', params: { threadId: 'thread-a', turnId: 'turn-a', item: { id: 'reason', type: 'reasoning' } } }))
    await waitFor(() => activity(runtime)?.kind === 'reasoning')
    emit(runtime, 'thread/status/changed', { status: { type: 'notLoaded' } })
    assert.equal(runtime.decorate(session).agentState.state, 'acting')
    assert.equal(activity(runtime), null)
  } finally {
    runtime.stop()
    for (const socket of sockets.clients) socket.terminate()
    await new Promise(resolve => sockets.close(resolve))
    await new Promise(resolve => server.close(resolve))
    await rm(home, { recursive: true, force: true })
  }
})


test('runtime tools and deltas never bump prompt time; a new user item bumps it only once', () => {
  const runtime = setup()
  const row = { ...session, lastUserMessageAt: 7 }
  emit(runtime, 'item/started', { item: { id: 'tool', type: 'commandExecution', command: 'bun test' } })
  assert.equal(runtime.decorate(row).lastUserMessageAt, 7)
  emit(runtime, 'item/completed', { item: { id: 'new-user', type: 'userMessage' } })
  const promptAt = runtime.decorate(row).lastUserMessageAt
  assert(promptAt > 7)
  emit(runtime, 'item/agentMessage/delta', { itemId: 'text', delta: 'Working' })
  assert.equal(runtime.decorate(row).lastUserMessageAt, promptAt)
})
