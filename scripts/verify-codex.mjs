import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { appendFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCodexServer } from '../server/index.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { chromium, expect } = require('@playwright/test')
const cache = path.join(os.homedir(), '.cache/ms-playwright')
let installed
try {
  for (const name of (await readdir(cache)).filter((name) => name.startsWith('chromium-')).sort().reverse()) {
    const file = path.join(cache, name, 'chrome-linux64/chrome')
    try { await import('node:fs/promises').then((fs) => fs.access(file)); installed = file; break } catch {}
  }
} catch {}
const home = await mkdtemp(path.join(os.tmpdir(), 'agenthud-browser-codex-'))
const log = path.join(home, 'sessions', 'fixture.jsonl')
const stamp = () => new Date().toISOString()
const row = (type, payload) => ({ timestamp: stamp(), type, payload })
const line = (item) => JSON.stringify(item) + '\n'
const message = (id, text) => row('event_msg', { type: 'item_completed', item: { type: 'AgentMessage', id, phase: 'Commentary', content: [{ type: 'text', text }] } })
let server, browser, daemon, daemonSockets
const observers = new Set()
const notify = (method, params = {}) => { for (const socket of observers) socket.send(JSON.stringify({ method, params: { threadId: 'fixture-codex', turnId: 'fixture-turn', ...params } })) }
const errors = [], badApi = []
const questionReplies = []
const nativeReplies = []
let confirmNativeReplies = true
const nativeRequest = (method, params, id) => {
  for (const socket of observers) socket.send(JSON.stringify({ id, method, params: { threadId: 'fixture-codex', turnId: 'reply-turn', itemId: `item-${id}`, ...params } }))
}
try {
  await mkdir(path.dirname(log), { recursive: true })
  await writeFile(log, [
    row('session_meta', { id: 'fixture-codex', cwd: '/work/codex-fixture', source: 'cli', timestamp: stamp(), git: { branch: 'test/integration' } }),
    row('turn_context', { model: 'gpt-6.1-sol', cwd: '/work/codex-fixture' }),
    row('event_msg', { type: 'task_started', turn_id: 'fixture-turn' }),
    row('event_msg', { type: 'item_completed', item: { type: 'UserMessage', id: 'fixture-user', content: [{ type: 'text', text: 'Codex integration fixture' }] } }),
    message('fixture-commentary', 'Checking integration fixture.'),
  ].map(line).join(''))
  await mkdir(path.join(home, 'app-server-control'), { recursive: true })
  daemon = createServer()
  daemonSockets = new WebSocketServer({ server: daemon })
  const thread = { id: 'fixture-codex', status: { type: 'active', activeFlags: [] } }
  daemonSockets.on('connection', (socket) => {
    observers.add(socket)
    socket.on('close', () => observers.delete(socket))
    socket.on('message', async (buffer) => {
      const { id, method, params, result: nativeResult } = JSON.parse(buffer)
      if (!method && nativeResult !== undefined) {
        nativeReplies.push({ id, result: nativeResult })
        if (confirmNativeReplies) notify('serverRequest/resolved', { requestId: id, turnId: 'reply-turn' })
        return
      }
      if (method === 'initialized') return
      if (method === 'turn/start') {
        questionReplies.push(params)
        assert.deepEqual(Object.keys(params).sort(), ['input', 'threadId'])
        assert.equal(params.threadId, 'fixture-codex')
        const text = params.input[0].text
        assert.equal(JSON.parse(text.split('\n')[1])[0].answer, 'Yes, and the answer field works')
        await appendFile(log, [
          row('event_msg', { type: 'task_started', turn_id: 'reply-turn' }),
          row('event_msg', { type: 'item_completed', item: { type: 'UserMessage', id: 'async-reply', content: [{ type: 'text', text }] } }),
        ].map(line).join(''))
        notify('turn/started', { turn: { id: 'reply-turn' } })
        notify('item/completed', { turnId: 'reply-turn', item: { id: 'async-reply', type: 'userMessage' } })
        socket.send(JSON.stringify({ id, result: { turn: { id: 'reply-turn', status: 'inProgress' } } }))
        return
      }
      assert(['initialize', 'thread/loaded/list', 'thread/read', 'thread/resume'].includes(method), `Unexpected observer request: ${method}`)
      if (method === 'thread/resume') assert.deepEqual(params, { threadId: 'fixture-codex', excludeTurns: true, initialTurnsPage: { limit: 1, sortDirection: 'desc', itemsView: 'full' } })
      const result = method === 'initialize' ? {} : method === 'thread/loaded/list' ? { data: ['fixture-codex'], nextCursor: null } : { thread, initialTurnsPage: { data: [] } }
      socket.send(JSON.stringify({ id, result }))
    })
  })
  await new Promise(resolve => daemon.listen(path.join(home, 'app-server-control', 'app-server-control.sock'), resolve))
  const app = createCodexServer({ home, dist: path.join(root, 'apps/web/dist'), pollMs: 150 })
  server = app.server
  await app.ready
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || installed, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: 'dark' })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => { if (response.url().includes('/api/') && response.status() >= 400) badApi.push(new URL(response.url()).pathname) })
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Codex · Requests & replies', { exact: true })).toBeVisible()
  await expect(page.locator('[data-session-id]')).toHaveCount(1)
  await expect.poll(async () => (await (await fetch(base + '/api/runtime')).json()).statusSource).toBe('app-server-events')
  notify('item/started', { item: { id: 'tool-a', type: 'commandExecution', command: 'bun test' } })
  await expect(page.locator('.session-runtime-activity')).toHaveText('tool: Bash · bun test')
  notify('item/completed', { item: { id: 'tool-a', type: 'commandExecution' } })
  await expect(page.locator('.session-runtime-activity')).toHaveText('proccessing')
  notify('item/started', { item: { id: 'reason-a', type: 'reasoning', summary: [], content: ['PRIVATE REASONING'] } })
  notify('item/reasoning/summaryTextDelta', { itemId: 'reason-a', summaryIndex: 0, delta: 'Checking integration behavior' })
  await expect(page.locator('.session-runtime-activity')).toHaveText('reasoning: Checking integration behavior')
  await expect(page.locator('body')).not.toContainText('PRIVATE REASONING')
  notify('item/completed', { item: { id: 'reason-a', type: 'reasoning' } })
  notify('item/agentMessage/delta', { itemId: 'output-a', delta: 'Some public answer' })
  await expect(page.locator('.session-runtime-activity')).toHaveText('outputting')
  await page.locator('[data-session-id]').click()
  await page.getByRole('tab', { name: 'Chat', exact: true }).click()
  await expect(page.getByText('Checking integration fixture.', { exact: true }).last()).toBeVisible()
  await appendFile(log, [
    row('response_item', { type: 'function_call', name: 'update_plan', call_id: 'fixture-plan', arguments: JSON.stringify({ plan: [{ step: 'Verify persisted progress', status: 'completed' }] }) }),
    message('fixture-final', 'New persisted event arrived.'),
    row('event_msg', { type: 'task_complete', last_agent_message: 'New persisted event arrived.' }),
  ].map(line).join(''))
  notify('turn/completed', { turn: { id: 'fixture-turn', status: 'completed' } })
  await expect(page.locator('.session-runtime-activity')).toHaveCount(0)
  await expect(page.getByText('New persisted event arrived.', { exact: true }).last()).toBeVisible({ timeout: 15000 })
  await page.getByRole('tab', { name: 'Tasks', exact: true }).click()
  await expect(page.getByText('Verify persisted progress', { exact: true }).last()).toBeVisible()
  await page.getByRole('button', { name: 'Close detail panel' }).click()
  await expect(page.locator('.session-status')).toBeEmpty()
  await expect(page.locator('.session-status')).toHaveAttribute('aria-label', 'idle')
  const dotPosition = await page.locator('.session-status').evaluate((dot) => {
    const card = dot.closest('.task-card').getBoundingClientRect()
    const bounds = dot.getBoundingClientRect()
    return { right: card.right - bounds.right, bottom: card.bottom - bounds.bottom }
  })
  assert(dotPosition.right >= 8 && dotPosition.right <= 16, 'Status dot must sit at the right edge of the card')
  assert(dotPosition.bottom >= 8 && dotPosition.bottom <= 16, 'Status dot must sit at the bottom edge of the card')
  await expect(page.locator('.task-card time')).toHaveCount(1)
  await expect(page.getByText('Turn completed', { exact: true })).toHaveCount(0)
  // A completed async question must stay on the board even when the daemon is idle.
  await appendFile(log, [
    row('event_msg', { type: 'item_completed', item: {
      type: 'AgentMessage', id: 'async-question', phase: 'final_answer', delivery: 'async',
      content: [{ type: 'Text', text: 'Does Need you appear?' }],
      questions: [{ title: 'Does Need you appear?', options: ['Yes', 'No'] }],
    } }),
    row('event_msg', { type: 'task_complete' }),
  ].map(line).join(''))
  await expect(page.locator('.session-status')).toHaveAttribute('aria-label', 'Need you')
  await page.getByRole('button', { name: 'Need you', exact: true }).click()
  await expect(page.locator('[data-session-id]')).toHaveCount(1)
  await expect.poll(async () => (await (await fetch(base + '/api/live/sessions')).json()).summary.needsYouCount).toBe(1)
  const boardQuestion = page.locator('[data-session-id]').getByRole('region', { name: 'Question from Codex' })
  const questionCard = page.getByRole('region', { name: 'Question from Codex' })
  await expect(boardQuestion).toBeVisible()
  await expect(questionCard.getByText('Does Need you appear?', { exact: true })).toBeVisible()
  await expect(questionCard.getByRole('button', { name: 'Send answer', exact: true })).toBeDisabled()
  await questionCard.getByRole('button', { name: 'Yes', exact: true }).click()
  await expect(questionCard.getByRole('textbox', { name: 'Your answer', exact: true })).toHaveValue('Yes')
  await expect(page.getByRole('button', { name: 'Close detail panel' })).toHaveCount(0)
  await page.locator('.session-title button').click()
  await expect(page.getByRole('button', { name: 'Close detail panel' })).toBeVisible()
  await expect(questionCard).toHaveCount(1)
  await page.getByRole('button', { name: 'Close detail panel' }).click()
  // The full conversation page offers the same question and reply controls.
  await page.goto(base + '/sessions/codex%3Afixture-codex', { waitUntil: 'domcontentloaded' })
  await expect(questionCard.getByText('Does Need you appear?', { exact: true })).toBeVisible()
  await page.goto(base + '/?needYou=1', { waitUntil: 'domcontentloaded' })
  await expect(boardQuestion).toBeVisible()
  const answerField = boardQuestion.getByRole('textbox', { name: 'Your answer', exact: true })
  await answerField.fill('Yes, and the answer field works')
  await answerField.press('Enter')
  await expect(page.getByRole('button', { name: 'Close detail panel' })).toHaveCount(0)
  await expect(page).toHaveURL(base + '/?needYou=1')
  await boardQuestion.getByRole('button', { name: 'Send answer', exact: true }).click()
  await expect(questionCard).toHaveCount(0)
  assert.equal(questionReplies.length, 1)
  await page.goto(base + '/?needYou=1', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-session-id]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Need you', exact: true }).click()
  await expect(page.locator('.session-status')).toHaveAttribute('aria-label', 'running')
  console.log('PASS in-card question choices, typing and submission without opening sidebar; Need you clears on confirmed reply')
  const nativeCard = page.locator('[data-session-id]').getByRole('region', { name: 'Request from Codex' })
  confirmNativeReplies = false
  nativeRequest('item/commandExecution/requestApproval', { command: 'bun test', cwd: '/work/codex-fixture', reason: 'Run the requested checks' }, 900)
  await expect(nativeCard).toContainText('bun test')
  await expect(page.locator('.session-status')).toHaveAttribute('aria-label', 'Need you')
  await nativeCard.getByRole('button', { name: 'Allow once', exact: true }).click()
  await expect.poll(() => nativeReplies.length).toBe(1)
  assert.deepEqual(nativeReplies[0], { id: 900, result: { decision: 'accept' } })
  await expect(nativeCard).toContainText('Waiting for Codex confirmation')
  await expect(nativeCard.getByRole('button', { name: 'Allow once', exact: true })).toBeDisabled()
  notify('serverRequest/resolved', { requestId: 900, turnId: 'reply-turn' })
  await expect(nativeCard).toHaveCount(0)
  confirmNativeReplies = true

  notify('item/started', { turnId: 'reply-turn', item: { id: 'item-901', type: 'fileChange', changes: [{ path: 'src/example.ts', diff: '+export const ok = true' }] } })
  nativeRequest('item/fileChange/requestApproval', { reason: 'Write the proposed file' }, 901)
  await expect(nativeCard).toContainText('src/example.ts')
  await nativeCard.getByRole('button', { name: 'Deny', exact: true }).click()
  await expect(nativeCard).toHaveCount(0)
  assert.deepEqual(nativeReplies.at(-1), { id: 901, result: { decision: 'decline' } })

  nativeRequest('item/permissions/requestApproval', { permissions: { network: { enabled: true }, fileSystem: null }, reason: 'Connect to the package registry' }, 902)
  await expect(nativeCard).toContainText('network')
  await nativeCard.getByRole('button', { name: 'Allow for session', exact: true }).click()
  await expect(nativeCard).toHaveCount(0)
  assert.deepEqual(nativeReplies.at(-1), { id: 902, result: { permissions: { network: { enabled: true } }, scope: 'session' } })

  nativeRequest('item/tool/requestUserInput', { questions: [
    { id: 'strategy', question: 'Migration strategy', isOther: false, options: [{ label: 'Incremental', description: 'Keep records' }] },
    { id: 'code', question: 'Access code', isOther: true, isSecret: true, options: null },
  ] }, 'input-903')
  await nativeCard.getByRole('combobox', { name: 'Migration strategy *', exact: true }).selectOption('Incremental')
  await expect(nativeCard.getByLabel('Access code *', { exact: true })).toHaveAttribute('type', 'password')
  await nativeCard.getByLabel('Access code *', { exact: true }).fill('fixture-code')
  await nativeCard.getByRole('button', { name: 'Send answer', exact: true }).click()
  await expect(nativeCard).toHaveCount(0)
  assert.deepEqual(nativeReplies.at(-1), { id: 'input-903', result: { answers: { strategy: { answers: ['Incremental'] }, code: { answers: ['fixture-code'] } } } })

  nativeRequest('mcpServer/elicitation/request', { mode: 'form', serverName: 'fixture', message: 'Provide deployment details', requestedSchema: {
    type: 'object', required: ['name', 'count', 'enabled'], properties: { name: { type: 'string' }, count: { type: 'integer', minimum: 1 }, enabled: { type: 'boolean' } },
  } }, 904)
  await nativeCard.getByLabel('name *', { exact: true }).fill('staging')
  await nativeCard.getByLabel('count *', { exact: true }).fill('2')
  await nativeCard.getByRole('combobox', { name: 'enabled *', exact: true }).selectOption('false')
  await nativeCard.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(nativeCard).toHaveCount(0)
  assert.deepEqual(nativeReplies.at(-1), { id: 904, result: { action: 'accept', content: { name: 'staging', count: 2, enabled: false }, _meta: null } })

  nativeRequest('mcpServer/elicitation/request', { mode: 'url', serverName: 'fixture', message: 'Complete sign-in', url: 'https://example.com/login', elicitationId: 'login' }, 905)
  await expect(nativeCard.getByRole('link', { name: 'Open requested page' })).toHaveAttribute('href', 'https://example.com/login')
  await nativeCard.getByRole('button', { name: 'Decline', exact: true }).click()
  await expect(nativeCard).toHaveCount(0)
  assert.deepEqual(nativeReplies.at(-1), { id: 905, result: { action: 'decline', content: null, _meta: null } })

  nativeRequest('item/commandExecution/requestApproval', { command: 'resolved-in-original-client' }, 906)
  await expect(nativeCard).toBeVisible()
  const beforeExternalDecision = nativeReplies.length
  notify('serverRequest/resolved', { requestId: 906, turnId: 'reply-turn' })
  await expect(nativeCard).toHaveCount(0)
  assert.equal(nativeReplies.length, beforeExternalDecision)
  assert.equal(questionReplies.length, 1, 'Native replies must not start another Codex turn')
  console.log('PASS command/file/permission approvals, blocking input and secret fields, MCP forms/URLs, external decisions and confirmation before clearing')
  await page.goto(base + '/sessions', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Codex integration fixture', { exact: true }).first()).toBeVisible()
  await page.goto(base + '/sessions/codex%3Afixture-codex', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('New persisted event arrived.', { exact: true }).first()).toBeVisible()
  assert.deepEqual(errors, [])
  assert.deepEqual(badApi, [])
  console.log('PASS live tool/reasoning/output text, completed activity cleanup; real HTTP data, native Codex transcript, append updates, recorded plan, completed-turn transition, history and details')

  // A failed live backend must never silently turn into a demo.
  await page.route('**/api/runtime', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline"}' }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('alert')).toContainText('Could not connect to the dashboard data source (503)')
  await expect(page.getByText('Demo · Simulated sessions', { exact: true })).toHaveCount(0)
  console.log('PASS failed live connection does not fall back to mock data')

  if (process.env.CODEX_LIVE_URL) {
    const actual = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: 'dark' })
    const actualErrors = []
    actual.on('pageerror', (error) => actualErrors.push(error.message))
    const live = process.env.CODEX_LIVE_URL
    const scope = process.env.CODEX_PROJECT || '/home/zhong/Projects/agentHUD'
    await actual.goto(`${live}/?project=${encodeURIComponent(scope)}`, { waitUntil: 'domcontentloaded' })
    await expect(actual.getByText('Codex · Requests & replies', { exact: true })).toBeVisible()
    await expect(actual.getByRole('button', { name: 'Filters', exact: true })).toBeVisible()
    await expect(actual.getByRole('heading', { name: 'Task board' })).toHaveCount(0)
    const snapshot = await actual.evaluate(async () => (await fetch('/api/live/sessions')).json())
    assert([...snapshot.sessions, ...snapshot.recentlyClosed].every((item) => item.id.startsWith('codex:')))
    assert(snapshot.sessions.some((item) => item.projectPath === scope))
    await mkdir(path.join(root, 'artifacts'), { recursive: true })
    await actual.screenshot({ path: path.join(root, 'artifacts/codex-board-dark.png') })
    const own = snapshot.sessions.find((item) => item.projectPath === scope)
    await actual.goto(`${live}/sessions/${encodeURIComponent(own.id)}`, { waitUntil: 'domcontentloaded' })
    await expect(actual.getByText('Codex · Requests & replies', { exact: true })).toBeVisible()
    await expect(actual.getByRole('button', { name: 'Export options' })).toBeEnabled({ timeout: 15000 })
    await expect.poll(async () => (await actual.getByTestId('message-thread').first().innerText()).length).toBeGreaterThan(30)
    await actual.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await actual.screenshot({ path: path.join(root, 'artifacts/codex-detail-dark.png') })
    assert.deepEqual(actualErrors, [])
    console.log(`PASS local Codex sessions (${snapshot.sessions.length} recent open records, ${snapshot.recentlyClosed.length} finished turns)`)
  }
} finally {
  if (browser) await browser.close()
  if (server) await server.stop()
  if (daemonSockets) { for (const socket of daemonSockets.clients) socket.terminate(); await new Promise(resolve => daemonSockets.close(resolve)) }
  if (daemon) await new Promise(resolve => daemon.close(resolve))
  await rm(home, { recursive: true, force: true })
}
