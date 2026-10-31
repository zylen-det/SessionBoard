import assert from 'node:assert/strict'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { CodexStore, parseRollout, recordsFrom, toLive } from './codex-store.mjs'
import { createCodexServer } from './index.mjs'

const at = '2026-10-31T10:00:00Z'
const now = Date.parse(at) / 1000
const row = (type, payload, timestamp = at) => ({ type, payload, timestamp })
const meta = (id = 'thread-a', cwd = '/work/project') => row('session_meta', { id, cwd, source: 'cli', timestamp: at, git: { branch: 'main' } })
const started = row('event_msg', { type: 'task_started', turn_id: 'turn-a' })
const completed = row('event_msg', { type: 'task_complete', last_agent_message: 'Checks passed.' })
const user = row('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the failing integration test' }] })
const assistant = row('response_item', { type: 'message', role: 'assistant', channel: 'final', content: [{ type: 'output_text', text: 'Checks passed.' }] })
const lines = (rows) => rows.map((item) => JSON.stringify(item)).join('\n') + '\n'

test('reads older transcripts, plan steps and completed turns without exposing private instructions or reasoning', () => {
  const parsed = parseRollout([
    meta(), started, user,
    row('response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'PRIVATE INSTRUCTIONS' }] }),
    row('response_item', { type: 'message', role: 'assistant', channel: 'analysis', content: [{ type: 'output_text', text: 'PRIVATE REASONING' }] }),
    row('response_item', { type: 'function_call', name: 'update_plan', call_id: 'plan', arguments: JSON.stringify({ plan: [{ step: 'Reproduce failure', status: 'completed' }, { step: 'Verify fix', status: 'in_progress' }] }) }),
    assistant, completed,
  ], { now })
  assert.equal(parsed.phase, 'completed')
  assert.equal(parsed.plan[1].status, 'in_progress')
  assert.equal(toLive(parsed).agentState.label, 'Turn completed')
  assert.doesNotMatch(JSON.stringify(parsed.blocks), /PRIVATE/)
  assert.equal(parsed.blocks.length, 2)
})

test('supports the native item_completed format and avoids duplicate response items', () => {
  const parsed = parseRollout([
    meta(), started, user,
    row('event_msg', { type: 'item_completed', item: { type: 'UserMessage', id: 'u1', content: [{ type: 'text', text: 'Fix the failing integration test' }] } }),
    row('event_msg', { type: 'item_completed', item: { type: 'Reasoning', id: 'r1', summary_text: ['PRIVATE REASONING'] } }),
    row('event_msg', { type: 'item_completed', item: { type: 'CommandExecution', id: 't1', command: ['bun', 'test'], aggregated_output: '1 passed', status: 'Completed', exit_code: 0 } }),
    row('event_msg', { type: 'item_completed', item: { type: 'AgentMessage', id: 'a1', phase: 'FinalAnswer', content: [{ type: 'text', text: 'Checks passed.' }] } }),
    assistant, completed,
  ], { now })
  assert.equal(parsed.blocks.length, 3)
  assert.equal(parsed.promptCount, 1)
  assert.equal(parsed.blocks[1].segments[0].execution.toolName, 'Bash')
  assert.doesNotMatch(JSON.stringify(parsed.blocks), /PRIVATE/)
})

test('never promotes a failed command or stale/missing evidence to a blocked or completed task', () => {
  const failedTool = row('event_msg', { type: 'item_completed', item: { type: 'CommandExecution', id: 't1', command: ['false'], exit_code: 1, aggregated_output: 'failed' } })
  assert.equal(parseRollout([meta(), started, failedTool], { now }).phase, 'working')
  assert.equal(parseRollout([meta(), started], { now: now + 181 }).phase, 'unknown')
  assert.equal(parseRollout([meta(), started, completed, { type: 'agenthud_gap' }, failedTool], { now }).phase, 'unknown')
  assert.equal(parseRollout([meta(), started, row('event_msg', { type: 'turn_aborted' })], { now }).phase, 'interrupted')
})

test('ignores a partially written record and reads it when the append completes', () => {
  const partial = lines([meta(), started]) + '{"type":"event_msg","payload":{"type":"task_com'
  assert.equal(parseRollout(recordsFrom(partial), { now }).phase, 'working')
  const complete = partial + 'plete"},"timestamp":"' + at + '"}\n'
  assert.equal(parseRollout(recordsFrom(complete), { now }).phase, 'completed')
})

test('discovers sessions, isolates subagents and refreshes changes without modifying the source', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'agenthud-codex-test-'))
  try {
    const directory = path.join(home, 'sessions', '2026', '10', '31')
    await mkdir(directory, { recursive: true })
    const file = path.join(directory, 'rollout-a.jsonl'), initial = lines([meta(), started, user])
    await writeFile(file, initial)
    await writeFile(path.join(directory, 'child.jsonl'), lines([row('session_meta', { id: 'child', cwd: '/work/project', source: { subagent: { thread_spawn: { parent_thread_id: 'thread-a' } } } }), started]))
    const store = new CodexStore(home, { now: () => now })
    await store.refresh()
    assert.equal(store.all().length, 1)
    assert.equal(store.projects()[0].sessionCount, 1)
    assert.equal(store.snapshot().sessions[0].id, 'codex:thread-a')
    assert.equal((await store.detail('codex:thread-a')).subAgents.length, 1)
    store.now = () => now + 181
    assert.equal((await store.detail('codex:thread-a')).phase, 'unknown')
    assert.equal(store.snapshot().sessions[0].agentState.label, 'State unverified')
    store.now = () => now
    assert.equal(await readFile(file, 'utf8'), initial)
    await appendFile(file, lines([assistant, completed]))
    await store.refresh()
    assert.equal(store.snapshot().sessions.length, 0)
    assert.equal(store.snapshot().recentlyClosed[0].agentState.label, 'Turn completed')
    assert.equal((await store.detail('codex:thread-a')).blocks.length, 2)
    await writeFile(path.join(home, 'session_index.jsonl'), lines([{ id: 'thread-a', thread_name: 'Renamed task' }]))
    await store.refresh()
    assert.equal(store.all()[0].title, 'Renamed task')
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('serves actual data and SSE on a local read-only API with pagination and request isolation', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'agenthud-codex-api-'))
  let server
  try {
    await mkdir(path.join(home, 'sessions'), { recursive: true })
    await writeFile(path.join(home, 'sessions', 'a.jsonl'), lines([meta(), started, user, assistant, completed]))
    await writeFile(path.join(home, 'sessions', 'child.jsonl'), lines([row('session_meta', { id: 'child', cwd: '/work/project', source: { subagent: { thread_spawn: { parent_thread_id: 'thread-a' } } } }), started, user]))
    const fixtureStore = new CodexStore(home, { now: () => now })
    const app = createCodexServer({ home, store: fixtureStore, pollMs: 50 })
    server = app.server
    await app.ready
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    const runtime = await (await fetch(base + '/api/runtime')).json()
    assert.equal(runtime.mode, 'codex'); assert.equal(runtime.readOnly, true)
    const history = await (await fetch(base + '/api/sessions?project=%2Fwork%2Fproject')).json()
    assert.equal(history.total, 1); assert.equal(history.sessions[0].provider, 'codex')
    const messages = await (await fetch(base + '/api/sessions/codex%3Athread-a/messages?offset=1&limit=1')).json()
    assert.equal(messages.total, 2); assert.equal(messages.blocks.length, 1); assert.equal(messages.blocks[0].type, 'assistant')
    const childMessages = await (await fetch(base + '/api/sessions/codex%3Athread-a/subagents/child/messages')).json()
    assert.equal(childMessages.total, 1)
    assert.equal((await fetch(base + '/api/sessions/codex%3Athread-a/archive', { method: 'POST' })).status, 405)
    assert.equal((await fetch(base + '/api/projects', { headers: { Origin: 'https://other.example' } })).status, 403)
    assert.equal((await fetch(base + '/api/sessions/codex%3Aunknown')).status, 404)
    const hostile = await new Promise((resolve) => {
      http.get(base + '/api/projects', { headers: { Host: 'other.example' } }, (res) => { res.resume(); resolve(res.statusCode) })
    })
    assert.equal(hostile, 403)
    const controller = new AbortController()
    const response = await fetch(base + '/api/live/stream', { signal: controller.signal })
    const reader = response.body.getReader(), first = await reader.read()
    assert.match(Buffer.from(first.value).toString(), /event: snapshot/)
    controller.abort()
    const source = await readFile(path.join(home, 'sessions', 'a.jsonl'), 'utf8')
    assert.equal(source, lines([meta(), started, user, assistant, completed]))
  } finally { if (server) await server.stop(); await rm(home, { recursive: true, force: true }) }
})


test('last prompt time follows user messages and stays fixed when agent activity advances', () => {
  const later = '2026-10-31T10:10:00Z'
  const lastPrompt = row('event_msg', { type: 'item_completed', item: { type: 'UserMessage', id: 'latest-user', content: [{ type: 'text', text: 'Now check edge cases' }] } }, later)
  const activity = row('event_msg', { type: 'item_completed', item: { type: 'AgentMessage', id: 'latest-agent', phase: 'Commentary', content: [{ type: 'text', text: 'Checking now' }] } }, '2026-10-31T10:11:00Z')
  const legacyActivity = row('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Checking now' }] }, '2026-10-31T10:11:00Z')
  const legacy = toLive(parseRollout([meta(), started, user, legacyActivity], { now: now + 660 }))
  assert.equal(legacy.lastUserMessageAt, now)
  const native = toLive(parseRollout([meta(), started, lastPrompt, activity], { now: now + 660 }))
  assert.equal(native.lastUserMessageAt, Date.parse(later) / 1000)
  assert.equal(native.lastActivityAt, now + 660)
  assert.equal(native.lastUserMessage, 'Now check edge cases')
})
