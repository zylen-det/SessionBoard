import { createHash } from 'node:crypto'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const HEAD_BYTES = 128 * 1024
const TAIL_BYTES = 256 * 1024
const MAX_DETAIL_BYTES = 64 * 1024 * 1024
const seconds = (value) => typeof value === 'number' ? (value > 1e12 ? value / 1000 : value) : Date.parse(value ?? '') / 1000 || 0
const textOf = (content) => typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => part.text ?? '').filter(Boolean).join('\n') : ''
const short = (value, max = 240) => String(value ?? '').trim().slice(0, max)
const json = (value) => { try { return typeof value === 'string' ? JSON.parse(value) : value ?? {} } catch { return {} } }
const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16)

export function recordsFrom(text) {
  return text.split('\n').flatMap((line) => {
    try { const row = JSON.parse(line); return row && typeof row === 'object' ? [row] : [] } catch { return [] }
  })
}

function isUserText(text) {
  return Boolean(text.trim()) && !/^\s*(?:#\s*AGENTS\.md instructions|<environment_context>|<INSTRUCTIONS>|<permissions instructions>)/i.test(text)
}

/** Parse recorded public messages and tool results. Never expose reasoning or system instructions. */
export function parseRollout(records, { filePath = '', mtime = 0, size = 0, title = '', now = Date.now() / 1000 } = {}) {
  const meta = records.find((row) => row.type === 'session_meta')?.payload ?? {}
  const id = meta.id ?? path.basename(filePath).match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0]
  if (!id) return null
  const nativeMessages = records.some((row) => row.type === 'event_msg' && row.payload?.type === 'item_completed' && ['UserMessage', 'AgentMessage'].includes(row.payload.item?.type))
  const responseMessages = records.some((row) => row.type === 'response_item' && row.payload?.type === 'message' && ['user', 'assistant'].includes(row.payload.role))
  const nativeTools = records.some((row) => row.type === 'event_msg' && row.payload?.type === 'item_completed' && ['CommandExecution', 'FileChange'].includes(row.payload.item?.type))
  const data = {
    rawId: id, id: `codex:${id}`, filePath, size, mtime, meta,
    cwd: meta.cwd ?? null, branch: meta.git?.branch ?? null, model: null,
    firstAt: seconds(meta.timestamp) || seconds(records[0]?.timestamp) || mtime,
    lastAt: 0, phase: 'idle', turnStartedAt: null, turnEndedAt: null,
    firstUser: '', lastUser: '', lastUserAt: null, lastAssistant: '', activity: '', plan: [], planText: '',
    blocks: [], filesEdited: new Set(), toolCount: 0, promptCount: 0,
    contextWindowTokens: null, contextWindowSize: null,
    tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hrTokens: 0, totalTokens: 0 },
  }
  const seen = new Set()
  const calls = new Map()
  function addMessage(role, text, timestamp, itemId) {
    if (!text || (role === 'user' && !isUserText(text))) return
    const key = itemId ?? hash(`${role}:${timestamp}:${text}`)
    if (seen.has(key)) return
    seen.add(key)
    if (role === 'user') {
      data.firstUser ||= text; data.lastUser = text; data.lastUserAt = timestamp; data.promptCount++
      data.blocks.push({ type: 'user', id: `${id}:${key}`, text, timestamp, status: 'sent' })
    } else {
      data.lastAssistant = text
      data.activity = short(text.split('\n').find((line) => line.trim()) ?? text)
      data.blocks.push({ type: 'assistant', id: `${id}:${key}`, timestamp, streaming: false, segments: [{ kind: 'text', text }] })
    }
  }
  function applyPlan(args) {
    if (Array.isArray(args.plan)) data.plan = args.plan.filter((step) => step && typeof step.step === 'string').map((step, i) => ({ id: String(i + 1), title: step.step, status: ['completed', 'in_progress'].includes(step.status) ? step.status : 'pending', source: 'task', description: args.explanation ?? null }))
  }
  function addTool(itemId, name, input, output, timestamp, status = 'complete', isError = false) {
    if (seen.has(`tool:${itemId}`)) return
    seen.add(`tool:${itemId}`); data.toolCount++
    data.activity = short(input.command ? `${name}: ${Array.isArray(input.command) ? input.command.join(' ') : input.command}` : input.file_path ? `${name}: ${input.file_path}` : name)
    const execution = { toolName: name, toolUseId: itemId, toolInput: input, status, category: 'builtin' }
    if (output !== undefined) execution.result = { output: short(typeof output === 'string' ? output : JSON.stringify(output), 12000), isError, isReplay: true }
    data.blocks.push({ type: 'assistant', id: `${id}:tool:${itemId}`, timestamp, streaming: false, segments: [{ kind: 'tool', execution }] })
  }
  for (const row of records) {
    if (row.type === 'agenthud_gap') {
      // A bounded preview omitted the middle of the rollout. Earlier terminal
      // markers cannot establish the state of a later, unseen turn.
      data.phase = 'unknown'; data.turnStartedAt = null; data.turnEndedAt = null; data.plan = []; data.planText = ''
      continue
    }
    const p = row.payload
    if (!p || typeof p !== 'object') continue
    const timestamp = seconds(row.timestamp) || data.lastAt || data.firstAt
    data.lastAt = Math.max(data.lastAt, timestamp)
    if (row.type === 'turn_context') { data.model = p.model ?? data.model; data.cwd = p.cwd ?? data.cwd }
    if (row.type === 'event_msg') {
      if (p.type === 'task_started' || p.type === 'turn_started') { data.phase = 'working'; data.turnStartedAt = seconds(p.started_at) || timestamp; data.turnEndedAt = null }
      if (p.type === 'task_complete' || p.type === 'task_completed') { data.phase = 'completed'; data.turnEndedAt = seconds(p.completed_at) || timestamp; data.lastAssistant = p.last_agent_message ?? data.lastAssistant }
      if (p.type === 'turn_aborted' || p.type === 'task_aborted') { data.phase = 'interrupted'; data.turnEndedAt = timestamp }
      if (p.type === 'task_failed' || p.type === 'turn_failed') { data.phase = 'error'; data.activity = short(p.message ?? p.error ?? 'Turn failed') }
      if (p.type === 'request_user_input' || p.type === 'approval_required') { data.phase = 'waiting'; data.activity = short(p.message ?? 'Input requested in Codex') }
      if (p.type === 'token_count' && p.info) {
        const t = p.info.total_token_usage
        if (t) data.tokens = { ...data.tokens, inputTokens: t.input_tokens ?? 0, outputTokens: t.output_tokens ?? 0, cacheReadTokens: t.cached_input_tokens ?? 0, totalTokens: t.total_tokens ?? 0 }
        const used = p.info.last_token_usage?.total_tokens
        const limit = p.info.model_context_window
        if (Number.isFinite(used) && used >= 0) data.contextWindowTokens = used
        if (Number.isFinite(limit) && limit > 0) data.contextWindowSize = limit
      }
      if (!nativeMessages && !responseMessages && p.type === 'user_message') addMessage('user', p.message ?? '', timestamp)
      if (!nativeMessages && !responseMessages && p.type === 'agent_message') addMessage('assistant', p.message ?? '', timestamp)
      if (p.type === 'item_completed') {
        const item = p.item ?? {}, kind = item.type
        if (kind === 'UserMessage') addMessage('user', textOf(item.content), timestamp, item.id)
        if (kind === 'AgentMessage' && !['analysis', 'Analysis', 'reasoning', 'Reasoning'].includes(item.phase)) addMessage('assistant', textOf(item.content), timestamp, item.id)
        if (kind === 'CommandExecution') addTool(item.id, 'Bash', { command: Array.isArray(item.command) ? item.command.join(' ') : item.command ?? '', cwd: item.cwd }, item.aggregated_output, timestamp, 'complete', item.exit_code != null && item.exit_code !== 0)
        if (kind === 'FileChange') {
          const changes = item.changes ?? []
          if (['completed', 'complete'].includes(String(item.status).toLowerCase())) {
            for (const change of Array.isArray(changes) ? changes : Object.entries(changes).map(([name, value]) => ({ ...value, path: name }))) if (change.path) data.filesEdited.add(change.path)
          }
          addTool(item.id, 'apply_patch', { changes }, item.status ?? 'Recorded file change', timestamp)
        }
        if (kind === 'Plan' && typeof item.text === 'string') data.planText = item.text
        if (kind === 'PlanUpdate') applyPlan(item)
      }
    }
    if (row.type !== 'response_item') continue
    if (p.type === 'message' && !nativeMessages && ['user', 'assistant'].includes(p.role) && p.channel !== 'analysis') addMessage(p.role, textOf(p.content), timestamp, p.id)
    if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      const args = json(p.arguments ?? p.input)
      if (p.name?.endsWith('update_plan')) applyPlan(args)
      if (!nativeTools && !['update_plan', 'exec'].includes(p.name)) {
        const callId = p.call_id ?? p.id
        calls.set(callId, { name: p.name, input: typeof args === 'object' ? args : { input: args }, timestamp })
      }
    }
    if (!nativeTools && ['function_call_output', 'custom_tool_call_output'].includes(p.type) && calls.has(p.call_id)) {
      const call = calls.get(p.call_id)
      addTool(p.call_id, call.name, call.input, p.output, call.timestamp)
      calls.delete(p.call_id)
    }
  }
  for (const [callId, call] of calls) addTool(callId, call.name, call.input, undefined, call.timestamp, 'running')
  data.lastAt ||= mtime || data.firstAt
  if (data.phase === 'working' && now - data.lastAt > 180) data.phase = 'unknown'
  data.title = short(title || data.firstUser.split('\n').find((line) => line.trim()) || `Codex session ${id.slice(0, 8)}`, 180)
  const spawn = meta.source?.subagent?.thread_spawn
  data.parentId = spawn?.parent_thread_id ?? null
  data.isSubagent = typeof meta.source === 'object' && Boolean(meta.source?.subagent)
  return data
}

const emptyCost = () => ({ totalUsd: 0, inputCostUsd: 0, outputCostUsd: 0, cacheReadCostUsd: 0, cacheCreationCostUsd: 0, cacheSavingsUsd: 0, hasUnpricedUsage: true, unpricedInputTokens: 0, unpricedOutputTokens: 0, unpricedCacheReadTokens: 0, unpricedCacheCreationTokens: 0, pricedTokenCoverage: 0, totalCostSource: 'unavailable' })
export function toLive(data) {
  const state = {
    working: ['autonomous', 'acting', 'Working · recorded activity'],
    completed: ['needs_you', 'task_complete', 'Turn completed'],
    waiting: ['needs_you', 'awaiting_input', 'Waiting for input'],
    interrupted: ['needs_you', 'interrupted', 'Interrupted'],
    error: ['needs_you', 'error', 'Turn failed'],
    unknown: ['needs_you', 'unknown', 'State unverified'],
    idle: ['needs_you', 'idle', 'Idle · no turn recorded'],
  }[data.phase]
  return {
    id: data.id, status: data.phase === 'working' ? 'working' : data.phase === 'completed' ? 'done' : 'paused',
    startedAt: data.firstAt, closedAt: data.phase === 'completed' ? data.turnEndedAt : null,
    control: null, ownership: null, pendingInteraction: null, model: data.model, modelDisplayName: data.model,
    contextWindowTokens: data.contextWindowTokens ?? 0,
    statuslineContextWindowSize: data.contextWindowSize,
    statuslineUsedPct: data.contextWindowTokens != null && data.contextWindowSize > 0 ? data.contextWindowTokens / data.contextWindowSize * 100 : null,
    sessionKind: data.isSubagent ? 'background' : 'interactive', entrypoint: 'codex',
    agentState: { group: state[0], state: state[1], label: state[2], context: 'Read-only Codex rollout. Runtime process and approval state are not observable from logs alone.' },
    pid: null, title: data.title, lastUserMessage: short(data.lastUser, 1000), lastUserMessageAt: data.lastUserAt,
    currentActivity: data.phase === 'unknown' ? `No recent event; last recorded: ${data.activity || 'turn started'}` : data.phase === 'completed' ? short(data.lastAssistant) || 'Turn finished; overall task completion is not inferred.' : data.activity || state[2],
    lastAssistantPreview: short(data.lastAssistant, 1000), turnCount: data.promptCount,
    lastActivityAt: data.lastAt, currentTurnStartedAt: data.phase === 'working' ? data.turnStartedAt : null,
    subAgents: data.subAgents ?? [], progressItems: data.plan, compactCount: 0, hookEvents: [],
    project: data.cwd ?? '(unknown)', projectDisplayName: data.cwd ? path.basename(data.cwd) || data.cwd : 'Unknown project', projectPath: data.cwd ?? '', filePath: data.filePath,
    gitBranch: data.branch, worktreeBranch: null, isWorktree: false, effectiveBranch: data.branch,
    tokens: data.tokens, cost: emptyCost(), cacheStatus: 'unknown', lastTurnTaskSeconds: data.turnEndedAt && data.turnStartedAt ? Math.max(0, data.turnEndedAt - data.turnStartedAt) : null,
    lastCacheHitAt: null, teamName: null, editCount: data.filesEdited.size, toolsUsed: [], slug: null,
    phase: { current: null, labels: [], dominant: null, freshness: 'fresh' },
  }
}

export function toInfo(data) {
  return {
    id: data.id, project: data.cwd ?? '(unknown)', projectPath: data.cwd ?? '', displayName: data.cwd ? path.basename(data.cwd) : 'Unknown project',
    configDir: '', profile: '', filePath: data.filePath, modifiedAt: data.lastAt, sizeBytes: data.size,
    preview: data.title, summary: null, lastMessage: short(data.lastAssistant, 1000), filesTouched: [...data.filesEdited], skillsUsed: [],
    toolCounts: { read: 0, edit: data.filesEdited.size, bash: data.toolCount, write: 0 },
    messageCount: data.blocks.length, turnCount: data.promptCount, gitBranch: data.branch, isSidechain: data.isSubagent, deepIndexed: data.fullRecord === true,
    totalInputTokens: data.tokens.inputTokens, totalOutputTokens: data.tokens.outputTokens, primaryModel: data.model,
    userPromptCount: data.promptCount, apiCallCount: 0, toolCallCount: data.toolCount, filesRead: [], filesEdited: [...data.filesEdited],
    filesReadCount: 0, filesEditedCount: data.filesEdited.size, reeditedFilesCount: 0,
    durationSeconds: Math.max(0, data.lastAt - data.firstAt), firstMessageAt: data.firstAt,
    commitCount: 0, thinkingBlockCount: 0, apiErrorCount: data.phase === 'error' ? 1 : 0, compactionCount: 0,
    agentSpawnCount: data.subAgents?.length ?? 0, bashProgressCount: data.toolCount, hookProgressCount: 0, mcpProgressCount: 0,
    linesAdded: 0, linesRemoved: 0, locSource: 0, parseVersion: 1, totalCostUsd: null, entrypoint: 'codex', provider: 'codex',
  }
}

async function rolloutFiles(root) {
  const out = []
  async function walk(dir, archived) {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return; throw error }
    for (const entry of entries) {
      const name = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(name, archived)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push({ filePath: name, archived })
    }
  }
  await walk(path.join(root, 'sessions'), false)
  await walk(path.join(root, 'archived_sessions'), true)
  return out
}

async function sampleFile(filePath, size) {
  const file = await open(filePath, 'r')
  try {
    const head = Buffer.alloc(Math.min(size, HEAD_BYTES))
    const first = await file.read(head, 0, head.length, 0)
    if (size <= HEAD_BYTES) return recordsFrom(head.subarray(0, first.bytesRead).toString())
    const start = Math.max(first.bytesRead, size - TAIL_BYTES)
    const tail = Buffer.alloc(size - start)
    const last = await file.read(tail, 0, tail.length, start)
    const prefix = head.subarray(0, first.bytesRead).toString()
    const suffix = tail.subarray(0, last.bytesRead).toString()
    return [...recordsFrom(prefix.slice(0, prefix.lastIndexOf('\n'))), { type: 'agenthud_gap' }, ...recordsFrom(suffix.slice(suffix.indexOf('\n') + 1))]
  } finally { await file.close() }
}

export class CodexStore {
  constructor(home, { now = () => Date.now() / 1000 } = {}) { this.home = home; this.now = now; this.cache = new Map(); this.details = new Map(); this.scannedAt = 0; this.pending = null }
  async refresh() {
    if (this.pending) return this.pending
    this.pending = this.scan().finally(() => { this.pending = null })
    return this.pending
  }
  async scan() {
    const titles = new Map()
    try { for (const row of recordsFrom(await readFile(path.join(this.home, 'session_index.jsonl'), 'utf8'))) if (row.id && typeof row.thread_name === 'string') titles.set(row.id, row.thread_name) } catch (error) { if (error.code !== 'ENOENT') throw error }
    const files = await rolloutFiles(this.home), seen = new Set(), errors = []
    let position = 0
    await Promise.all(Array.from({ length: 8 }, async () => {
      for (;;) {
        const file = files[position++]
        if (!file) return
        seen.add(file.filePath)
        try {
          const info = await stat(file.filePath), prior = this.cache.get(file.filePath)
          if (prior?.size === info.size && prior?.mtimeMs === info.mtimeMs) { prior.title = short(titles.get(prior.rawId) || prior.title, 180); continue }
          // Recent rollouts need all lifecycle markers: a long active turn's
          // start may be outside the tail window. Older history stays bounded.
          const fullRecord = Date.now() - info.mtimeMs < 86400_000 && info.size <= MAX_DETAIL_BYTES
          const records = fullRecord ? recordsFrom(await readFile(file.filePath, 'utf8')) : await sampleFile(file.filePath, info.size)
          const parsed = parseRollout(records, { ...file, size: info.size, mtime: info.mtimeMs / 1000, now: this.now() })
          if (parsed) { parsed.fullRecord = fullRecord; parsed.title = short(titles.get(parsed.rawId) || parsed.title, 180); this.cache.set(file.filePath, { ...parsed, ...file, mtimeMs: info.mtimeMs }) }
        } catch (error) { if (error.code !== 'ENOENT') errors.push({ file: path.basename(file.filePath), code: error.code ?? 'READ_ERROR' }); this.cache.delete(file.filePath) }
      }
    }))
    for (const name of this.cache.keys()) if (!seen.has(name)) this.cache.delete(name)
    this.errors = errors; this.scannedAt = Date.now()
  }
  all({ archived = false } = {}) {
    return [...this.cache.values()].filter((item) => !item.isSubagent && (archived || !item.archived)).map((item) => {
      const data = { ...item }
      if (data.phase === 'working' && this.now() - data.lastAt > 180) data.phase = 'unknown'
      data.subAgents = this.subAgentsFor(data.rawId)
      return data
    }).sort((a, b) => b.lastAt - a.lastAt)
  }
  subAgentsFor(rawId) {
    return [...this.cache.values()].filter((child) => child.parentId === rawId && ['working', 'completed', 'error'].includes(child.phase) && (child.phase !== 'working' || this.now() - child.lastAt <= 180)).map((child) => ({ toolUseId: child.rawId, agentId: child.rawId, agentType: 'Codex subagent', description: child.title, status: child.phase === 'completed' ? 'complete' : child.phase === 'working' ? 'running' : 'error', startedAt: child.firstAt, currentActivity: child.activity }))
  }
  snapshot() {
    const recent = this.all().filter((item) => this.now() - item.lastAt < 7 * 86400)
    const sessions = recent.filter((item) => item.phase !== 'completed').slice(0, 100).map(toLive)
    const recentlyClosed = recent.filter((item) => item.phase === 'completed').slice(0, 20).map(toLive)
    return { sessions, recentlyClosed, summary: { needsYouCount: sessions.filter((s) => s.agentState.group === 'needs_you').length, autonomousCount: sessions.filter((s) => s.agentState.group === 'autonomous').length, processCount: 0, totalCostTodayUsd: 0, totalTokensToday: 0 } }
  }
  projects() {
    const groups = new Map()
    for (const item of this.all()) {
      const key = item.cwd ?? '(unknown)', group = groups.get(key) ?? { name: key, path: item.cwd ?? '', displayName: item.cwd ? path.basename(item.cwd) : 'Unknown project', sessionCount: 0, activeCount: 0, lastActivityAt: 0, isArchived: false }
      group.sessionCount++; group.activeCount += item.phase === 'working' ? 1 : 0; group.lastActivityAt = Math.max(group.lastActivityAt, item.lastAt); groups.set(key, group)
    }
    return [...groups.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  }
  async detail(id) {
    const item = [...this.cache.values()].find((entry) => entry.id === id)
    if (!item) return null
    const info = await stat(item.filePath), previous = this.details.get(id)
    if (previous?.mtimeMs === info.mtimeMs && previous?.size === info.size) {
      previous.title = item.title; previous.subAgents = this.subAgentsFor(previous.rawId)
      return previous.phase === 'working' && this.now() - previous.lastAt > 180 ? { ...previous, phase: 'unknown' } : previous
    }
    if (info.size > MAX_DETAIL_BYTES) throw Object.assign(new Error('Session exceeds the 64 MB detail limit'), { status: 413 })
    const parsed = parseRollout(recordsFrom(await readFile(item.filePath, 'utf8')), { filePath: item.filePath, size: info.size, mtime: info.mtimeMs / 1000, title: item.title, now: this.now() })
    if (!parsed) return null
    parsed.mtimeMs = info.mtimeMs
    parsed.fullRecord = true
    parsed.subAgents = this.subAgentsFor(parsed.rawId)
    this.details.set(id, parsed)
    if (this.details.size > 4) this.details.delete(this.details.keys().next().value)
    return parsed
  }
}
